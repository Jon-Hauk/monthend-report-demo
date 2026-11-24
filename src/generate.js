// npm run generate: rewrites the synthetic sample exports in data/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExport, buildBudget, VENDORS } from './sample.js';
import { toCsv } from './csv.js';

export const SAMPLE = [
  { month: '2026-09', seed: 2609, file: 'data/raw/ledger_export_2026-09.csv' },
  { month: '2026-10', seed: 2610, file: 'data/raw/ledger_export_2026-10.csv' },
];
export const BUDGET_SEED = 77;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync('data/raw', { recursive: true });
  for (const s of SAMPLE) {
    const { csv, truth, injected } = buildExport(s.month, s.seed);
    fs.writeFileSync(s.file, csv);
    console.log(`${s.file}: ${truth.length} real transactions, injected ${JSON.stringify(injected)}`);
  }
  const budget = buildBudget(SAMPLE.map((s) => s.month), BUDGET_SEED);
  fs.writeFileSync('data/budget.csv', toCsv([
    ['Month', 'Department', 'Category', 'Budget'],
    ...budget.map((b) => [b.month, b.department, b.category, (b.budget / 100).toFixed(2)]),
  ]));
  console.log(`data/budget.csv: ${budget.length} lines`);
  const vendors = [...new Set(Object.values(VENDORS).flat())].sort();
  fs.writeFileSync('data/vendors.csv', toCsv([['Vendor'], ...vendors.map((v) => [v])]));
  console.log(`data/vendors.csv: ${vendors.length} vendors`);
}
