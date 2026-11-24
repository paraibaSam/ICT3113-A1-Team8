// Assignment 2, Step 1: score Assignment 1 single-model predictions on the A2 split
// and derive the accuracy limits from the top model's TEST-set accuracy.
//
// Reuses results/<model>/per_ticket_results.csv from Assignment 1 (allowed by the brief
// when digest, prompt, Ollama version and machine are unchanged). Scores test rows for
// the pass/fail decision, and tuning rows for designing the escalation rule.
//
// Usage: node scripts/a2_score_split.js [--top qwen2.5:7b] [--out results/a2/accuracy_singles]
//        [--extra name=path/to/per_ticket_results.csv ...]   (e.g. cascade runs later)
//
// Limits:  overall  = top model test accuracy - 10 pp
//          category = top model test accuracy in that category - 15 pp
// Categories with fewer than SMALL_N test tickets are flagged as too small for a fair test.

const fs = require('fs');
const path = require('path');

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
const SMALL_N = 10;
const OVERALL_MARGIN = 10;
const CATEGORY_MARGIN = 15;

const MODELS = [
  { name: 'qwen2.5:7b', dir: 'qwen2.5_7b' },
  { name: 'gemma3:4b', dir: 'gemma3_4b' },
  { name: 'granite3.3:8b', dir: 'granite3.3_8b' },
  { name: 'qwen2.5:3b', dir: 'qwen2.5_3b' },
  { name: 'gemma3:1b', dir: 'gemma3_1b' },
];

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
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const readCsv = (p) => parseCsv(fs.readFileSync(p, 'utf8'));
const pct = (c, n) => (n ? (100 * c) / n : NaN);
const fmt = (x) => (Number.isNaN(x) ? 'n/a' : `${x.toFixed(1)}%`);

// ---- args
const args = { top: 'qwen2.5:7b', out: path.join(ROOT, 'results', 'a2', 'accuracy_singles'), extra: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--top') args.top = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--extra') {
    const [name, p] = process.argv[++i].split('=');
    args.extra.push({ name, file: p });
  } else throw new Error(`Unknown argument ${a}`);
}

// ---- split
const split = readCsv(path.join(ROOT, 'golden-set', 'a2_split.csv'));
const splitById = new Map(split.map((r) => [r.row_id, r]));

function score(rows) {
  const s = { n: 0, correct: 0, perCat: {}, matrix: {} };
  for (const c of CATEGORIES) {
    s.perCat[c] = { n: 0, correct: 0 };
    s.matrix[c] = Object.fromEntries([...CATEGORIES, '(error/unmatched)'].map((p) => [p, 0]));
  }
  for (const r of rows) {
    const actual = r.final_label;
    const pred = CATEGORIES.includes(r.predicted_label) ? r.predicted_label : '(error/unmatched)';
    const ok = pred === actual;
    s.n++;
    s.correct += ok;
    s.perCat[actual].n++;
    s.perCat[actual].correct += ok;
    s.matrix[actual][pred]++;
  }
  s.acc = pct(s.correct, s.n);
  for (const c of CATEGORIES) s.perCat[c].acc = pct(s.perCat[c].correct, s.perCat[c].n);
  return s;
}

function loadPredictions(name, file) {
  const rows = readCsv(file);
  const seen = new Set();
  for (const r of rows) {
    const g = splitById.get(r.row_id);
    if (!g) throw new Error(`${name}: row ${r.row_id} is not in the golden set`);
    if (g.final_label !== r.final_label) throw new Error(`${name}: label mismatch on row ${r.row_id}`);
    seen.add(r.row_id);
  }
  return {
    rows,
    test: rows.filter((r) => splitById.get(r.row_id).split === 'test'),
    tuning: rows.filter((r) => splitById.get(r.row_id).split === 'tuning'),
    complete: { test: split.filter((g) => g.split === 'test').every((g) => seen.has(g.row_id)) },
  };
}

const configs = MODELS.map((m) => ({ name: m.name, file: path.join(ROOT, 'results', m.dir, 'per_ticket_results.csv'), source: 'A1 per_ticket_results.csv (reused)' }))
  .concat(args.extra.map((e) => ({ name: e.name, file: path.resolve(e.file), source: path.relative(ROOT, path.resolve(e.file)) })));

const results = configs.map((c) => {
  const p = loadPredictions(c.name, c.file);
  if (!p.complete.test) throw new Error(`${c.name}: does not cover every test-set row`);
  return { ...c, test: score(p.test), tuning: p.tuning.length ? score(p.tuning) : null };
});

const top = results.find((r) => r.name === args.top);
if (!top) throw new Error(`Top model ${args.top} not found`);

const limits = {
  topModel: top.name,
  overall: { topAcc: top.test.acc, topCorrect: top.test.correct, n: top.test.n, limit: top.test.acc - OVERALL_MARGIN },
  perCategory: Object.fromEntries(
    CATEGORIES.map((c) => {
      const t = top.test.perCat[c];
      return [c, { n: t.n, topCorrect: t.correct, topAcc: t.acc, limit: t.acc - CATEGORY_MARGIN, tooSmall: t.n < SMALL_N }];
    }),
  ),
};

for (const r of results) {
  r.passOverall = r.test.acc >= limits.overall.limit - 1e-9;
  r.failedCats = CATEGORIES.filter((c) => r.test.perCat[c].acc < limits.perCategory[c].limit - 1e-9);
  r.passCategory = r.failedCats.length === 0;
  r.pass = r.passOverall && r.passCategory;
}

