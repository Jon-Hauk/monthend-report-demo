// Month-end numbers: actual vs budget vs prior month, by category and
// department. All amounts are integer cents until they reach the report.

import { CATEGORIES, DEPARTMENTS } from './sample.js';

const monthOf = (iso) => iso.slice(0, 7);

function line(name, actual, prior, budget) {
  return {
    name, actual, prior, budget,
    vsBudget: actual - budget,
    vsBudgetPct: budget ? (actual - budget) / budget : null,
    vsPrior: actual - prior,
    vsPriorPct: prior ? (actual - prior) / prior : null,
  };
}

export function summarize(rows, budget, period) {
  const months = [...new Set(rows.map((r) => monthOf(r.date)))].sort();
  period = period ?? months[months.length - 1];
  const prior = months.filter((m) => m < period).pop() ?? null;

  const sum = (pred) => rows.reduce((s, r) => (pred(r) ? s + r.amount : s), 0);
  const bsum = (pred) => budget.reduce((s, b) => (pred(b) ? s + b.budget : s), 0);
  const inP = (r) => monthOf(r.date) === period;
  const inPrior = (r) => prior !== null && monthOf(r.date) === prior;
  const bP = (b) => b.month === period;

  const byCategory = CATEGORIES.map((c) => line(c,
    sum((r) => inP(r) && r.category === c),
    sum((r) => inPrior(r) && r.category === c),
    bsum((b) => bP(b) && b.category === c)));

  const byDepartment = DEPARTMENTS.map((d) => line(d,
    sum((r) => inP(r) && r.department === d),
    sum((r) => inPrior(r) && r.department === d),
    bsum((b) => bP(b) && b.department === d)));

  const total = line('Total', sum(inP), sum(inPrior), bsum(bP));

  const periodRows = rows.filter(inP);
  const topVendors = Object.entries(periodRows.reduce((m, r) => { m[r.vendor] = (m[r.vendor] ?? 0) + r.amount; return m; }, {}))
    .map(([vendor, amount]) => ({ vendor, amount, count: periodRows.filter((r) => r.vendor === vendor).length }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const overBudget = byCategory.filter((c) => c.budget && c.vsBudgetPct > 0.1).sort((a, b) => b.vsBudget - a.vsBudget);

  return { period, prior, months, byCategory, byDepartment, total, topVendors, overBudget, transactionCount: periodRows.length };
}

export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
