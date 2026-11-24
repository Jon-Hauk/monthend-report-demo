// One-page PDF summary for people who won't open the workbook.

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { monthLabel } from './summary.js';

const NAVY = '#1F3A5F';
const GREY = '#666666';
const RED = '#B42318';
const GREEN = '#1E7B45';
const BAR_ACTUAL = '#2F6DB5';
const BAR_BUDGET = '#C9D6E6';

const money = (c, dp = 0) => {
  const v = Math.abs(c) / 100;
  const s = '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return c < 0 ? `(${s})` : s;
};
const pct = (p) => (p === null ? '–' : `${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}%`);

export function writePdf(path, s, issues, stats) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER', margin: 40,
      info: { Title: `Month-end summary ${s.period}`, Author: 'monthend-report-demo', CreationDate: new Date(Date.UTC(2026, 10, 1)) },
    });
    const out = fs.createWriteStream(path);
    doc.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);

    const L = 40, W = 532;

    // Header
    doc.rect(0, 0, 612, 70).fill(NAVY);
    doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(`Month-end expense summary: ${monthLabel(s.period)}`, L, 22);
    doc.font('Helvetica').fontSize(9).text('Example Co. Synthetic data generated for a portfolio demo. Not a real company.', L, 48);

    // KPI tiles
    const tiles = [
      ['Total spend', money(s.total.actual), null],
      ['vs budget', money(s.total.vsBudget), pct(s.total.vsBudgetPct)],
      [`vs ${monthLabel(s.prior)}`, money(s.total.vsPrior), pct(s.total.vsPriorPct)],
      ['Transactions', String(s.transactionCount), 'after cleaning'],
    ];
    const tw = (W - 3 * 10) / 4;
    tiles.forEach(([label, value, sub], i) => {
      const x = L + i * (tw + 10), y = 88;
      doc.roundedRect(x, y, tw, 62, 4).fill('#F2F5F9');
      doc.fill(GREY).font('Helvetica').fontSize(8).text(label.toUpperCase(), x + 10, y + 9, { width: tw - 20 });
      const over = i === 1 && s.total.vsBudget > 0;
      doc.fill(i === 1 ? (over ? RED : GREEN) : NAVY).font('Helvetica-Bold').fontSize(16).text(value, x + 10, y + 22, { width: tw - 20 });
      if (sub) doc.fill(GREY).font('Helvetica').fontSize(8).text(sub, x + 10, y + 44, { width: tw - 20 });
    });

    // Bar chart: actual vs budget by category
    let y = 170;
    doc.fill(NAVY).font('Helvetica-Bold').fontSize(12).text('Spend by category: actual vs budget', L, y);
    y += 20;
    doc.rect(L, y, 8, 8).fill(BAR_ACTUAL); doc.fill(GREY).font('Helvetica').fontSize(8).text('Actual', L + 12, y);
    doc.rect(L + 60, y, 8, 8).fill(BAR_BUDGET); doc.fill(GREY).text('Budget', L + 72, y);
    y += 16;
    const cats = [...s.byCategory].sort((a, b) => b.actual - a.actual);
    const max = Math.max(...cats.map((c) => Math.max(c.actual, c.budget)));
    const labelW = 100, valueW = 120, barW = W - labelW - valueW;
    for (const c of cats) {
      doc.fill('#222222').font('Helvetica').fontSize(9).text(c.name, L, y + 3, { width: labelW - 6 });
      doc.rect(L + labelW, y, Math.max(1, (c.budget / max) * barW), 16).fill(BAR_BUDGET);
      doc.rect(L + labelW, y + 4, Math.max(1, (c.actual / max) * barW), 8).fill(BAR_ACTUAL);
      const over = c.budget && c.vsBudgetPct > 0.1;
      doc.fill(over ? RED : '#222222').font(over ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(`${money(c.actual)}  ${pct(c.vsBudgetPct)}`, L + labelW + barW + 6, y + 3, { width: valueW - 6, align: 'right' });
      y += 22;
    }

    // Department table
    y += 14;
    doc.fill(NAVY).font('Helvetica-Bold').fontSize(12).text('By department', L, y);
    y += 20;
    const cols = [['Department', 110, 'left'], ['Budget', 85, 'right'], ['Actual', 85, 'right'], ['Over/(under)', 85, 'right'], ['%', 50, 'right'], ['vs prior month', 117, 'right']];
    const drawRow = (cells, bold, fill) => {
      if (fill) doc.rect(L, y - 3, W, 17).fill(fill);
      let x = L;
      cells.forEach((v, i) => {
        const [, w, align] = cols[i];
        const neg = typeof v === 'object';
        doc.fill(neg ? v.color : '#222222').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
          .text(neg ? v.text : v, x + 4, y, { width: w - 8, align });
        x += w;
      });
      y += 17;
    };
    drawRow(cols.map((c) => c[0]), true, '#E8EEF5');
    const colored = (c, text) => ({ text, color: c > 0 ? RED : c < 0 ? GREEN : '#222222' });
    for (const d of [...s.byDepartment, s.total]) {
      drawRow([d.name, money(d.budget), money(d.actual), colored(d.vsBudget, money(d.vsBudget)), colored(d.vsBudget, pct(d.vsBudgetPct)), money(d.vsPrior)],
        d.name === 'Total', d.name === 'Total' ? '#F2F5F9' : null);
    }

    // Notes
    y += 16;
    doc.fill(NAVY).font('Helvetica-Bold').fontSize(12).text('Notes', L, y);
    y += 18;
    const followUp = issues.filter((i) => i.action.startsWith('Excluded'));
    const dupes = issues.filter((i) => i.issue.startsWith('Duplicate')).length;
    const notes = [
      s.overBudget.length
        ? `Over budget by more than 10%: ${s.overBudget.map((c) => `${c.name} (${pct(c.vsBudgetPct)}, ${money(c.vsBudget)})`).join('; ')}.`
        : 'No category is more than 10% over budget.',
      ...s.topVendors.filter((v) => v.vendor !== 'Payroll Run').slice(0, 1)
        .map((v) => `Largest supplier this month (excluding payroll): ${v.vendor} at ${money(v.amount)} across ${v.count} transaction(s).`),
      `Cleaning: ${stats.linesRead} export lines read, ${stats.kept} transactions kept, ${dupes} duplicate line(s) removed, ${stats.datesReformatted} dates and ${stats.amountsReformatted} amounts reformatted.`,
      followUp.length
        ? `${followUp.length} line(s) excluded and need follow-up: ${followUp.map((i) => `${i.txnId || 'line ' + i.line} (${i.issue.split(' "')[0].toLowerCase()})`).join(', ')}. See the Data Issues tab.`
        : 'No lines need follow-up.',
    ];
    doc.fill('#222222').font('Helvetica').fontSize(9);
    for (const n of notes) { doc.text(`•  ${n}`, L, y, { width: W }); y = doc.y + 5; }

    doc.page.margins.bottom = 0; // keep the footer on this page
    doc.fill(GREY).fontSize(7).text('Generated by monthend-report-demo from synthetic exports. Full detail in the Excel workbook.', L, 760, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}
