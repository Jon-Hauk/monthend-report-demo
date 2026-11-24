import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDate, normalizeDepartment, normalizeCategory, cleanExport } from '../src/clean.js';
import { parseCsv, toCsv } from '../src/csv.js';
import { buildExport, buildBudget, HEADER, VENDORS } from '../src/sample.js';
const vendors = Object.values(VENDORS).flat();
import { summarize } from '../src/summary.js';
import { SAMPLE, BUDGET_SEED } from '../src/generate.js';

test('amounts: currency symbols, commas, brackets and minus signs', () => {
  assert.equal(parseAmount('1234.5'), 123450);
  assert.equal(parseAmount('$1,234.50'), 123450);
  assert.equal(parseAmount('(45.00)'), -4500);
  assert.equal(parseAmount('-$1,045.10'), -104510);
  assert.equal(parseAmount(' 900 '), 90000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('abc'), null);
});

test('dates: ISO, slashes, US MM/DD/YYYY and D-Mon-YYYY; rejects impossible dates', () => {
  assert.equal(parseDate('2026-10-03'), '2026-10-03');
  assert.equal(parseDate(' 2026/10/03 '), '2026-10-03');
  assert.equal(parseDate('10/03/2026'), '2026-10-03');
  assert.equal(parseDate('3-Oct-2026'), '2026-10-03');
  assert.equal(parseDate('31/31/2026'), null);
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate(''), null);
});

test('department and category names are standardised', () => {
  assert.equal(normalizeDepartment('OPS'), 'Operations');
  assert.equal(normalizeDepartment('operations '), 'Operations');
  assert.equal(normalizeDepartment('I.T.'), 'IT');
  assert.equal(normalizeDepartment('Administration'), 'Admin');
  assert.equal(normalizeDepartment('Legal'), null);
  assert.equal(normalizeCategory('OFFICE SUPPLIES '), 'Office Supplies');
  assert.equal(normalizeCategory('software'), 'Software');
});

test('csv round-trips quoted fields with commas and quotes', () => {
  const rows = [['a', 'b, c', 'say "hi"'], ['1', '', 'x']];
  assert.deepEqual(parseCsv(toCsv(rows)).map((r) => r.cells), rows);
});

for (const s of SAMPLE) {
  test(`${s.month}: cleaned output reconciles exactly to the source of truth`, () => {
    const { truth, csv, injected } = buildExport(s.month, s.seed);
    const { rows, issues } = cleanExport(csv, 'sample.csv', { vendors });

    assert.equal(rows.length, truth.length, 'every real transaction kept once');
    const byId = new Map(rows.map((r) => [r.txnId, r]));
    for (const t of truth) {
      const r = byId.get(t.txnId);
      assert.ok(r, `${t.txnId} missing`);
      for (const k of ['date', 'vendor', 'department', 'category', 'amount']) assert.equal(r[k], t[k], `${t.txnId}.${k}`);
    }
    const total = (xs) => xs.reduce((a, x) => a + x.amount, 0);
    assert.equal(total(rows), total(truth), 'totals match to the cent');

    const count = (pred) => issues.filter(pred).length;
    assert.equal(count((i) => i.issue.startsWith('Duplicate')), injected.duplicate);
    assert.equal(count((i) => i.issue === 'Blank row'), injected.blank_row);
    assert.equal(count((i) => i.issue.startsWith('Repeated header')), injected.repeated_header);
    assert.equal(count((i) => i.issue.startsWith('Export footer')), injected.export_footer);
    assert.equal(count((i) => i.issue.startsWith('Missing or unreadable amount')), injected.missing_amount);
    assert.equal(count((i) => i.issue.startsWith('Unreadable date')), injected.bad_date);
    assert.ok(issues.every((i) => Number.isInteger(i.line) && i.line > 1), 'every issue points at a source line');
  });
}

test('a reused Txn ID with different details is excluded, not silently merged', () => {
  const csv = toCsv([HEADER,
    ['TXN-1', '2026-10-01', 'Paperhaus', 'Admin', 'Office Supplies', '10.00', ''],
    ['TXN-1', '2026-10-02', 'Paperhaus', 'Admin', 'Office Supplies', '99.00', '']]);
  const { rows, issues } = cleanExport(csv, 't.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1000);
  assert.match(issues[0].issue, /reused/);
  assert.match(issues[0].action, /^Excluded/);
});

test('a file that does not start with the expected header is rejected', () => {
  assert.throws(() => cleanExport('Date,Amount\n2026-10-01,5\n', 'bad.csv'), /expected header/);
});

test('summary: category and department totals agree, variance = actual - budget', () => {
  const rows = SAMPLE.flatMap((s) => cleanExport(buildExport(s.month, s.seed).csv, 'x', { vendors }).rows);
  const s = summarize(rows, buildBudget(SAMPLE.map((x) => x.month), BUDGET_SEED));
  assert.equal(s.period, '2026-10');
  assert.equal(s.prior, '2026-09');
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  for (const k of ['actual', 'prior', 'budget']) {
    assert.equal(sum(s.byCategory, k), s.total[k], `category ${k}`);
    assert.equal(sum(s.byDepartment, k), s.total[k], `department ${k}`);
  }
  for (const l of [...s.byCategory, ...s.byDepartment, s.total]) assert.equal(l.vsBudget, l.actual - l.budget);
});

test('vendor names: master list wins, then mixed-case spelling, then title case', () => {
  const csv = toCsv([HEADER,
    ['T1', '2026-10-01', 'FIBERNORTH', 'IT', 'Utilities', '10', ''],
    ['T2', '2026-10-02', 'desk depot ', 'Admin', 'Office Supplies', '10', ''],
    ['T3', '2026-10-03', 'Desk Depot', 'Admin', 'Office Supplies', '10', ''],
    ['T4', '2026-10-04', 'NEW VENDOR & SONS', 'Sales', 'Marketing', '10', '']]);
  const names = (opts) => cleanExport(csv, 't.csv', opts).rows.map((r) => r.vendor);
  assert.deepEqual(names({ vendors: ['FiberNorth'] }), ['FiberNorth', 'Desk Depot', 'Desk Depot', 'New Vendor & Sons']);
  assert.deepEqual(names({}), ['Fibernorth', 'Desk Depot', 'Desk Depot', 'New Vendor & Sons']);
});