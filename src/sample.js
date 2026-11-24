// Generates the synthetic accounting exports used by the demo.
//
// It builds a clean "source of truth" ledger first, then writes it out the way
// a real export tends to arrive: mixed date formats, currency symbols,
// bracketed refunds, inconsistent department names, duplicate lines, a repeated
// header and an export footer. The tests compare what the cleaner recovers
// against the truth, so every number in the report can be reconciled.
//
// All companies, vendors and amounts are made up.

import { toCsv } from './csv.js';

export const DEPARTMENTS = ['Operations', 'Sales', 'Admin', 'IT'];
export const CATEGORIES = [
  'Payroll', 'Rent', 'Contractors', 'Software', 'Marketing',
  'Travel', 'Utilities', 'Office Supplies',
];
export const HEADER = ['Txn ID', 'Date', 'Vendor', 'Department', 'Category', 'Amount', 'Memo'];

const DEPT_ALIASES = {
  Operations: ['Operations', 'Ops', 'OPS', 'operations '],
  Sales: ['Sales', 'sales', 'SALES '],
  Admin: ['Admin', 'Administration', 'admin'],
  IT: ['IT', 'I.T.', 'it'],
};

export const VENDORS = {
  Payroll: ['Payroll Run'],
  Rent: ['Ridgeline Property Mgmt'],
  Contractors: ['K. Mercer Consulting', 'Bolt Electrical', 'Quillfield Design'],
  Software: ['Cloudpad Inc', 'Ledgerly', 'Tasklane', 'Patchwise'],
  Marketing: ['Signal Ad Co', 'Printhouse 9'],
  Travel: ['Prairie Air', 'Foothills Hotel', 'Cab & Go'],
  Utilities: ['Chinook Power', 'Bowriver Water', 'FiberNorth'],
  'Office Supplies': ['Paperhaus', 'Desk Depot'],
};

// [count per month, min, max] in dollars, per category, before dept split.
const PROFILE = {
  Contractors: [6, 800, 4200],
  Software: [10, 25, 900],
  Marketing: [5, 300, 3500],
  Travel: [9, 60, 1400],
  Utilities: [3, 180, 950],
  'Office Supplies': [8, 15, 420],
};

const PAYROLL = { Operations: 48200, Sales: 31500, Admin: 22800, IT: 27400 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// month is 'YYYY-MM'. Returns clean truth rows with amounts in integer cents.
export function buildTruth(month, rand) {
  const [y, m] = month.split('-').map(Number);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const day = () => 1 + Math.floor(rand() * daysIn(y, m));
  const cents = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100);
  const rows = [];

  for (const dept of DEPARTMENTS) {
    const base = PAYROLL[dept] * 100;
    rows.push({ date: `${month}-15`, vendor: 'Payroll Run', department: dept, category: 'Payroll',
      amount: base + Math.round((rand() - 0.5) * base * 0.04), memo: 'Semi-monthly payroll 1 of 2' });
    rows.push({ date: `${month}-${pad(daysIn(y, m))}`, vendor: 'Payroll Run', department: dept, category: 'Payroll',
      amount: base + Math.round((rand() - 0.5) * base * 0.04), memo: 'Semi-monthly payroll 2 of 2' });
  }
  rows.push({ date: `${month}-01`, vendor: 'Ridgeline Property Mgmt', department: 'Admin', category: 'Rent',
    amount: 1450000, memo: 'Office lease, Unit 4' });

  for (const [cat, [count, lo, hi]] of Object.entries(PROFILE)) {
    const n = count + Math.floor(rand() * 4) - 1;
    for (let i = 0; i < n; i++) {
      const dept = cat === 'Software' && rand() < 0.5 ? 'IT' : pick(DEPARTMENTS);
      rows.push({ date: `${month}-${pad(day())}`, vendor: pick(VENDORS[cat]), department: dept, category: cat,
        amount: cents(lo, hi), memo: pick(['', '', 'Invoice ' + (1000 + Math.floor(rand() * 9000)), 'Monthly, see PO', 'Q4 work, phase 2']) });
    }
  }
  // A few refunds / credits.
  for (let i = 0; i < 3; i++) {
    const cat = pick(['Travel', 'Office Supplies', 'Software']);
    rows.push({ date: `${month}-${pad(day())}`, vendor: pick(VENDORS[cat]), department: pick(DEPARTMENTS), category: cat,
      amount: -cents(20, 300), memo: 'Refund / credit note' });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const mm = month.replace('-', '');
  rows.forEach((r, i) => { r.txnId = `TXN-${mm}-${String(i + 1).padStart(4, '0')}`; });
  return rows;
}

function messyDate(iso, rand) {
  const [y, m, d] = iso.split('-').map(Number);
  const r = rand();
  if (r < 0.35) return iso;
  if (r < 0.6) return `${pad(m)}/${pad(d)}/${y}`;           // US export format
  if (r < 0.8) return `${d}-${MONTHS[m - 1]}-${y}`;
  return ` ${y}/${pad(m)}/${pad(d)} `;
}

function messyAmount(cents, rand) {
  const abs = Math.abs(cents) / 100;
  const plain = abs.toFixed(2);
  const money = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cents < 0) return rand() < 0.5 ? `(${plain})` : `-${money}`;
  const r = rand();
  if (r < 0.4) return plain;
  if (r < 0.8) return money;
  return abs.toFixed(abs % 1 === 0 ? 0 : 2);
}

