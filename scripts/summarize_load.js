#!/usr/bin/env node
/**
 * Summarises JMeter result files (.jtl, CSV format) for the load tests.
 *
 * Expected layout (one .jtl per run):
 *   results/load/<model>/<rate>/run1.jtl, run2.jtl, run3.jtl
 *   e.g. results/load/gemma3_1b/0.10rps/run1.jtl
 *
 * Usage:
 *   node scripts/summarize_load.js [rootDir]        (default: <repo>/results/load)
 *
 * Writes into rootDir:
 *   per_run_summary.csv   one row per run
 *   load_summary.csv      one row per model + rate (mean, min, max and sd across runs)
 *   load_summary.md       the same, as tables ready to paste into the report
 *
 * Definitions (so every number can be reproduced from the .jtl):
 *   latency        = the "elapsed" column (ms): request sent -> full response received
 *   percentiles    = nearest-rank: the smallest value with at least p% of samples at or below it
 *   throughput     = samples / ((last end time - first start time) in seconds), where end = timeStamp + elapsed
 *   arrival rate   = (samples - 1) / ((last start - first start) in seconds)   i.e. what JMeter actually offered
 *   error          = a row whose "success" column is not "true" (HTTP 4xx/5xx, timeouts, connection errors)
 */
const fs = require('fs');
const path = require('path');

// ---- CSV parsing (quoted fields, embedded commas/newlines, "" escapes) ----
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ---- statistics ----
const percentile = (sortedAsc, p) => sortedAsc[Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)));
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : NaN);

