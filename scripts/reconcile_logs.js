#!/usr/bin/env node
/**
 * Reconciles the kept results with data/service.log.
 *
 *   node scripts/reconcile_logs.js [repoRoot]        (default: the folder above scripts/)
 *
 * Load and stress runs (results/load/<model>/<rate>/run<N>.jtl, results/stress/<model>/stress.jtl):
 *   - the number of POST /tickets requests the service logged in the run's time window equals the number of rows in the .jtl
 *   - every classification line in that window names the run's model
 *   - JMeter's elapsed time is never below the service's own duration for the same request (sorted pairwise); the
 *     median and maximum gap are printed (the gap is network and client time)
 * Accuracy runs (results/<model>/per_ticket_results.csv):
 *   - the predicted labels equal, in order, a block of that model's classification lines in the log
 *
 * The window is [first request start - 3 s, last response + 1 s] on the load generator's clock. The laptop clock
 * ran about 1 s ahead of the desktop's, which the 3 s lead-in absorbs. Exit code 1 if anything fails to reconcile.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const tsMs = (s) => Date.parse(s);

// ---- the service log ----
const logPath = path.join(root, 'data', 'service.log');
if (!fs.existsSync(logPath)) { console.error(`Missing ${logPath}`); process.exit(1); }
const log = fs.readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const reqs = log.filter((l) => l.type === 'request' && l.method === 'POST' && l.path === '/tickets').map((l) => ({ t: tsMs(l.timestamp), d: l.duration_ms, status: l.status }));
const clss = log.filter((l) => l.type === 'classification').map((l) => ({ t: tsMs(l.timestamp), model: l.model, category: l.category }));
console.log(`service.log: ${log.length} lines, ${reqs.length} POST /tickets requests, ${clss.length} classifications\n`);

let failures = 0;
const tag = (m) => m.replace(/_/g, ':').replace(/^qwen2\.5:/, 'qwen2.5:').replace(/^granite3\.3:/, 'granite3.3:');
const modelFromFolder = (f) => f.replace(/^([a-z0-9.]+)_([0-9a-z]+)$/i, '$1:$2');

// ---- load and stress runs ----
const jtls = [];
const loadDir = path.join(root, 'results', 'load');
if (fs.existsSync(loadDir)) {
  for (const m of fs.readdirSync(loadDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const r of fs.readdirSync(path.join(loadDir, m.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const f of fs.readdirSync(path.join(loadDir, m.name, r.name)).filter((f) => f.endsWith('.jtl')).sort()) jtls.push({ model: m.name, label: `${m.name}/${r.name}/${f}`, file: path.join(loadDir, m.name, r.name, f) });
    }
  }
}
const stressDir = path.join(root, 'results', 'stress');
if (fs.existsSync(stressDir)) {
  for (const m of fs.readdirSync(stressDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const f = path.join(stressDir, m.name, 'stress.jtl');
    if (fs.existsSync(f)) jtls.push({ model: m.name, label: `${m.name}/stress.jtl`, file: f });
  }
}
console.log('LOAD AND STRESS RUNS');
console.log('run'.padEnd(34), 'rows'.padStart(5), 'log'.padStart(5), 'model'.padStart(6), 'gap median'.padStart(11), 'gap max'.padStart(8), '  result');
for (const j of jtls) {
  const rows = parseCsv(fs.readFileSync(j.file, 'utf-8'));
  const starts = rows.map((r) => Number(r.timeStamp)); const ends = rows.map((r, i) => starts[i] + Number(r.elapsed));
  const lo = Math.min(...starts) - 3000, hi = Math.max(...ends) + 1000;
  const wr = reqs.filter((x) => x.t >= lo && x.t <= hi);
  const wc = clss.filter((x) => x.t >= lo && x.t <= hi);
  const want = modelFromFolder(j.model);
  const modelOk = wc.length > 0 && wc.every((x) => x.model === want);
  const jd = rows.map((r) => Number(r.elapsed)).sort((a, b) => a - b);
  const sd = wr.map((x) => x.d).sort((a, b) => a - b);
  const sameCount = wr.length === rows.length;
  const gaps = sameCount ? jd.map((v, i) => v - sd[i]) : [];
  const gapOk = sameCount && Math.min(...gaps) >= -5;
  const ok = sameCount && modelOk && gapOk;
  if (!ok) failures++;
  console.log(j.label.padEnd(34), String(rows.length).padStart(5), String(wr.length).padStart(5), String(modelOk).padStart(6),
    (sameCount ? `${median(gaps)} ms` : '-').padStart(11), (sameCount ? `${Math.max(...gaps)} ms` : '-').padStart(8), ok ? '  OK' : '  DOES NOT RECONCILE');
}

// ---- accuracy runs ----
console.log('\nACCURACY RUNS');
for (const d of fs.readdirSync(path.join(root, 'results'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const f = path.join(root, 'results', d.name, 'per_ticket_results.csv');
  if (!fs.existsSync(f)) continue;
  const want = modelFromFolder(d.name);
  const pred = parseCsv(fs.readFileSync(f, 'utf-8')).map((r) => r.predicted_label);
  const cats = clss.filter((x) => x.model === want).map((x) => x.category);
  let at = -1;
  for (let i = 0; i + pred.length <= cats.length && at < 0; i++) { let same = true; for (let k = 0; k < pred.length; k++) if (cats[i + k] !== pred[k]) { same = false; break; } if (same) at = i; }
  if (at < 0) failures++;
  console.log(`${want.padEnd(14)} ${pred.length} predictions`.padEnd(34), at >= 0 ? `  OK (identical to that model's classification lines ${at + 1}-${at + pred.length})` : '  DOES NOT RECONCILE');
}
console.log(`\n${failures === 0 ? 'Everything reconciles.' : failures + ' item(s) do not reconcile.'}`);
process.exit(failures === 0 ? 0 : 1);
