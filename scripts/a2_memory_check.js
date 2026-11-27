// Assignment 2, Step 2 (Memory): check that a cascade pair stays resident in Ollama together.
//
// Sends the service's own classification prompt (service/src/ollamaClient.js buildPrompt,
// temperature 0) alternately to the small and the large model, using non-golden tickets
// from jmeter/load_data.txt (taken from the END of the file so they do not overlap the
// first blocks used as workload). After every call it records /api/ps and the call's
// load_duration. Both models listed after every call, and near-zero load_duration after
// each model's first call, means the pair fits; a large load_duration on a later call
// means Ollama evicted one model to load the other.
//
// Usage: node scripts/a2_memory_check.js --small gemma3:4b --large qwen2.5:7b [--rounds 3]
//          [--host http://localhost:11434] [--out results/a2/memory_check.txt]
// Run against a freshly restarted Ollama (no models loaded).

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

// ollamaClient.js requires node-fetch at load time; we only need buildPrompt, so stub it.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'node-fetch') return globalThis.fetch;
  return origLoad.call(this, req, ...rest);
};
const { buildPrompt } = require(path.join(ROOT, 'service', 'src', 'ollamaClient.js'));
Module._load = origLoad;

const args = { small: null, large: null, rounds: 3, host: 'http://localhost:11434', out: path.join(ROOT, 'results', 'a2', 'memory_check.txt') };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--small') args.small = process.argv[++i];
  else if (a === '--large') args.large = process.argv[++i];
  else if (a === '--rounds') args.rounds = Number(process.argv[++i]);
  else if (a === '--host') args.host = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else throw new Error(`Unknown argument ${a}`);
}
if (!args.small || !args.large) throw new Error('Need --small and --large');

const lines = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data.txt'), 'utf8').trim().split('\n');
const tickets = lines.slice(-2 * args.rounds).map((l, i) => ({ line: lines.length - 2 * args.rounds + i + 1, narrative: JSON.parse(l).narrative }));

const GB = (b) => (b / 1024 ** 3).toFixed(2);
const out = [];
const log = (s = '') => { console.log(s); out.push(s); };

async function ps() {
  const r = await (await fetch(`${args.host}/api/ps`)).json();
  return r.models || [];
}
function psTable(models) {
  if (!models.length) return '    (no models loaded)';
  return models.map((m) => `    ${m.name.padEnd(16)} size=${GB(m.size)} GiB  size_vram=${GB(m.size_vram)} GiB  context=${m.context_length ?? '?'}  expires=${m.expires_at}`).join('\n');
}
async function memAvail() {
  const t = fs.readFileSync('/proc/meminfo', 'utf8');
  const kb = (k) => Number(t.match(new RegExp(`${k}:\\s+(\\d+)`))[1]) * 1024;
  return `MemTotal=${GB(kb('MemTotal'))} GiB MemAvailable=${GB(kb('MemAvailable'))} GiB`;
}

(async () => {
  const version = (await (await fetch(`${args.host}/api/version`)).json()).version;
  log(`A2 memory check: small=${args.small} large=${args.large}`);
  log(`Time (UTC): ${new Date().toISOString()}   Host: ${os.hostname()}   Ollama ${version}`);
  log(`Prompt: service/src/ollamaClient.js buildPrompt, options {temperature: 0} (same as the service)`);
  log(`Tickets: jmeter/load_data.txt lines ${tickets.map((t) => t.line).join(', ')} (non-golden)`);
  log(`Host memory before: ${await memAvail()}`);
  log('');
  log('ollama ps before first call:');
  log(psTable(await ps()));
  log('');

  const order = [];
  for (let r = 0; r < args.rounds; r++) order.push(args.small, args.large);
  const seen = new Set();
  let reloads = 0;
  let bothAfterEvery = true;

  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    const t = tickets[i];
    const t0 = Date.now();
    const res = await fetch(`${args.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: buildPrompt(t.narrative), stream: false, options: { temperature: 0 } }),
    });
    const body = await res.json();
    const wall = Date.now() - t0;
    const loadMs = (body.load_duration || 0) / 1e6;
    const firstForModel = !seen.has(model);
    seen.add(model);
    const reloaded = !firstForModel && loadMs > 1000;
    if (reloaded) reloads++;
    const models = await ps();
    const names = models.map((m) => m.name);
    const bothNow = names.includes(args.small) && names.includes(args.large);
    if (seen.size === 2 && !bothNow) bothAfterEvery = false;
    log(`Call ${i + 1}: ${model}  ticket line ${t.line}  HTTP ${res.status}  wall=${wall} ms  load_duration=${loadMs.toFixed(0)} ms${firstForModel ? ' (first load, expected)' : reloaded ? '  <-- RELOAD (evicted)' : ''}  answer="${String(body.response || body.error).trim().slice(0, 40)}"`);
    log(`  ollama ps after call ${i + 1}:`);
    log(psTable(models));
    log(`  ${await memAvail()}`);
    log('');
  }

  const pass = reloads === 0 && bothAfterEvery;
  log(`RESULT: ${pass ? 'PASS' : 'FAIL'}: ${bothAfterEvery ? 'both models listed by ollama ps after every call once both were loaded' : 'ollama ps did NOT list both models after every call'}; ${reloads} reload(s) after first load.`);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const header = fs.existsSync(args.out) ? '\n\n' + '='.repeat(100) + '\n\n' : '';
  fs.appendFileSync(args.out, header + out.join('\n') + '\n');
  console.log(`\nAppended to ${path.relative(ROOT, args.out)}`);
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error(e); process.exit(1); });
