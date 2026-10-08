#!/usr/bin/env node
/**
 * Builds the load-test data file for JMeter.
 *
 * Takes the team's 1,000-row slice (rows 8000-8999), removes the golden-test-set tickets,
 * shuffles what is left with a fixed seed, and writes one complete JSON request body per line:
 *     {"narrative":"..."}
 * Every line is plain ASCII on a single line (quotes, newlines and non-ASCII characters are
 * JSON-escaped), so JMeter can post a line as the body of POST /tickets without any further escaping.
 *
 * Usage (from the repo root):
 *   node scripts/make_load_data.js --data <slice.csv> --golden <golden.csv> [--out jmeter/load_data.txt] [--seed 13]
 *
 * Inputs:  --data    CSV with columns row (or row_id) and narrative
 *          --golden  CSV with a row_id (or row) column; these rows are excluded
 * The same inputs and seed always produce the same file.
 *
 * Why seed 13: a short load run only reads the first lines of the file (about 15 at 0.05 req/s), so those
 * lines must be a fair sample. Seed 8 gave a 15-line start averaging 191 words against 158 overall. The seed
 * was therefore chosen by a rule that looks only at the input text: the smallest seed >= 8 for which the
 * first 15, 30 and 60 lines each average within 10% of the overall mean (13 does: 169, 169, 148 vs 158).
 * Chosen before any load test was run, without reference to any latency result.
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { data: null, golden: null, out: path.join('jmeter', 'load_data.txt'), seed: 13 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') a.data = argv[++i];
    else if (argv[i] === '--golden') a.golden = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--seed') a.seed = parseInt(argv[++i], 10);
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(1); }
  }
  if (!a.data || !a.golden) {
    console.error('Usage: node scripts/make_load_data.js --data <slice.csv> --golden <golden.csv> [--out jmeter/load_data.txt] [--seed 13]');
    process.exit(1);
  }
  return a;
}

// RFC4180-style parser: quoted fields, embedded commas/newlines, "" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function readTable(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf-8'));
  if (rows.length === 0) throw new Error(`${file}: no rows`);
  const idCol = ['row_id', 'row'].find((c) => c in rows[0]);
  if (!idCol) throw new Error(`${file}: needs a "row_id" or "row" column`);
  return rows.map((r) => ({ id: Number(r[idCol]), narrative: r.narrative }));
}

// small seeded PRNG (mulberry32) so the shuffle is reproducible anywhere
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function asciiJson(narrative) {
  return JSON.stringify({ narrative }).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function main() {
  const args = parseArgs(process.argv);
  const slice = readTable(args.data);
  const golden = new Set(readTable(args.golden).map((r) => r.id));

  const ids = slice.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate row ids in the slice');
  const missing = [...golden].filter((id) => !ids.includes(id));
  if (missing.length > 0) throw new Error(`${missing.length} golden row id(s) are not in the slice, e.g. ${missing.slice(0, 5).join(', ')}`);

  const pool = slice.filter((r) => !golden.has(r.id) && r.narrative && r.narrative.trim()).sort((a, b) => a.id - b.id);

  // Fisher-Yates with the seeded generator
  const rand = mulberry32(args.seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, pool.map((r) => asciiJson(r.narrative)).join('\n') + '\n', 'ascii');
  console.log(`Slice rows: ${slice.length} | golden excluded: ${golden.size} | written: ${pool.length} | seed: ${args.seed}`);
  console.log(`Wrote ${args.out}`);
}

main();
