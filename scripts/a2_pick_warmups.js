#!/usr/bin/env node
/**
 * A2 Step 4 set-up: choose the 3 fixed warm-up tickets used before EVERY speed-test run.
 *
 * Requirement (brief): for the cascade, the warm-up must also reach the large model, so at least one
 * warm-up ticket must be escalated. With the category rule that means gemma3:4b must label it
 * "Credit card" (escalated under both Setting A and Setting B).
 *
 * Rule: walk jmeter/load_data.txt from line 1 (lines A1 already used; never part of the A2 workload or
 * the S tickets), classify each with the small model directly through Ollama using the service's own
 * prompt (temperature 0), and take the first two tickets labelled "Credit card" plus the first ticket
 * labelled anything else. Order: non-CC, CC, CC, so the last warm-up before a run escalates.
 * Calls go straight to Ollama: nothing is written to data/service.log or the ticket DB.
 *
 * Usage: node scripts/a2_pick_warmups.js [--host http://localhost:11434] [--model gemma3:4b] [--max-lines 80]
 * Writes jmeter/a2/warmup_rows.csv and jmeter/a2/warmup.txt
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'node-fetch' ? globalThis.fetch : origLoad.call(this, req, ...rest); };
const { buildPrompt, parseCategory } = require(path.join(ROOT, 'service', 'src', 'ollamaClient.js'));
Module._load = origLoad;

const args = { host: 'http://localhost:11434', model: 'gemma3:4b', maxLines: 80 };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--host') args.host = process.argv[++i];
  else if (process.argv[i] === '--model') args.model = process.argv[++i];
  else if (process.argv[i] === '--max-lines') args.maxLines = Number(process.argv[++i]);
  else throw new Error(`Unknown argument ${process.argv[i]}`);
}

const bodies = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data.txt'), 'ascii').split('\n').filter((l) => l.trim());
const rows = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data_rows.csv'), 'utf8').trim().split('\n').slice(1)
  .map((l) => { const [line, row_id, chars, words] = l.split(',').map(Number); return { line, row_id, chars, words }; });

(async () => {
  const cc = [];
  let other = null;
  const seen = [];
  for (let line = 1; line <= args.maxLines && (cc.length < 2 || !other); line++) {
    const narrative = JSON.parse(bodies[line - 1]).narrative;
    const res = await fetch(`${args.host}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: args.model, prompt: buildPrompt(narrative), stream: false, options: { temperature: 0 } }),
    });
    const { category, fallback_used } = parseCategory((await res.json()).response);
    const r = { ...rows[line - 1], small_category: fallback_used ? `${category} (fallback)` : category };
    seen.push(r);
    console.log(`line ${line} row ${r.row_id} (${r.chars} chars): ${r.small_category}`);
    if (category === 'Credit card' && !fallback_used && cc.length < 2) cc.push(r);
    else if (category !== 'Credit card' && !other) other = r;
  }
  if (cc.length < 2 || !other) throw new Error('not enough warm-up candidates; raise --max-lines');

  const warm = [other, ...cc];
  const dir = path.join(ROOT, 'jmeter', 'a2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'warmup_rows.csv'),
    ['order,line,row_id,chars,small_category_when_chosen', ...warm.map((r, i) => `${i + 1},${r.line},${r.row_id},${r.chars},${r.small_category}`)].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'warmup.txt'), warm.map((r) => bodies[r.line - 1]).join('\n') + '\n', 'ascii');
  console.log(`\nWarm-ups (in order): ${warm.map((r) => `row ${r.row_id} [${r.small_category}]`).join(', ')}. Classified ${seen.length} lines with ${args.model}.`);
})().catch((e) => { console.error(e); process.exit(1); });
