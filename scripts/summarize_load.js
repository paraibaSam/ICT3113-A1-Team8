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
 *   node scripts/summarize_load.js --a2 [repoRoot]  A2 speed runs, see a2Main() below
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

// successOnly (A2): latency statistics from successful requests only, as the A2 brief defines p50/p95.
// A1 (default) used every row; kept so the A1 summaries are reproduced unchanged.
function summariseJtl(file, successOnly = false) {
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
  const latencies = successOnly ? elapsed.filter((_, i) => data[i][iOk] === 'true') : elapsed;
  const sorted = [...latencies].sort((a, b) => a - b);
  const spanSec = (Math.max(...ends) - Math.min(...starts)) / 1000;
  const arrivalSpanSec = (Math.max(...starts) - Math.min(...starts)) / 1000;

  return {
    n: data.length,
    errors,
    error_pct: (100 * errors) / data.length,
    mean_ms: mean(latencies),
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
  if (process.argv[2] === '--a2') return a2Main(path.resolve(process.argv[3] || path.join(__dirname, '..')));
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

/**
 * A2 (Step 4/5): results/a2/speed/<config>/run<N>.jtl (+ meta.json), the service log, and the accuracy results.
 * Writes results/a2/speed/speed_per_run.csv, speed_summary.csv, speed_summary.md, speed_summary.json.
 *
 *   latency        elapsed time of SUCCESSFUL requests only (brief, Step 4); errors are counted separately
 *   p50            per run (nearest-rank), then the mean and [min-max] across runs
 *   p95            from all runs of a configuration pooled (n stated); no p99 (too few samples)
 *   throughput     completed (successful) requests / (last end - first start) in seconds
 *   error rate     rows whose "success" is not "true", pooled
 *   unfinished     requests cut off by the response timeout (from the run's meta.json)
 *   escalation     classification lines with escalated=true / all classification lines in the run's log section
 *   model times    the service's own small_ms / large_ms (or classification_ms) under load, from the log
 *   accuracy       results/a2/accuracy_all/summary.json (scripts/a2_score_split.js --extra) if it exists
 */
function a2Main(repo) {
  const a2 = require('./lib/a2_speed_runs');
  const out = path.join(repo, 'results', 'a2', 'speed');
  const runs = a2.findRuns(repo);
  if (!runs.length) { console.error(`No A2 runs under ${out} (expected <config>/run<N>.jtl)`); process.exit(1); }
  const log = a2.readLog(repo);

  const perRun = runs.map((r) => {
    const s = summariseJtl(r.file, true);
    const sec = a2.logSection(log, r);
    const cls = sec.classifications;
    const esc = cls.filter((c) => c.escalated === true);
    const spanSec = (Date.parse(s.last_end_utc) - Date.parse(s.first_start_utc)) / 1000;
    return {
      config: r.config, name: r.name, run: r.run, n: s.n, succeeded: s.n - s.errors, errors: s.errors, error_pct: s.error_pct,
      unfinished: r.meta ? r.meta.unfinished_cut_off : '', stats_delta: r.meta ? r.meta.completed_by_service : '',
      p50_ms: s.p50_ms, p95_ms: s.p95_ms, mean_ms: s.mean_ms, max_ms: s.max_ms,
      throughput_rps: (s.n - s.errors) / spanSec, arrival_rps: s.arrival_rps,
      escalated: r.setting === 'single' ? '' : esc.length, classified: cls.length,
      escalation_pct: r.setting === 'single' || !cls.length ? '' : (100 * esc.length) / cls.length,
      small_ms_mean: r.small ? mean(cls.map((c) => c.small_ms)) : '',
      large_ms_mean_escalated: r.small ? (esc.length ? mean(esc.map((c) => c.large_ms)) : '') : (cls.length ? mean(cls.map((c) => c.classification_ms)) : ''),
      first_start_utc: s.first_start_utc, last_end_utc: s.last_end_utc,
      _elapsed: r.rows.filter((x) => x.success === 'true').map((x) => Number(x.elapsed)), _cls: cls, _esc: esc.length,
    };
  });

  const fmt = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, typeof v === 'number' ? round(v, k.endsWith('_rps') ? 3 : 1) : v]));
  const runCols = Object.keys(fmt(perRun[0]));
  fs.writeFileSync(path.join(out, 'speed_per_run.csv'), toCsv(runCols, perRun.map(fmt)));

  let accuracy = null;
  const accFile = path.join(repo, 'results', 'a2', 'accuracy_all', 'summary.json');
  if (fs.existsSync(accFile)) accuracy = JSON.parse(fs.readFileSync(accFile, 'utf-8'));
  const accTestEsc = (cfg) => {
    const f = path.join(repo, 'results', 'a2', 'accuracy_cascade', cfg, 'summary.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')).escalation_fraction : null;
  };

  const groups = [];
  for (const cfg of Object.keys(a2.CONFIGS)) {
    const g = perRun.filter((r) => r.config === cfg);
    if (!g.length) continue;
    const all = g.flatMap((r) => r._elapsed).sort((a, b) => a - b);
    const cls = g.flatMap((r) => r._cls);
    const nEsc = g.reduce((a, r) => a + r._esc, 0);
    const isCascade = a2.CONFIGS[cfg].setting !== 'single';
    const acc = accuracy?.configs.find((c) => c.name === a2.CONFIGS[cfg].name);
    const p50s = g.map((r) => r.p50_ms);
    const totalN = g.reduce((a, r) => a + r.n, 0), totalErr = g.reduce((a, r) => a + r.errors, 0);
    groups.push({
      config: cfg, name: a2.CONFIGS[cfg].name, runs: g.length, n_per_run: g.map((r) => r.n).join('/'),
      p50_runs: p50s.join('/'), p50_mean: mean(p50s), p50_min: Math.min(...p50s), p50_max: Math.max(...p50s), p50_sd: sd(p50s),
      p95_pooled: percentile(all, 95), pooled_n: all.length,
      throughput_mean: mean(g.map((r) => r.throughput_rps)), errors: totalErr, error_pct: (100 * totalErr) / totalN,
      unfinished: g.reduce((a, r) => a + (Number(r.unfinished) || 0), 0),
      escalation_load_pct: isCascade && cls.length ? (100 * nEsc) / cls.length : '',
      escalation_test_pct: isCascade && accTestEsc(cfg) !== null ? 100 * accTestEsc(cfg) : '',
      small_ms_mean: isCascade ? mean(cls.map((c) => c.small_ms)) : '',
      large_ms_mean: isCascade ? (nEsc ? mean(cls.filter((c) => c.escalated === true).map((c) => c.large_ms)) : '') : mean(cls.map((c) => c.classification_ms)),
      accuracy: acc ? `${acc.test.correct}/${acc.test.n}` : '', accuracy_pct: acc ? acc.test.acc : '',
      passes_accuracy: acc ? acc.pass : '', failed_categories: acc ? acc.failedCats.join('; ') : '',
    });
  }
  const ref = groups.find((g) => g.config === 'qwen7b');
  for (const g of groups) {
    g.p50_vs_qwen = ref ? g.p50_mean / ref.p50_mean : '';
    g.p95_vs_qwen = ref ? g.p95_pooled / ref.p95_pooled : '';
  }
  const gfmt = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'number' ? round(v, k.endsWith('_qwen') || k.startsWith('throughput') ? 3 : 1) : v]));
  fs.writeFileSync(path.join(out, 'speed_summary.csv'), toCsv(Object.keys(gfmt(groups[0])), groups.map(gfmt)));
  fs.writeFileSync(path.join(out, 'speed_summary.json'), JSON.stringify({ per_run: perRun.map(fmt), configs: groups.map(gfmt) }, null, 2) + '\n');

  const s1 = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '-');
  const p1 = (x) => (x === '' || x === null ? '-' : `${round(x, 1)}%`);
  const md = ['# A2 speed test summary', ''];
  md.push('Generated by `node scripts/summarize_load.js --a2` from `results/a2/speed/<config>/run<N>.jtl`, `data/service.log` and `results/a2/accuracy_all/summary.json`. Times in seconds. Every figure can be traced to a `.jtl` file or the service log (`node scripts/reconcile_logs.js`).', '');
  md.push('## Per run', '');
  md.push('| Config | Run | Sent | OK | Errors | Unfinished | /stats Δ | p50 | p95 | Max | Throughput (req/s) | Escalated under load |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of perRun) md.push(`| ${r.name} | ${r.run} | ${r.n} | ${r.succeeded} | ${r.errors} | ${r.unfinished} | ${r.stats_delta} | ${s1(r.p50_ms)} | ${s1(r.p95_ms)} | ${s1(r.max_ms)} | ${round(r.throughput_rps, 3)} | ${r.escalated === '' ? '-' : `${r.escalated}/${r.classified} (${p1(r.escalation_pct)})`} |`);
  md.push('', 'Per-run p95 rests on about 2 requests above it, so only the pooled p95 below is used for comparison.', '');
  md.push('## Per configuration', '');
  md.push('| Config | Runs (n) | p50 per run | p50 mean [min-max] | p95 pooled (n) | p50 / p95 vs qwen2.5:7b | Throughput | Errors | Unfinished | Escalation: load / test | Accuracy (test) | Passes limits |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const g of groups) {
    md.push(`| ${g.name} | ${g.runs} (${g.n_per_run}) | ${g.p50_runs.split('/').map((x) => s1(Number(x))).join(' / ')} | ${s1(g.p50_mean)} [${s1(g.p50_min)}-${s1(g.p50_max)}] | ${s1(g.p95_pooled)} (${g.pooled_n}) | ${ref ? `${g.p50_vs_qwen.toFixed(2)}× / ${g.p95_vs_qwen.toFixed(2)}×` : '-'} | ${round(g.throughput_mean, 3)} | ${g.errors} (${p1(g.error_pct)}) | ${g.unfinished} | ${g.escalation_load_pct === '' ? '-' : `${p1(g.escalation_load_pct)} / ${p1(g.escalation_test_pct)}`} | ${g.accuracy ? `${g.accuracy} (${p1(g.accuracy_pct)})` : 'not scored yet'} | ${g.passes_accuracy === '' ? '?' : g.passes_accuracy ? 'yes' : `**no** (${g.failed_categories || 'overall'})`} |`);
  }
  md.push('', '## Why the cascade is faster or slower (model times under load, from the service log)', '');
  md.push('Expected cascade time per ticket ≈ small-model time + escalation fraction × large-model time. Queueing at this arrival rate adds to all configurations.', '');
  md.push('| Config | Small model mean | Large model mean (escalated only for cascades) | Escalation under load | Estimate: small + f × large |', '|---|---|---|---|---|');
  for (const g of groups) {
    if (g.small_ms_mean === '') md.push(`| ${g.name} | - | ${s1(g.large_ms_mean)} | - | ${s1(g.large_ms_mean)} |`);
    else md.push(`| ${g.name} | ${s1(g.small_ms_mean)} | ${s1(g.large_ms_mean)} | ${p1(g.escalation_load_pct)} | ${s1(g.small_ms_mean + (g.escalation_load_pct / 100) * (Number(g.large_ms_mean) || 0))} |`);
  }
  md.push('');
  const passing = groups.filter((g) => g.passes_accuracy === true).sort((a, b) => a.p50_mean - b.p50_mean);
  md.push('## Fastest configuration within the accuracy limits', '');
  if (!accuracy) md.push('Accuracy not scored yet: run `scripts/a2_score_split.js --extra` (see `A2_PLAN.md` Phase 6a), then re-run this script.');
  else if (!passing.length) md.push('No speed-tested configuration passes both accuracy limits.');
  else {
    const best = passing[0];
    const p95Best = [...passing].sort((a, b) => a.p95_pooled - b.p95_pooled)[0];
    md.push(`By mean p50: **${best.name}** (p50 ${s1(best.p50_mean)} s, pooled p95 ${s1(best.p95_pooled)} s${ref && best !== ref ? `; ${best.p50_vs_qwen.toFixed(2)}× and ${best.p95_vs_qwen.toFixed(2)}× qwen2.5:7b alone` : ''}).`);
    if (p95Best !== best) md.push('', `Note: by pooled p95 the fastest is ${p95Best.name} (${s1(p95Best.p95_pooled)} s). Say which measure the recommendation uses and why.`);
    const overlap = passing.length > 1 && passing[1].p50_min <= best.p50_max;
    if (overlap) md.push('', `Note: the p50 ranges of ${best.name} and ${passing[1].name} overlap across runs, so the difference may be within run-to-run spread.`);
  }
  md.push('');
  fs.writeFileSync(path.join(out, 'speed_summary.md'), md.join('\n'));

  console.log(`Read ${runs.length} A2 run(s). Wrote results/a2/speed/speed_per_run.csv, speed_summary.csv, speed_summary.json, speed_summary.md`);
  for (const g of groups) console.log(`${g.name.padEnd(11)} runs=${g.runs} p50 mean=${s1(g.p50_mean)} s [${s1(g.p50_min)}-${s1(g.p50_max)}] p95 pooled=${s1(g.p95_pooled)} s (n=${g.pooled_n}) errors=${g.errors}${g.escalation_load_pct === '' ? '' : ` escalated=${p1(g.escalation_load_pct)}`} accuracy=${g.accuracy || '?'} pass=${g.passes_accuracy === '' ? '?' : g.passes_accuracy}`);
}

main();
