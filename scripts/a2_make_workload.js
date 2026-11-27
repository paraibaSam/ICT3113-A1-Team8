#!/usr/bin/env node
/**
 * A2 Step 4 set-up: choose the fixed speed-test workload and the three tickets used to measure S.
 *
 * Source: jmeter/load_data.txt (non-golden rows 8000-8999, seed-13 order) with row numbers from
 * jmeter/load_data_rows.csv. Only lines 721-814 are used: A1 used lines 1-720 (load blocks and the
 * stress test), and the A2 memory check used 815-820.
 *
 * Rule (fixed before any A2 measurement, uses only ticket length):
 *   typical = length between the p25 and p75 of all 820 tickets (in characters)
 *   long    = length above the p90 of all 820 tickets
 *   Walk lines 721..814 in file order.
 *   S tickets = typical tickets no. 33-35 in file order (rows 8073, 8511, 8014). Fixed by the first
 *   version of this rule and used to measure S (results/a2/speed/s_measurement.*), so never in the workload.
 *   Workload = 50 tickets; positions 6, 12, ..., 48 are the 8 "long" tickets in file order, every other
 *   position is the next "typical" ticket (excluding the S tickets).
 *   Why 50 and every 6th: measured S = 3.4 s, so a run is the 5-minute minimum at one ticket per 6.8 s,
 *   about 44 requests, plus a margin. Lines 721-814 hold only 8 long tickets, so long tickets are 1 in 6.
 *   (First version: 40 tickets, every 5th long - too few once S was known; it was never used for a run.)
 *
 * Usage: node scripts/a2_make_workload.js
 * Writes: jmeter/a2/workload_rows.csv, jmeter/a2/workload.txt (one JSON body per line, in order),
 *         jmeter/a2/s_tickets_rows.csv, jmeter/a2/s_tickets.txt
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIRST_LINE = 721;
const LAST_LINE = 814;
const N = 50;
const LONG_EVERY = 6;
const S_TYPICAL_INDEX = [32, 33, 34]; // 0-based positions in the typical list

const bodies = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data.txt'), 'ascii').split('\n').filter((l) => l.trim());
const rows = fs.readFileSync(path.join(ROOT, 'jmeter', 'load_data_rows.csv'), 'utf8').trim().split('\n').slice(1)
  .map((l) => { const [line, row_id, chars, words] = l.split(',').map(Number); return { line, row_id, chars, words }; });

const sorted = rows.map((r) => r.chars).sort((a, b) => a - b);
const q = (p) => sorted[Math.floor(sorted.length * p)];
const P25 = q(0.25), P75 = q(0.75), P90 = q(0.9);

const cand = rows.filter((r) => r.line >= FIRST_LINE && r.line <= LAST_LINE);
const typical = cand.filter((r) => r.chars >= P25 && r.chars <= P75);
const long = cand.filter((r) => r.chars > P90);
const nLong = Math.floor(N / LONG_EVERY);
const sTickets = S_TYPICAL_INDEX.map((i) => ({ ...typical[i], class: 'typical' }));
const typicalForWorkload = typical.filter((_, i) => !S_TYPICAL_INDEX.includes(i));
if (long.length < nLong) throw new Error(`only ${long.length} long tickets in lines ${FIRST_LINE}-${LAST_LINE}`);
if (typicalForWorkload.length < N - nLong) throw new Error(`only ${typicalForWorkload.length} typical tickets`);

const workload = [];
let t = 0, l = 0;
for (let pos = 1; pos <= N; pos++) {
  if (pos % LONG_EVERY === 0 && l < nLong) workload.push({ ...long[l++], class: 'long' });
  else workload.push({ ...typicalForWorkload[t++], class: 'typical' });
}

const dir = path.join(ROOT, 'jmeter', 'a2');
fs.mkdirSync(dir, { recursive: true });
const csv = (list) => ['order,line,row_id,chars,words,class', ...list.map((r, i) => `${i + 1},${r.line},${r.row_id},${r.chars},${r.words},${r.class}`)].join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'workload_rows.csv'), csv(workload));
fs.writeFileSync(path.join(dir, 'workload.txt'), workload.map((r) => bodies[r.line - 1]).join('\n') + '\n', 'ascii');
fs.writeFileSync(path.join(dir, 's_tickets_rows.csv'), csv(sTickets));
fs.writeFileSync(path.join(dir, 's_tickets.txt'), sTickets.map((r) => bodies[r.line - 1]).join('\n') + '\n', 'ascii');

const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log(`length cut-offs (chars): p25=${P25} p75=${P75} p90=${P90}; candidates ${cand.length} (typical ${typical.length}, long ${long.length})`);
console.log(`workload: ${workload.length} tickets, ${nLong} long; mean chars all ${N} = ${mean(workload.map((r) => r.chars))}, first 44 = ${mean(workload.slice(0, 44).map((r) => r.chars))} (all 820: ${mean(rows.map((r) => r.chars))})`);
console.log(`workload rows: ${workload.map((r) => r.row_id).join(' ')}`);
console.log(`S tickets: ${sTickets.map((r) => `row ${r.row_id} (line ${r.line}, ${r.chars} chars)`).join('; ')}`);