function messyText(s, rand) {
  const r = rand();
  if (r < 0.15) return s.toUpperCase();
  if (r < 0.3) return s.toLowerCase();
  if (r < 0.45) return `${s} `;
  return s;
}

// Returns { truth, csv, injected } where injected counts each kind of mess.
export function buildExport(month, seed) {
  const rand = mulberry32(seed);
  const truth = buildTruth(month, rand);
  const lines = [HEADER];
  const injected = { duplicate: 0, blank_row: 0, repeated_header: 0, export_footer: 0, missing_amount: 0, bad_date: 0 };
  const pickAlias = (dept) => { const a = DEPT_ALIASES[dept]; return a[Math.floor(rand() * a.length)]; };
  const mm = month.replace('-', '');

  truth.forEach((t, i) => {
    const line = [t.txnId, messyDate(t.date, rand), messyText(t.vendor, rand), pickAlias(t.department),
      messyText(t.category, rand), messyAmount(t.amount, rand), t.memo];
    lines.push(line);
    if (rand() < 0.04) { lines.push([...line]); injected.duplicate++; }
    if (i === Math.floor(truth.length / 3)) { lines.push(['', '', '', '', '', '', '']); injected.blank_row++; }
    if (i === Math.floor(truth.length / 2)) {
      lines.push([...HEADER]); injected.repeated_header++;          // page break in the export
      lines.push([`TXN-${mm}-9001`, `${month}-12`, 'Desk Depot', 'Admin', 'Office Supplies', '', 'Amount pending']);
      injected.missing_amount++;
    }
    if (i === Math.floor((truth.length * 3) / 4)) {
      lines.push([`TXN-${mm}-9002`, '31/31/2026', 'Prairie Air', 'Sales', 'Travel', '412.00', 'Date garbled in export']);
      injected.bad_date++;
    }
  });
  lines.push(['', '', '', '', '', '', '']); injected.blank_row++;
  lines.push(['TOTAL', '', '', '', '', '', `Exported ${truth.length} transactions`]); injected.export_footer++;

  return { truth, csv: toCsv(lines), injected };
}

// Budget per month/department/category, rounded to $100. Cents.
export function buildBudget(months, seed) {
  const rand = mulberry32(seed);
  const rows = [];
  for (const month of months) {
    for (const dept of DEPARTMENTS) {
      for (const cat of CATEGORIES) {
        let base = 0;
        if (cat === 'Payroll') base = PAYROLL[dept] * 2;
        else if (cat === 'Rent') base = dept === 'Admin' ? 14500 : 0;
        else {
          const [count, lo, hi] = PROFILE[cat];
          const share = cat === 'Software' ? (dept === 'IT' ? 0.62 : 0.127) : 0.25;
          base = count * ((lo + hi) / 2) * share;
        }
        if (base === 0) continue;
        // Payroll and rent are budgeted to the dollar; everything else is an estimate.
        const fixed = cat === 'Payroll' || cat === 'Rent';
        const b = fixed ? base : Math.round((base * (0.9 + rand() * 0.2)) / 100) * 100;
        rows.push({ month, department: dept, category: cat, budget: b * 100 });
      }
    }
  }
  return rows;
}
