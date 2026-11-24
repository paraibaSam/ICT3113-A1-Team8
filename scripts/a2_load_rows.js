#!/usr/bin/env node
/**
 * Rebuilds the source row number of every line of jmeter/load_data.txt.
 *
 * load_data.txt holds only request bodies, but the A2 brief asks for the row numbers of the
 * speed-test workload. The file was produced by scripts/make_load_data.js, which is deterministic:
 *   pool = rows 8000-8999 minus the 180 golden rows, sorted by row id, then Fisher-Yates shuffled
 *   with mulberry32(seed 13).
 * Replaying that shuffle on the row ids alone gives the row id of each output line. The pool size
 * (1000 - 180 = 820) equals the line count of load_data.txt, which is checked below.
 *
 * Usage: node scripts/a2_load_rows.js
 * Writes jmeter/load_data_rows.csv: line,row_id,chars,words
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEED = 13;
const FIRST = 8000;
const LAST = 8999;

function mulberry32(seed) { // identical to scripts/make_load_data.js
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const split = fs.readFileSync(path.join(ROOT, 'golden-set', 'a2_split.csv'), 'utf8').trim().split('\n').slice(1);
const golden = new Set(split.map((l) => Number(l.split(',')[0])));
if (golden.size !== 180) throw new Error(`expected 180 golden rows, got ${golden.size}`);

const pool = [];
for (let id = FIRST; id <= LAST; id++) if (!golden.has(id)) pool.push(id);

const rand = mulberry32(SEED);
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}

const lines = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data.txt'), 'ascii').split('\n').filter((l) => l.trim());
if (lines.length !== pool.length) throw new Error(`load_data.txt has ${lines.length} lines but the rebuilt pool has ${pool.length}`);

const out = ['line,row_id,chars,words'];
lines.forEach((l, i) => {
  const n = JSON.parse(l).narrative;
  out.push(`${i + 1},${pool[i]},${n.length},${n.trim().split(/\s+/).length}`);
});
fs.writeFileSync(path.join(ROOT, 'jmeter', 'load_data_rows.csv'), out.join('\n') + '\n');
console.log(`Wrote jmeter/load_data_rows.csv (${lines.length} lines). Line 1 = row ${pool[0]}, line ${lines.length} = row ${pool[pool.length - 1]}.`);
