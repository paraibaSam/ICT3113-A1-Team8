#!/usr/bin/env node
/**
 * Analyses the stress test (an arrival-rate ramp) and reports the limit it found.
 *
 * Usage:
 *   node scripts/analyse_stress.js <stress.jtl> [--from 6] [--to 48] [--minutes 15] [--window 60] [--slo 5000]
 *
 *   --from / --to   arrival rate at the start / end of the ramp, requests per MINUTE (must match the plan)
 *   --minutes       length of the ramp
 *   --window        analysis window in seconds (default 60)
 *   --slo           latency requirement in ms used to flag a breach (default 5000 = the p95 requirement)
 *
 * Requests are grouped by ARRIVAL time (the "timeStamp" column, request start), in windows from the first request.
 * Per window it reports: planned arrival rate (from the ramp), requests, mean / p50 / p95 / max latency (the "elapsed"
 * column), and the average number of requests in flight (the "allThreads" column).
 *
 * Findings reported (all definitions are printed with the result so they can be challenged):
 *   baseline         median latency over the first 3 windows, when the system is lightly loaded
 *   latency rising   first window whose p50 is at least 2x the baseline AND stays at least 2x in the next window
 *   requirement      first window whose p95 exceeds --slo and stays above it in the next window
 *   unbounded        p50 still climbing in the last windows; the slope (ms per minute) is reported
 *   capacity est.    1 / baseline mean latency (if a single request is served at a time)
 * Writes stress_windows.csv and stress_summary.md next to the .jtl.
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { file: null, from: 6, to: 48, minutes: 15, window: 60, slo: 5000 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--from') a.from = Number(argv[++i]);
    else if (k === '--to') a.to = Number(argv[++i]);
    else if (k === '--minutes') a.minutes = Number(argv[++i]);
    else if (k === '--window') a.window = Number(argv[++i]);
    else if (k === '--slo') a.slo = Number(argv[++i]);
    else if (!k.startsWith('--') && !a.file) a.file = k;
    else { console.error(`Unknown argument: ${k}`); process.exit(1); }
  }
  if (!a.file) { console.error('Usage: node scripts/analyse_stress.js <stress.jtl> [--from 6] [--to 48] [--minutes 15] [--window 60] [--slo 5000]'); process.exit(1); }
  return a;
}

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
  return rows.filter((r) => r.length > 1);
}

const pct = (sorted, p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return pct(s, 50); };
const r0 = (x) => Math.round(x);
const r2 = (x) => Math.round(x * 100) / 100;

function main() {
  const a = parseArgs(process.argv);
  const rows = parseCsv(fs.readFileSync(a.file, 'utf-8'));
  const h = rows[0];
  const col = (n) => { const i = h.indexOf(n); if (i < 0) throw new Error(`column "${n}" not found`); return i; };
  const iTs = col('timeStamp'), iEl = col('elapsed'), iOk = col('success'), iAll = h.indexOf('allThreads');
  const data = rows.slice(1).map((r) => ({ t: Number(r[iTs]), el: Number(r[iEl]), ok: r[iOk] === 'true', all: iAll >= 0 ? Number(r[iAll]) : NaN }));
  if (data.length < 20) throw new Error(`only ${data.length} samples; this does not look like the stress test`);

  const t0 = Math.min(...data.map((d) => d.t));
  const winMs = a.window * 1000;
  const nWin = Math.ceil((Math.max(...data.map((d) => d.t)) - t0 + 1) / winMs);
  const plannedRate = (tSec) => { const f = Math.min(1, tSec / (a.minutes * 60)); return a.from + (a.to - a.from) * f; };   // per minute

  const wins = [];
  for (let w = 0; w < nWin; w++) {
    const inWin = data.filter((d) => Math.floor((d.t - t0) / winMs) === w);
    if (inWin.length === 0) continue;
    const el = inWin.map((d) => d.el).sort((x, y) => x - y);
    const mid = (w + 0.5) * a.window;
    wins.push({
      minute: r2((w * a.window) / 60), planned_per_min: r2(plannedRate(mid)), planned_rps: r2(plannedRate(mid) / 60),
      n: inWin.length, errors: inWin.filter((d) => !d.ok).length,
      mean_ms: r0(mean(el)), p50_ms: pct(el, 50), p95_ms: pct(el, 95), max_ms: el[el.length - 1],
      in_flight: Number.isNaN(mean(inWin.map((d) => d.all))) ? '' : r2(mean(inWin.map((d) => d.all))),
    });
  }

  const base = wins.slice(0, 3);
  const baseP50 = median(base.map((x) => x.p50_ms));
  const baseMean = mean(base.map((x) => x.mean_ms));
  const rising = wins.findIndex((x, i) => x.p50_ms >= 2 * baseP50 && wins[i + 1] && wins[i + 1].p50_ms >= 2 * baseP50);
  const breach = wins.findIndex((x, i) => x.p95_ms > a.slo && wins[i + 1] && wins[i + 1].p95_ms > a.slo);   // two windows in a row, so one noisy window cannot trigger it
  const last = wins.slice(-3);
  const slope = last.length >= 2 ? (last[last.length - 1].p50_ms - last[0].p50_ms) / (last.length - 1) / (a.window / 60) : NaN;   // ms per minute
  const totalErr = data.filter((d) => !d.ok).length;
  const capacity = 60000 / baseMean;   // requests per minute if one request is served at a time

  const fmtWin = (w) => (w < 0 ? 'not reached' : `window starting minute ${wins[w].minute} (planned rate ${wins[w].planned_per_min}/min = ${wins[w].planned_rps} req/s)`);
  const lines = [];
  lines.push('# Stress test result', '');
  lines.push(`- File: \`${path.basename(a.file)}\`  |  requests: ${data.length}  |  errors: ${totalErr}`);
  lines.push(`- Ramp (planned): ${a.from}/min to ${a.to}/min over ${a.minutes} min; windows of ${a.window} s by arrival time`, '');
  lines.push('| Minute | Planned rate (/min) | Requests | Mean ms | p50 ms | p95 ms | Max ms | In flight |', '|---|---|---|---|---|---|---|---|');
  for (const x of wins) lines.push(`| ${x.minute} | ${x.planned_per_min} | ${x.n} | ${x.mean_ms} | ${x.p50_ms} | ${x.p95_ms} | ${x.max_ms} | ${x.in_flight} |`);
  lines.push('', '## What the test found', '');
  lines.push(`- Baseline latency (median of the first 3 windows): **${baseP50} ms** (mean ${r0(baseMean)} ms)`);
  lines.push(`- Latency starts rising (p50 at least 2x baseline for two windows in a row): **${fmtWin(rising)}**`);
  lines.push(`- Requirement breached (p95 above ${a.slo} ms for two windows in a row): **${fmtWin(breach)}**`);
  lines.push(`- Still climbing at the end: p50 slope over the last ${last.length} windows = **${r0(slope)} ms per minute** (${slope > 0 ? 'latency is still growing: no steady state at the end of the ramp' : 'latency has levelled off'})`);
  lines.push(`- Capacity estimate if one request is served at a time (1 / baseline mean): **${r2(capacity)}/min = ${r2(capacity / 60)} req/s**`);
  lines.push('', 'Reading the result: the sustainable rate is the planned rate of the window just BEFORE latency starts rising. Compare it with the capacity estimate; a gap is expected, because random arrivals make queues form before the average load reaches capacity (the variability term in the Kingman formula). Each window holds only 10 to 50 requests, so its p95 is close to its maximum: read the trend, not single windows.', '');

  const out = path.dirname(path.resolve(a.file));
  const csvCols = ['minute', 'planned_per_min', 'planned_rps', 'n', 'errors', 'mean_ms', 'p50_ms', 'p95_ms', 'max_ms', 'in_flight'];
  fs.writeFileSync(path.join(out, 'stress_windows.csv'), [csvCols.join(','), ...wins.map((x) => csvCols.map((c) => x[c]).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'stress_summary.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWrote stress_windows.csv and stress_summary.md in ${out}`);
}

main();
