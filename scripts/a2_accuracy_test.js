#!/usr/bin/env node
/**
 * A2 Phase 6a: cascade accuracy test on the 90 TEST tickets (run on the DESKTOP).
 *
 *   node scripts/a2_accuracy_test.js --config cascadeA|cascadeB|qwen7b
 *        [--allow-other-containers]   passed to the reset script
 *        [--skip-reset]               don't run scripts/a2_desktop_reset.sh (only for trying the script)
 *        [--base-url http://localhost:3000] [--log-path data/service.log] [--out-dir results/a2/accuracy_cascade]
 *
 * Steps:
 *   1. scripts/a2_desktop_reset.sh <config>: service recreated with config/a2/<config>.env, fresh Ollama,
 *      version + digests checked, startup setting checked. No warm-ups: timings are not used here and the
 *      models run at temperature 0.
 *   2. Remember the end of data/service.log, then send every row of golden-set/a2_test.csv through
 *      POST /tickets, one at a time, in file order (same as the A1 accuracy test).
 *   3. The response is {id, category} only, so read the new part of data/service.log and join each ticket's
 *      "classification" line on ticket_id. This gives small_category, escalated, large_category,
 *      fallback flags and model times (docs/escalation_rule.md §6). Every ticket must have exactly one line,
 *      with the expected cascade_setting, and its category must equal the HTTP response.
 *   4. Writes results/a2/accuracy_cascade/<config>/
 *        per_ticket_results.csv   A1 columns first (row_id, final_label, predicted_label, match, http_status,
 *                                 round_trip_ms, error), then the cascade fields
 *        service_log_section.log  the raw log lines written during the run
 *        summary.md / summary.json  accuracy, escalation and the check against the A1 records
 *
 * Check against A1 records: for each ticket, the answer the cascade *should* give if both models answer
 * exactly as in A1 (gemma3:4b's A1 answer; if it is in the escalation set, qwen2.5:7b's A1 answer).
 * Disagreements are listed. A few are possible (Ollama is not bit-for-bit deterministic on CPU), many
 * would mean something differs from A1.
 *
 * Pass/fail against the limits: run scripts/a2_score_split.js with --extra (command printed at the end).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CATEGORIES = [
  'Credit reporting',
  'Debt collection',
  'Mortgage',
  'Credit card',
  'Bank account or service',
  'Consumer loan',
  'Money transfer or service',
];
const CONFIGS = {
  qwen7b: { setting: 'single', label: 'qwen2.5:7b (rerun)', escalate: null },
  cascadeA: { setting: 'A', label: 'Cascade A', escalate: ['Credit card'] },
  cascadeB: { setting: 'B', label: 'Cascade B', escalate: ['Debt collection', 'Credit card'] },
};
const SMALL_A1 = path.join(ROOT, 'results', 'gemma3_4b', 'per_ticket_results.csv');
const LARGE_A1 = path.join(ROOT, 'results', 'qwen2.5_7b', 'per_ticket_results.csv');

// ---- args
const args = {
  config: null,
  reset: true,
  allowOthers: false,
  baseUrl: 'http://localhost:3000',
  logPath: path.join(ROOT, 'data', 'service.log'),
  outDir: path.join(ROOT, 'results', 'a2', 'accuracy_cascade'),
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--config') args.config = process.argv[++i];
  else if (a === '--skip-reset') args.reset = false;
  else if (a === '--allow-other-containers') args.allowOthers = true;
  else if (a === '--base-url') args.baseUrl = process.argv[++i];
  else if (a === '--log-path') args.logPath = path.resolve(process.argv[++i]);
  else if (a === '--out-dir') args.outDir = path.resolve(process.argv[++i]);
  else { console.error(`Unknown argument: ${a}`); process.exit(1); }
}
if (!CONFIGS[args.config]) {
  console.error('Usage: node scripts/a2_accuracy_test.js --config cascadeA|cascadeB|qwen7b [--allow-other-containers] [--skip-reset]');
  process.exit(1);
}
const CFG = CONFIGS[args.config];

// ---- csv helpers
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const readCsv = (p) => parseCsv(fs.readFileSync(p, 'utf8'));
const esc = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const pct = (c, n) => (n ? `${((100 * c) / n).toFixed(1)}%` : 'n/a');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (c) => c.split(' ').map((w) => w[0].toUpperCase()).join('');

async function post(narrative) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${args.baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrative }),
      signal: AbortSignal.timeout(900_000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { status: res.status, ms, error: `HTTP ${res.status}` };
    const d = await res.json();
    return { status: res.status, ms, id: d.id, category: d.category };
  } catch (e) {
    return { status: '', ms: Date.now() - t0, error: e.message };
  }
}

// Read log lines written after byte `offset`; wait until every ticket id has its classification line.
async function readLogSection(offset, ids) {
  let lines = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const buf = fs.readFileSync(args.logPath);
    lines = buf.subarray(offset).toString('utf8').split('\n').filter((l) => l.trim());
    const got = new Set(lines.map((l) => { try { return JSON.parse(l); } catch { return {}; } })
      .filter((e) => e.type === 'classification').map((e) => e.ticket_id));
    if (ids.every((id) => got.has(id))) break;
    await sleep(500);
  }
  return lines;
}

async function main() {
  const tickets = readCsv(path.join(ROOT, 'golden-set', 'a2_test.csv'));
  if (tickets.length !== 90) throw new Error(`expected 90 test tickets, found ${tickets.length}`);

  // 1. reset
  let resetLine = 'skipped (--skip-reset)';
  if (args.reset) {
    const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'a2_desktop_reset.sh'), args.config, ...(args.allowOthers ? ['--allow-other-containers'] : [])], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) throw new Error(`reset script failed (exit ${r.status}); nothing was sent`);
    resetLine = (r.stdout || '').split('\n').find((l) => l.startsWith('READY')) || 'ok';
  }

  // 2. send
  const offset = fs.existsSync(args.logPath) ? fs.statSync(args.logPath).size : 0;
  const started = new Date().toISOString();
  console.log(`${CFG.label}: sending ${tickets.length} test tickets to ${args.baseUrl} ...`);
  const sent = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const r = await post(t.narrative);
    sent.push({ t, r });
    if ((i + 1) % 10 === 0 || r.error) {
      const errs = sent.filter((x) => x.r.error).length;
      console.log(`  ${i + 1}/${tickets.length} (${errs} errors)${r.error ? `  row ${t.row_id}: ${r.error}` : ''}`);
    }
  }
  const finished = new Date().toISOString();

  // 3. join with the service log
  const ids = sent.filter((x) => x.r.id !== undefined).map((x) => x.r.id);
  const section = await readLogSection(offset, ids);
  const entries = section.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byId = new Map();
  const problems = [];
  for (const e of entries.filter((x) => x.type === 'classification')) {
    if (byId.has(e.ticket_id)) problems.push(`ticket_id ${e.ticket_id} has more than one classification line`);
    byId.set(e.ticket_id, e);
  }
  const startups = entries.filter((e) => e.type === 'startup');
  if (startups.length) problems.push(`the service restarted during the run (${startups.length} startup line(s))`);
  const errLines = entries.filter((e) => e.type === 'error');
  if (errLines.length) problems.push(`${errLines.length} error line(s) in the service log`);

  const A1small = new Map(readCsv(SMALL_A1).map((r) => [r.row_id, r.predicted_label]));
  const A1large = new Map(readCsv(LARGE_A1).map((r) => [r.row_id, r.predicted_label]));

  const out = sent.map(({ t, r }) => {
    const e = r.id !== undefined ? byId.get(r.id) : undefined;
    if (r.id !== undefined && !e) problems.push(`row ${t.row_id} (ticket ${r.id}): no classification line in the log`);
    if (e && e.cascade_setting !== CFG.setting) problems.push(`row ${t.row_id}: log says setting ${e.cascade_setting}, expected ${CFG.setting}`);
    if (e && e.category !== r.category) problems.push(`row ${t.row_id}: response ${r.category} but log ${e.category}`);
    const predicted = r.category || '';
    const expected = CFG.escalate
      ? (CFG.escalate.includes(A1small.get(t.row_id)) ? A1large.get(t.row_id) : A1small.get(t.row_id))
      : A1large.get(t.row_id);
    return {
      row_id: t.row_id,
      final_label: t.final_label,
      predicted_label: predicted,
      match: predicted === t.final_label,
      http_status: r.status,
      round_trip_ms: r.ms,
      error: r.error || '',
      ticket_id: r.id ?? '',
      model: e?.model ?? '',
      classification_ms: e?.classification_ms ?? '',
      small_category: e?.small_category ?? '',
      small_fallback_used: e?.small_fallback_used ?? '',
      small_ms: e?.small_ms ?? '',
      escalated: e ? (e.escalated ?? false) : '',
      large_category: e?.large_category ?? '',
      large_ms: e?.large_ms ?? '',
      fallback_used: e?.fallback_used ?? '',
      a1_expected: expected || '',
      agrees_with_a1: predicted !== '' && predicted === expected,
    };
  });

  // 4. write
  const dir = path.join(args.outDir, args.config);
  fs.mkdirSync(dir, { recursive: true });
  const cols = Object.keys(out[0]);
  fs.writeFileSync(path.join(dir, 'per_ticket_results.csv'), [cols.join(','), ...out.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'service_log_section.log'), section.join('\n') + '\n');

  const n = out.length;
  const correct = out.filter((r) => r.match).length;
  const errors = out.filter((r) => r.error).length;
  const isCascade = !!CFG.escalate;
  const escRows = out.filter((r) => r.escalated === true);
  const accRows = out.filter((r) => r.escalated === false);
  const perCat = Object.fromEntries(CATEGORIES.map((c) => {
    const rs = out.filter((r) => r.final_label === c);
    return [c, { n: rs.length, correct: rs.filter((r) => r.match).length, escalated: rs.filter((r) => r.escalated === true).length }];
  }));
  const matrix = Object.fromEntries(CATEGORIES.map((a) => [a, Object.fromEntries([...CATEGORIES, 'Err'].map((p) => [p, 0]))]));
  for (const r of out) matrix[r.final_label][CATEGORIES.includes(r.predicted_label) ? r.predicted_label : 'Err']++;
  const disagree = out.filter((r) => !r.agrees_with_a1);
  const changed = isCascade ? escRows.filter((r) => r.small_category !== r.predicted_label) : [];
  const fixedByLarge = changed.filter((r) => r.match).length;
  const brokenByLarge = changed.filter((r) => r.small_category === r.final_label).length;

  const summary = {
    config: args.config, label: CFG.label, setting: CFG.setting, escalate_set: CFG.escalate,
    reset: resetLine, started_utc: started, finished_utc: finished,
    n, correct, accuracy: correct / n, errors,
    escalated: isCascade ? escRows.length : null,
    escalation_fraction: isCascade ? escRows.length / n : null,
    accepted: isCascade ? { n: accRows.length, correct: accRows.filter((r) => r.match).length } : null,
    escalated_acc: isCascade ? { n: escRows.length, correct: escRows.filter((r) => r.match).length } : null,
    large_changed_answer: isCascade ? { n: changed.length, fixed: fixedByLarge, broke: brokenByLarge } : null,
    small_fallbacks: isCascade ? out.filter((r) => r.small_fallback_used === true).length : null,
    final_fallbacks: out.filter((r) => r.fallback_used === true).length,
    per_category: perCat, confusion: matrix,
    agrees_with_a1_records: n - disagree.length,
    disagreements: disagree.map((r) => ({ row_id: r.row_id, live: r.predicted_label, a1_expected: r.a1_expected })),
    problems,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  const L = [];
  L.push(`# A2 accuracy test: ${CFG.label}`, '');
  L.push(`Generated by \`scripts/a2_accuracy_test.js --config ${args.config}\`. 90 test tickets (\`golden-set/a2_test.csv\`) sent one at a time through \`POST /tickets\`, ${started} to ${finished}.`);
  L.push(`Reset: ${resetLine}. Per-ticket escalation details come from \`data/service.log\` (copied to \`service_log_section.log\`).`, '');
  if (problems.length || errors) {
    L.push('## ⚠️ Problems (do not use these results until resolved)', '');
    if (errors) L.push(`- ${errors} request(s) failed; see per_ticket_results.csv`);
    for (const p of problems) L.push(`- ${p}`);
    L.push('');
  }
  L.push('## Result', '');
  L.push(`- **Overall: ${correct}/${n} = ${pct(correct, n)}**`);
  if (isCascade) {
    L.push(`- Escalation set: ${CFG.escalate.map((c) => `*${c}*`).join(', ')} (gemma3:4b's predicted category)`);
    L.push(`- **Escalated: ${escRows.length}/${n} = ${pct(escRows.length, n)}**`);
    L.push(`- Accepted from gemma3:4b: ${summary.accepted.correct}/${summary.accepted.n} right (${pct(summary.accepted.correct, summary.accepted.n)})`);
    L.push(`- Escalated, answered by qwen2.5:7b: ${summary.escalated_acc.correct}/${summary.escalated_acc.n} right (${pct(summary.escalated_acc.correct, summary.escalated_acc.n)})`);
    L.push(`- qwen2.5:7b changed gemma3:4b's answer on ${changed.length} escalated ticket(s): ${fixedByLarge} now right, ${brokenByLarge} were right before and now wrong`);
    L.push(`- gemma3:4b fallback answers (unparseable, accepted as Credit reporting): ${summary.small_fallbacks}`);
  }
  L.push(`- Final answers that were parser fallbacks: ${summary.final_fallbacks}`);
  L.push(`- Matches the answer predicted from the A1 records: ${n - disagree.length}/${n}${disagree.length ? ` (differs on rows ${disagree.map((r) => `${r.row_id}: live ${short(r.predicted_label || 'Err')}, A1 ${short(r.a1_expected || 'Err')}`).join('; ')})` : ''}`, '');
  L.push('Pass/fail against the A2 limits is in `results/a2/accuracy_all/summary.md` (`scripts/a2_score_split.js --extra`).', '');
  L.push('## Per category', '');
  L.push(`| Category | Right/n | Accuracy |${isCascade ? ' Escalated |' : ''}`);
  L.push(`|---|---|---|${isCascade ? '---|' : ''}`);
  for (const c of CATEGORIES) {
    const x = perCat[c];
    L.push(`| ${c} | ${x.correct}/${x.n} | ${pct(x.correct, x.n)} |${isCascade ? ` ${x.escalated}/${x.n} |` : ''}`);
  }
  L.push('', '## Confusion matrix (rows = actual, columns = final answer)', '');
  L.push(`| Actual \\ Pred | ${[...CATEGORIES.map(short), 'Err'].join(' | ')} |`);
  L.push(`|---|${[...CATEGORIES, 'Err'].map(() => '---').join('|')}|`);
  for (const a of CATEGORIES) L.push(`| ${a} | ${[...CATEGORIES, 'Err'].map((p) => matrix[a][p]).join(' | ')} |`);
  L.push('', `Column key: ${CATEGORIES.map((c) => `${short(c)} = ${c}`).join('; ')}; Err = request failed.`, '');
  fs.writeFileSync(path.join(dir, 'summary.md'), L.join('\n'));

  console.log('');
  console.log(`${CFG.label}: ${correct}/${n} = ${pct(correct, n)}${isCascade ? `, escalated ${escRows.length}/${n} = ${pct(escRows.length, n)}` : ''}, matches A1 records ${n - disagree.length}/${n}`);
  console.log(`Wrote ${path.relative(ROOT, dir)}/`);
  if (problems.length || errors) {
    console.log(`PROBLEMS (${errors} failed requests, ${problems.length} log problems):`);
    for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
    process.exitCode = 2;
  }
  console.log('\nScore against the limits once both settings have run:');
  console.log('  node scripts/a2_score_split.js --out results/a2/accuracy_all \\');
  console.log('    --extra "Cascade A=results/a2/accuracy_cascade/cascadeA/per_ticket_results.csv" \\');
  console.log('    --extra "Cascade B=results/a2/accuracy_cascade/cascadeB/per_ticket_results.csv"');
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