function summariseJtl(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf-8')).filter((r) => r.length > 1);
  const header = rows[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${file}: column "${name}" not found (is this a CSV .jtl with a header row?)`);
    return i;
  };
  const iTs = col('timeStamp'), iEl = col('elapsed'), iOk = col('success');
  const data = rows.slice(1);
  if (data.length === 0) throw new Error(`${file}: no samples`);

  const starts = data.map((r) => Number(r[iTs]));
  const elapsed = data.map((r) => Number(r[iEl]));
  const ends = starts.map((s, i) => s + elapsed[i]);
  const errors = data.filter((r) => r[iOk] !== 'true').length;
  const sorted = [...elapsed].sort((a, b) => a - b);
  const spanSec = (Math.max(...ends) - Math.min(...starts)) / 1000;
  const arrivalSpanSec = (Math.max(...starts) - Math.min(...starts)) / 1000;

  return {
    n: data.length,
    errors,
    error_pct: (100 * errors) / data.length,
    mean_ms: mean(elapsed),
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted[sorted.length - 1],
    throughput_rps: data.length / spanSec,
    arrival_rps: data.length > 1 ? (data.length - 1) / arrivalSpanSec : NaN,
    first_start_utc: new Date(Math.min(...starts)).toISOString(),
    last_end_utc: new Date(Math.max(...ends)).toISOString(),
  };
}

// ---- find <root>/<model>/<rate>/*.jtl ----
function findRuns(root) {
  const runs = [];
  for (const model of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const modelDir = path.join(root, model.name);
    for (const rate of fs.readdirSync(modelDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const rateDir = path.join(modelDir, rate.name);
      for (const f of fs.readdirSync(rateDir).filter((f) => f.toLowerCase().endsWith('.jtl')).sort()) {
        runs.push({ model: model.name, rate: rate.name, run: path.basename(f, path.extname(f)), file: path.join(rateDir, f) });
      }
    }
  }
  return runs;
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h] ?? '')).join(','))].join('\n') + '\n';
const rateValue = (label) => parseFloat(label) || 0;

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'results', 'load'));
  if (!fs.existsSync(root)) { console.error(`Folder not found: ${root}`); process.exit(1); }
  const runs = findRuns(root);
  if (runs.length === 0) { console.error(`No .jtl files found under ${root} (expected <model>/<rate>/runN.jtl)`); process.exit(1); }

  const perRun = runs.map((r) => ({ model: r.model, rate: r.rate, run: r.run, ...summariseJtl(r.file) }));
  perRun.sort((a, b) => a.model.localeCompare(b.model) || rateValue(a.rate) - rateValue(b.rate) || a.run.localeCompare(b.run));

  const perRunCols = ['model', 'rate', 'run', 'n', 'errors', 'error_pct', 'mean_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms', 'throughput_rps', 'arrival_rps', 'first_start_utc', 'last_end_utc'];
  const fmtRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round(v, k.endsWith('_rps') ? 3 : 1) : v]));
  fs.writeFileSync(path.join(root, 'per_run_summary.csv'), toCsv(perRunCols, perRun.map(fmtRow)));

  // aggregate across runs of the same model + rate
  const groups = new Map();
  for (const r of perRun) {
    const key = `${r.model}\u0000${r.rate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const metrics = ['p50_ms', 'p95_ms', 'p99_ms', 'throughput_rps', 'arrival_rps', 'error_pct'];
  const agg = [];
  for (const [, g] of groups) {
    const row = { model: g[0].model, rate: g[0].rate, runs: g.length, n_per_run: g.map((x) => x.n).join('/') };
    for (const m of metrics) {
      const xs = g.map((x) => x[m]);
      const d = m.endsWith('_rps') ? 3 : 1;
      row[`${m}_mean`] = round(mean(xs), d);
      row[`${m}_min`] = round(Math.min(...xs), d);
      row[`${m}_max`] = round(Math.max(...xs), d);
      row[`${m}_sd`] = round(sd(xs), d);
    }
    agg.push(row);
  }
  agg.sort((a, b) => a.model.localeCompare(b.model) || rateValue(a.rate) - rateValue(b.rate));
  const aggCols = ['model', 'rate', 'runs', 'n_per_run', ...metrics.flatMap((m) => [`${m}_mean`, `${m}_min`, `${m}_max`, `${m}_sd`])];
  fs.writeFileSync(path.join(root, 'load_summary.csv'), toCsv(aggCols, agg));

  const md = [];
  md.push('# Load test summary', '');
  md.push('Each cell is the mean across runs, with [min-max] in brackets. Latency in ms, throughput and arrival rate in requests/second, error in %.', '');
  md.push('| Model | Rate | Runs (n per run) | p50 | p95 | p99 | Throughput | Arrival rate | Error % |', '|---|---|---|---|---|---|---|---|---|');
  const cell = (r, m) => `${r[`${m}_mean`]} [${r[`${m}_min`]}-${r[`${m}_max`]}]`;
  for (const r of agg) {
    md.push(`| ${r.model} | ${r.rate} | ${r.runs} (${r.n_per_run}) | ${cell(r, 'p50_ms')} | ${cell(r, 'p95_ms')} | ${cell(r, 'p99_ms')} | ${cell(r, 'throughput_rps')} | ${cell(r, 'arrival_rps')} | ${cell(r, 'error_pct')} |`);
  }
  md.push('', 'Percentiles are nearest-rank. With few samples per run the p95 and p99 rest on only a handful of requests; the n per run is shown so this can be judged.', '');
  fs.writeFileSync(path.join(root, 'load_summary.md'), md.join('\n'));

  console.log(`Read ${runs.length} run(s) under ${root}`);
  console.log(`Wrote per_run_summary.csv, load_summary.csv, load_summary.md`);
  const short = perRun.map((r) => `${r.model.padEnd(14)} ${r.rate.padEnd(9)} ${r.run.padEnd(5)} n=${String(r.n).padStart(3)} err=${r.errors} p50=${round(r.p50_ms, 0)} p95=${round(r.p95_ms, 0)} p99=${round(r.p99_ms, 0)} thr=${round(r.throughput_rps, 3)} arr=${round(r.arrival_rps, 3)}`);
  console.log(short.join('\n'));
}

main();