// ---- markdown
const L = [];
L.push('# A2 accuracy on the golden-set split (single models)', '');
L.push(`Generated by \`scripts/a2_score_split.js\`. Split: \`golden-set/a2_split.csv\` (sorted by row_id; odd positions = tuning, even positions = test).`);
L.push(`Single-model predictions reused from Assignment 1 (\`results/<model>/per_ticket_results.csv\`); only test-set rows decide pass/fail.`, '');

L.push('## Accuracy limits (from the top model on the test set)', '');
L.push(`Top model: **${top.name}**, test-set accuracy **${top.test.correct}/${top.test.n} = ${fmt(top.test.acc)}**`);
L.push(`**Overall limit: ${fmt(limits.overall.limit)}** (top − ${OVERALL_MARGIN} pp), i.e. at least ${Math.ceil((limits.overall.limit / 100) * top.test.n - 1e-9)}/${top.test.n} correct.`, '');
L.push('| Category | Test n | Top model right/n | Top % | Limit (top − 15 pp) | Min right to pass | Too small (<10)? |');
L.push('|---|---|---|---|---|---|---|');
for (const c of CATEGORIES) {
  const x = limits.perCategory[c];
  const minRight = Math.max(0, Math.ceil((x.limit / 100) * x.n - 1e-9));
  L.push(`| ${c} | ${x.n} | ${x.topCorrect}/${x.n} | ${fmt(x.topAcc)} | ${fmt(x.limit)} | ${minRight}/${x.n} | ${x.tooSmall ? 'yes, 1 ticket = ' + (100 / x.n).toFixed(1) + ' pp' : 'no'} |`);
}
L.push('');

L.push('## Test set: overall and pass/fail', '');
L.push('| Config | Correct/n | Accuracy | Overall limit | Per-category limit | **Passes both** |');
L.push('|---|---|---|---|---|---|');
for (const r of results) {
  L.push(`| ${r.name} | ${r.test.correct}/${r.test.n} | ${fmt(r.test.acc)} | ${r.passOverall ? 'pass' : 'FAIL'} | ${r.passCategory ? 'pass' : 'FAIL (' + r.failedCats.join(', ') + ')'} | ${r.pass ? '**PASS**' : 'FAIL'} |`);
}
L.push('');

L.push('## Test set: per-category accuracy (right/n, %)', '');
L.push(`| Config | ${CATEGORIES.join(' | ')} |`);
L.push(`|---|${CATEGORIES.map(() => '---').join('|')}|`);
L.push(`| *limit* | ${CATEGORIES.map((c) => fmt(limits.perCategory[c].limit)).join(' | ')} |`);
for (const r of results) {
  L.push(`| ${r.name} | ${CATEGORIES.map((c) => {
    const x = r.test.perCat[c];
    const flag = r.failedCats.includes(c) ? ' ✗' : '';
    return `${x.correct}/${x.n} (${fmt(x.acc)})${flag}`;
  }).join(' | ')} |`);
}
L.push('', '✗ = below the per-category limit.', '');

L.push('## Tuning set (for rule design only, not used for pass/fail)', '');
L.push(`| Config | Overall | ${CATEGORIES.join(' | ')} |`);
L.push(`|---|---|${CATEGORIES.map(() => '---').join('|')}|`);
for (const r of results.filter((x) => x.tuning)) {
  L.push(`| ${r.name} | ${r.tuning.correct}/${r.tuning.n} (${fmt(r.tuning.acc)}) | ${CATEGORIES.map((c) => {
    const x = r.tuning.perCat[c];
    return `${x.correct}/${x.n} (${fmt(x.acc)})`;
  }).join(' | ')} |`);
}
L.push('');

L.push('## Test-set confusion matrices (rows = actual, columns = predicted)', '');
const short = (c) => c.split(' ').map((w) => w[0].toUpperCase()).join('');
for (const r of results) {
  L.push(`### ${r.name}`, '');
  const cols = [...CATEGORIES, '(error/unmatched)'];
  L.push(`| Actual \\ Pred | ${cols.map((c) => (c.startsWith('(') ? 'Err' : short(c))).join(' | ')} |`);
  L.push(`|---|${cols.map(() => '---').join('|')}|`);
  for (const a of CATEGORIES) L.push(`| ${a} | ${cols.map((p) => r.test.matrix[a][p]).join(' | ')} |`);
  L.push('');
}
L.push(`Column key: ${CATEGORIES.map((c) => `${short(c)} = ${c}`).join('; ')}; Err = error or unmatched label.`, '');

fs.mkdirSync(args.out, { recursive: true });
fs.writeFileSync(path.join(args.out, 'summary.md'), L.join('\n'));
fs.writeFileSync(
  path.join(args.out, 'summary.json'),
  JSON.stringify({ limits, configs: results.map(({ name, source, test, tuning, passOverall, passCategory, failedCats, pass }) => ({ name, source, test, tuning, passOverall, passCategory, failedCats, pass })) }, null, 2),
);

console.log(`Top ${top.name}: test ${top.test.correct}/${top.test.n} = ${fmt(top.test.acc)} -> overall limit ${fmt(limits.overall.limit)}`);
for (const r of results) console.log(`${r.name.padEnd(16)} test ${String(r.test.correct).padStart(2)}/${r.test.n} ${fmt(r.test.acc).padStart(6)}  ${r.pass ? 'PASS' : 'FAIL'}${r.failedCats.length ? '  (cat fail: ' + r.failedCats.join(', ') + ')' : ''}`);
console.log(`Wrote ${path.relative(ROOT, args.out)}/summary.md and summary.json`);
