const fs = require('fs');
const path = require('path');

const CATEGORIES = [
  'Credit reporting',
  'Debt collection',
  'Mortgage',
  'Credit card',
  'Bank account or service',
  'Consumer loan',
  'Money transfer or service',
];

function parseArgs(argv) {
  const args = { csv: null, model: null, baseUrl: 'http://localhost:3000', outDir: null, delayMs: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') args.csv = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (!args.csv || !args.model) {
    console.error('Usage: node accuracy_test.js --csv <path> --model <ollama-model-tag> [--base-url http://localhost:3000] [--out-dir results] [--delay-ms 0]');
    process.exit(1);
  }
  if (!args.outDir) args.outDir = path.join(__dirname, '..', 'results');
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows[0];
  return rows.slice(1)
    .filter((r) => r.length === header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

function csvEscape(value) {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function classifyTicket(baseUrl, narrative) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrative }),
    });
    const round_trip_ms = Date.now() - start;
    if (!res.ok) {
      return { predicted: null, http_status: res.status, round_trip_ms, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { predicted: data.category, http_status: res.status, round_trip_ms, error: null };
  } catch (err) {
    return { predicted: null, http_status: null, round_trip_ms: Date.now() - start, error: err.message };
  }
}

function buildConfusionMatrix(results) {
  // matrix[actual][predicted] = count
  const matrix = {};
  for (const a of CATEGORIES) {
    matrix[a] = {};
    for (const p of CATEGORIES) matrix[a][p] = 0;
    matrix[a]['(error/unmatched)'] = 0;
  }
  for (const r of results) {
    const actual = r.final_label;
    const predicted = r.predicted_label && CATEGORIES.includes(r.predicted_label) ? r.predicted_label : '(error/unmatched)';
    if (!matrix[actual]) matrix[actual] = {};
    if (matrix[actual][predicted] === undefined) matrix[actual][predicted] = 0;
    matrix[actual][predicted]++;
  }
  return matrix;
}

function computeAccuracy(results) {
  const total = results.length;
  const correct = results.filter((r) => r.match).length;
  const overall = total > 0 ? correct / total : 0;

  const perCategory = {};
  for (const cat of CATEGORIES) {
    const rowsForCat = results.filter((r) => r.final_label === cat);
    const correctForCat = rowsForCat.filter((r) => r.match).length;
    perCategory[cat] = {
      total: rowsForCat.length,
      correct: correctForCat,
      accuracy: rowsForCat.length > 0 ? correctForCat / rowsForCat.length : null,
    };
  }

  return { total, correct, overall, perCategory };
}

function renderMarkdownSummary({ model, csv, baseUrl, accuracy, confusion, errorCount }) {
  const lines = [];
  lines.push(`# Accuracy test results — \`${model}\``);
  lines.push('');
  lines.push(`- Golden set: \`${csv}\``);
  lines.push(`- Service: \`${baseUrl}\``);
  lines.push(`- Total tickets: ${accuracy.total}`);
  lines.push(`- Correct: ${accuracy.correct}`);
  lines.push(`- **Overall accuracy: ${(accuracy.overall * 100).toFixed(1)}%**`);
  if (errorCount > 0) {
    lines.push(`- ⚠️ ${errorCount} request(s) failed (HTTP error or network error) — see per_ticket_results.csv`);
  }
  lines.push('');
  lines.push('## Per-category accuracy');
  lines.push('');
  lines.push('| Category | Correct / Total | Accuracy |');
  lines.push('|---|---|---|');
  for (const cat of CATEGORIES) {
    const c = accuracy.perCategory[cat];
    const pct = c.accuracy === null ? 'n/a' : (c.accuracy * 100).toFixed(1) + '%';
    lines.push(`| ${cat} | ${c.correct} / ${c.total} | ${pct} |`);
  }
  lines.push('');
  lines.push('## Confusion matrix (rows = actual, columns = predicted)');
  lines.push('');
  const allCols = [...CATEGORIES, '(error/unmatched)'];
  lines.push('| Actual \\ Predicted | ' + allCols.map((c) => c.slice(0, 12)).join(' | ') + ' |');
  lines.push('|---|' + allCols.map(() => '---').join('|') + '|');
  for (const actual of CATEGORIES) {
    const row = allCols.map((p) => confusion[actual][p] ?? 0);
    lines.push(`| ${actual} | ` + row.join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  console.log(`Reading golden set from ${args.csv} ...`);
  const csvText = fs.readFileSync(args.csv, 'utf-8');
  const rows = parseCsv(csvText);
  console.log(`Loaded ${rows.length} golden-set tickets.`);

  if (rows.length === 0) {
    console.error('No rows found in CSV - check the file path and format.');
    process.exit(1);
  }

  const missingCols = ['row_id', 'narrative', 'final_label'].filter((c) => !(c in rows[0]));
  if (missingCols.length > 0) {
    console.error(`CSV is missing required column(s): ${missingCols.join(', ')}`);
    process.exit(1);
  }

  const outDir = path.join(args.outDir, args.model.replace(/[:/]/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  let errorCount = 0;

  console.log(`Testing model "${args.model}" against ${args.baseUrl} ...`);
  console.log('Make sure the running service is actually configured with this model before proceeding.');
  console.log('');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { predicted, http_status, round_trip_ms, error } = await classifyTicket(args.baseUrl, row.narrative);
    const match = predicted === row.final_label;
    if (error) errorCount++;

    results.push({
      row_id: row.row_id,
      final_label: row.final_label,
      predicted_label: predicted || '',
      match,
      http_status: http_status || '',
      round_trip_ms,
      error: error || '',
    });

    if ((i + 1) % 20 === 0 || i === rows.length - 1) {
      console.log(`  ${i + 1}/${rows.length} tickets processed (${errorCount} errors so far)`);
    }

    if (args.delayMs > 0) {
      await new Promise((r) => setTimeout(r, args.delayMs));
    }
  }

  // Write per-ticket results CSV
  const perTicketPath = path.join(outDir, 'per_ticket_results.csv');
  const header = ['row_id', 'final_label', 'predicted_label', 'match', 'http_status', 'round_trip_ms', 'error'];
  const csvLines = [header.join(',')];
  for (const r of results) {
    csvLines.push(header.map((h) => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(perTicketPath, csvLines.join('\n') + '\n');

  const accuracy = computeAccuracy(results);
  const confusion = buildConfusionMatrix(results);

  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ model: args.model, csv: args.csv, baseUrl: args.baseUrl, accuracy, confusion, errorCount }, null, 2)
  );

  const md = renderMarkdownSummary({ model: args.model, csv: args.csv, baseUrl: args.baseUrl, accuracy, confusion, errorCount });
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);

  console.log('');
  console.log(`Done. Overall accuracy: ${(accuracy.overall * 100).toFixed(1)}% (${accuracy.correct}/${accuracy.total})`);
  console.log(`Results written to: ${outDir}`);
  if (errorCount > 0) {
    console.log(`WARNING: ${errorCount} request(s) errored - check per_ticket_results.csv before trusting this accuracy figure.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});