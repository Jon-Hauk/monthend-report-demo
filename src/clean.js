// Turns a messy ledger export into clean rows plus a log of every line that
// was dropped or excluded, and why. Nothing is silently discarded: each
// skipped line appears in the log with its source file and line number.

import { parseCsv } from './csv.js';
import { DEPARTMENTS, CATEGORIES, HEADER } from './sample.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DEPT_MAP = new Map([
  ['operations', 'Operations'], ['ops', 'Operations'],
  ['sales', 'Sales'],
  ['admin', 'Admin'], ['administration', 'Admin'],
  ['it', 'IT'], ['i.t.', 'IT'],
]);
for (const d of DEPARTMENTS) DEPT_MAP.set(d.toLowerCase(), d);

const CAT_MAP = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));

const pad = (n) => String(n).padStart(2, '0');

function validYmd(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1)) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Accepts YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY (the export's documented US
// format) and D-Mon-YYYY. Returns ISO YYYY-MM-DD or null.
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return validYmd(+m[3], +m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? validYmd(+m[3], mon, +m[1]) : null;
  }
  return null;
}

// Accepts 1234.5, $1,234.50, -$45.00 and accounting-style (45.00).
// Returns integer cents or null.
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -cents : cents;
}

export function normalizeDepartment(raw) {
  return DEPT_MAP.get(String(raw ?? '').trim().toLowerCase()) ?? null;
}

export function normalizeCategory(raw) {
  return CAT_MAP.get(String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}

// Vendor names: trim, collapse spaces, and fix ALL-CAPS / all-lower variants
// back to the most common spelling seen in the file.
function vendorKey(v) { return v.trim().replace(/\s+/g, ' ').toLowerCase(); }

const isHeader = (cells) =>
  cells.length >= HEADER.length && HEADER.every((h, i) => (cells[i] ?? '').trim().toLowerCase() === h.toLowerCase());

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.&-])([a-z])/g, (m, p, c) => p + c.toUpperCase());

// options.vendors: optional vendor master list (correct spellings). Names that
// match it case-insensitively take its spelling; otherwise the most common
// mixed-case spelling in the file wins; an ALL-CAPS or all-lower name seen
// nowhere else is title-cased.
export function cleanExport(text, source, options = {}) {
  const master = new Map((options.vendors ?? []).map((v) => [vendorKey(v), v]));
  const records = parseCsv(text);
  const issues = [];
  const stats = { linesRead: 0, kept: 0, datesReformatted: 0, amountsReformatted: 0, departmentsRenamed: 0, categoriesFixed: 0, vendorsFixed: 0 };
  const log = (rec, issue, action, txnId = '') =>
    issues.push({ source, line: rec.line, txnId, issue, action, raw: rec.cells.join(' | ') });

  if (!records.length || !isHeader(records[0].cells)) {
    throw new Error(`${source}: first line is not the expected header (${HEADER.join(', ')})`);
  }

  const candidates = [];
  for (const rec of records.slice(1)) {
    stats.linesRead++;
    const c = rec.cells;
    if (c.every((v) => v.trim() === '')) { log(rec, 'Blank row', 'Skipped'); continue; }
    if (isHeader(c)) { log(rec, 'Repeated header (page break in export)', 'Skipped'); continue; }
    if (/^total\b/i.test(c[0].trim())) { log(rec, 'Export footer / total line', 'Skipped'); continue; }

    const [txnRaw, dateRaw, vendorRaw, deptRaw, catRaw, amtRaw, memoRaw = ''] = c;
    const txnId = txnRaw.trim();
    const date = parseDate(dateRaw);
    const amount = parseAmount(amtRaw);
    const department = normalizeDepartment(deptRaw);
    const category = normalizeCategory(catRaw);

    if (amount === null) { log(rec, `Missing or unreadable amount "${amtRaw}"`, 'Excluded, needs follow-up', txnId); continue; }
    if (date === null) { log(rec, `Unreadable date "${dateRaw}"`, 'Excluded, needs follow-up', txnId); continue; }
    if (department === null) { log(rec, `Unknown department "${deptRaw}"`, 'Excluded, needs follow-up', txnId); continue; }
    if (category === null) { log(rec, `Unknown category "${catRaw}"`, 'Excluded, needs follow-up', txnId); continue; }

    if (date !== dateRaw) stats.datesReformatted++;
    if (amtRaw.trim() !== (amount / 100).toFixed(2)) stats.amountsReformatted++;
    if (department !== deptRaw) stats.departmentsRenamed++;
    if (category !== catRaw) stats.categoriesFixed++;

    candidates.push({ rec, row: { txnId, date, vendorRaw, department, category, amount, memo: memoRaw.trim(), source } });
  }

  // Pick a canonical spelling per vendor: the variant seen most often.
  const spellings = new Map();
  for (const { row } of candidates) {
    const k = vendorKey(row.vendorRaw);
    const v = row.vendorRaw.trim().replace(/\s+/g, ' ');
    const m = spellings.get(k) ?? new Map();
    m.set(v, (m.get(v) ?? 0) + 1);
    spellings.set(k, m);
  }
  const canonicalVendor = new Map();
  const mixed = (s) => s !== s.toUpperCase() && s !== s.toLowerCase();
  for (const [k, m] of spellings) {
    if (master.has(k)) { canonicalVendor.set(k, master.get(k)); continue; }
    // Prefer mixed-case spellings over all-caps / all-lower, then frequency.
    const score = (s) => (mixed(s) ? 1e6 : 0) + m.get(s);
    const best = [...m.keys()].sort((a, b) => score(b) - score(a))[0];
    canonicalVendor.set(k, mixed(best) ? best : titleCase(best));
  }

  const seen = new Map();
  const rows = [];
  for (const { rec, row } of candidates) {
    const vendor = canonicalVendor.get(vendorKey(row.vendorRaw));
    if (vendor !== row.vendorRaw) stats.vendorsFixed++;
    const clean = { txnId: row.txnId, date: row.date, vendor, department: row.department, category: row.category, amount: row.amount, memo: row.memo, source };
    const prior = seen.get(row.txnId);
    if (prior) {
      const same = ['date', 'vendor', 'department', 'category', 'amount'].every((k) => prior[k] === clean[k]);
      if (same) log(rec, `Duplicate of line ${prior.line} (exported twice)`, 'Removed', row.txnId);
      else log(rec, `Txn ID reused with different details (first seen line ${prior.line})`, 'Excluded, needs follow-up', row.txnId);
      continue;
    }
    seen.set(row.txnId, { ...clean, line: rec.line });
    rows.push(clean);
  }
  stats.kept = rows.length;
  return { rows, issues, stats };
}
