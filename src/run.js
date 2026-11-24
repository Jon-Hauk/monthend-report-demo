// npm run report: cleans every export in data/raw and writes the month-end
// workbook and PDF to output/.
//
//   node src/run.js [--in data/raw] [--budget data/budget.csv] [--out output] [--period YYYY-MM]

import fs from 'node:fs';
import path from 'node:path';
import { cleanExport, parseAmount } from './clean.js';
import { parseCsv } from './csv.js';
import { summarize, monthLabel } from './summary.js';
import { writeWorkbook } from './excel.js';
import { writePdf } from './pdf.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const inDir = args.in ?? 'data/raw';
const budgetFile = args.budget ?? 'data/budget.csv';
const outDir = args.out ?? 'output';

export function loadBudget(file) {
  const [, ...recs] = parseCsv(fs.readFileSync(file, 'utf8'));
  return recs.filter((r) => r.cells.some((c) => c.trim())).map((r) => {
    const [month, department, category, amount] = r.cells.map((c) => c.trim());
    const budget = parseAmount(amount);
    if (budget === null) throw new Error(`${file} line ${r.line}: bad budget amount "${amount}"`);
    return { month, department, category, budget };
  });
}

const files = fs.readdirSync(inDir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
if (!files.length) { console.error(`No CSV exports found in ${inDir}`); process.exit(1); }

const vendorFile = args.vendors ?? 'data/vendors.csv';
const vendors = fs.existsSync(vendorFile)
  ? parseCsv(fs.readFileSync(vendorFile, 'utf8')).slice(1).map((r) => r.cells[0].trim()).filter(Boolean)
  : [];

let rows = [], issues = [];
const stats = { linesRead: 0, kept: 0, datesReformatted: 0, amountsReformatted: 0, departmentsRenamed: 0, categoriesFixed: 0, vendorsFixed: 0 };
for (const f of files) {
  const r = cleanExport(fs.readFileSync(path.join(inDir, f), 'utf8'), f, { vendors });
  rows = rows.concat(r.rows);
  issues = issues.concat(r.issues);
  for (const k of Object.keys(stats)) stats[k] += r.stats[k];
}

const s = summarize(rows, loadBudget(budgetFile), args.period);
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, `monthend-${s.period}`);
await writeWorkbook(`${base}.xlsx`, s, rows, issues, stats);
await writePdf(`${base}.pdf`, s, issues, stats);

const $ = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
console.log(`Period: ${monthLabel(s.period)} (compared with ${monthLabel(s.prior)})`);
console.log(`Read ${stats.linesRead} lines from ${files.length} export(s); kept ${stats.kept}; ${issues.length} skipped or excluded`);
console.log(`Spend ${$(s.total.actual)} vs budget ${$(s.total.budget)} (${$(s.total.vsBudget)})`);
console.log(`Wrote ${base}.xlsx and ${base}.pdf`);
