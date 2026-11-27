/**
 * Shared by scripts/summarize_load.js --a2 and scripts/reconcile_logs.js: finds the A2 speed runs and cuts
 * each run's section out of data/service.log.
 *
 * Runs: results/a2/speed/<config>/run<N>.jtl with run<N>.meta.json (written by scripts/a2_run_speed.ps1).
 *
 * A run's log section. Every speed run follows a desktop reset, then 3 warm-ups, then JMeter, so:
 *   start = just after the last warm-up: its classification line (found by the ticket id the runner recorded in
 *           meta.warmups) and the POST /tickets request line that follows it. This excludes the warm-ups exactly,
 *           even when JMeter's first arrival comes a second after the last warm-up.
 *   end   = the last JMeter response + 3 s (load generator clock; the laptop ran about 1 s ahead of the
 *           desktop in A1), or the next service startup line, whichever comes first.
 * If the warm-up ids are missing from the meta file, the A1 window is used instead
 * ([first request start - 3 s, last response + 3 s]) and `window` says so.
 */
const fs = require('fs');
const path = require('path');

const CONFIGS = {
  qwen7b: { name: 'qwen2.5:7b', setting: 'single', models: ['qwen2.5:7b'], small: null, large: 'qwen2.5:7b' },
  cascadeA: { name: 'Cascade A', setting: 'A', models: ['gemma3:4b', 'qwen2.5:7b'], small: 'gemma3:4b', large: 'qwen2.5:7b' },
  cascadeB: { name: 'Cascade B', setting: 'B', models: ['gemma3:4b', 'qwen2.5:7b'], small: 'gemma3:4b', large: 'qwen2.5:7b' },
};

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

function readLog(root) {
  const p = path.join(root, 'data', 'service.log');
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  return fs.readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim()).map((l, i) => { const e = JSON.parse(l); return { ...e, _i: i, _t: Date.parse(e.timestamp) }; });
}

function findRuns(root) {
  const dir = path.join(root, 'results', 'a2', 'speed');
  const runs = [];
  if (!fs.existsSync(dir)) return runs;
  for (const config of Object.keys(CONFIGS)) {
    const d = path.join(dir, config);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => /^run\d+\.jtl$/.test(f)).sort()) {
      const base = f.replace(/\.jtl$/, '');
      const metaPath = path.join(d, `${base}.meta.json`);
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8').replace(/^﻿/, '')) : null;
      const rows = parseCsv(fs.readFileSync(path.join(d, f), 'utf-8'));
      runs.push({ config, ...CONFIGS[config], run: base, label: `${config}/${base}`, file: path.join(d, f), meta, rows });
    }
  }
  return runs;
}

const isTicketPost = (e) => e.type === 'request' && e.method === 'POST' && e.path === '/tickets';

function logSection(log, run) {
  const starts = run.rows.map((r) => Number(r.timeStamp));
  const ends = run.rows.map((r, i) => starts[i] + Number(r.elapsed));
  const firstStart = Math.min(...starts);
  const hi = Math.max(...ends) + 3000;

  let from = -1, window;
  const warmIds = (run.meta?.warmups || []).map((w) => w.id).filter((x) => x !== undefined && x !== null);
  if (warmIds.length) {
    const lastId = warmIds[warmIds.length - 1];
    // the last warm-up classification with that id before JMeter started (ids can repeat if the DB was ever reset)
    const hit = log.filter((e) => e.type === 'classification' && e.ticket_id === lastId && e._t <= firstStart + 5000).pop();
    if (hit) {
      from = hit._i + 1;
      const req = log.slice(from).find(isTicketPost);
      if (req) from = req._i + 1;
      window = `after warm-up ticket ${lastId}`;
    }
  }
  if (from < 0) {
    const lo = firstStart - 3000;
    const first = log.find((e) => e._t >= lo);
    from = first ? first._i : log.length;
    window = 'time window (warm-up ids not in meta file)';
  }
  const section = [];
  for (let i = from; i < log.length; i++) {
    const e = log[i];
    if (e._t > hi || e.type === 'startup') break;
    if (e._t < firstStart - 60000) continue; // out-of-order line from much earlier: not this run's
    section.push(e);
  }
  return {
    window,
    requests: section.filter(isTicketPost),
    classifications: section.filter((e) => e.type === 'classification'),
    errors: section.filter((e) => e.type === 'error'),
  };
}

module.exports = { CONFIGS, parseCsv, readLog, findRuns, logSection };
