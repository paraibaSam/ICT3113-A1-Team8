// Assignment 2, Step 1: split the golden set into a tuning set and a test set.
//
// Rule from the brief: sort the golden-set tickets by row number; odd rows are the
// tuning set, even rows are the test set. "Rows" here means position in the sorted
// list, counted from 1 (1st, 3rd, 5th ... ticket -> tuning; 2nd, 4th, 6th ... -> test).
// This gives exactly 90 / 90 for our 180 tickets.
//
// Usage: node scripts/a2_split_golden.js [--csv golden-set/ict3113_team8_golden_set_with_narratives.csv]
// Writes golden-set/a2_tuning.csv, golden-set/a2_test.csv and golden-set/a2_split.csv
// (row_id, final_label, split, position) next to the input.

const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, header, records) {
  const lines = [header.join(',')].concat(records.map((r) => header.map((h) => csvField(r[h])).join(',')));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

const argv = process.argv.slice(2);
const csvPath = argv[0] === '--csv' ? argv[1] : path.join(__dirname, '..', 'golden-set', 'ict3113_team8_golden_set_with_narratives.csv');
const outDir = path.dirname(csvPath);

const [header, ...body] = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((r) => r.length > 1 || r[0] !== '');
const records = body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

const ids = records.map((r) => Number(r.row_id));
if (new Set(ids).size !== ids.length) throw new Error('Duplicate row_id in golden set');
if (ids.some((x) => !Number.isInteger(x))) throw new Error('Non-integer row_id in golden set');

records.sort((a, b) => Number(a.row_id) - Number(b.row_id));
records.forEach((r, i) => {
  r.position = i + 1;
  r.split = r.position % 2 === 1 ? 'tuning' : 'test';
});

const tuning = records.filter((r) => r.split === 'tuning');
const test = records.filter((r) => r.split === 'test');

writeCsv(path.join(outDir, 'a2_tuning.csv'), header, tuning);
writeCsv(path.join(outDir, 'a2_test.csv'), header, test);
writeCsv(path.join(outDir, 'a2_split.csv'), ['row_id', 'final_label', 'split', 'position'], records);

const byCat = {};
for (const r of records) {
  byCat[r.final_label] ??= { tuning: 0, test: 0 };
  byCat[r.final_label][r.split]++;
}
console.log(`Golden set: ${records.length} tickets -> tuning ${tuning.length}, test ${test.length}`);
console.table(byCat);
