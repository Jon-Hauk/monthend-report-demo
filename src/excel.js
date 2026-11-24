// Writes the month-end workbook. Variance and total columns are real Excel
// formulas (with cached results), so the file stays live if someone edits a
// budget figure.

import ExcelJS from 'exceljs';
import { monthLabel } from './summary.js';

const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00';
const MONEY0 = '"$"#,##0;[Red]-"$"#,##0';
const PCT = '0.0%;[Red]-0.0%';
const NAVY = 'FF1F3A5F';
const LIGHT = 'FFE8EEF5';
const dollars = (c) => Math.round(c) / 100;

function headerRow(ws, rowNo) {
  const row = ws.getRow(rowNo);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 30;
}

function redIfPositive(ws, ref) {
  ws.addConditionalFormatting({
    ref,
    rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0.1'], priority: 1,
      style: { font: { color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } }],
  });
}

function varianceSheet(wb, name, label, lines, total, s) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: label, width: 20 },
    { header: `Budget\n${monthLabel(s.period)}`, width: 15, style: { numFmt: MONEY } },
    { header: `Actual\n${monthLabel(s.period)}`, width: 15, style: { numFmt: MONEY } },
    { header: 'Over / (under)\nbudget', width: 15, style: { numFmt: MONEY } },
    { header: 'Over / (under)\n%', width: 12, style: { numFmt: PCT } },
    { header: `Actual\n${monthLabel(s.prior)}`, width: 15, style: { numFmt: MONEY } },
    { header: 'Change vs\nprior month', width: 15, style: { numFmt: MONEY } },
    { header: 'Change\n%', width: 11, style: { numFmt: PCT } },
  ];
  headerRow(ws, 1);
  lines.forEach((l, i) => {
    const r = i + 2;
    ws.addRow([
      l.name, dollars(l.budget), dollars(l.actual),
      { formula: `C${r}-B${r}`, result: dollars(l.vsBudget) },
      { formula: `IF(B${r}=0,"",D${r}/B${r})`, result: l.vsBudgetPct ?? '' },
      dollars(l.prior),
      { formula: `C${r}-F${r}`, result: dollars(l.vsPrior) },
      { formula: `IF(F${r}=0,"",G${r}/F${r})`, result: l.vsPriorPct ?? '' },
    ]);
  });
  const last = lines.length + 1;
  const t = last + 1;
  const totalRow = ws.addRow([
    'Total',
    { formula: `SUM(B2:B${last})`, result: dollars(total.budget) },
    { formula: `SUM(C2:C${last})`, result: dollars(total.actual) },
    { formula: `C${t}-B${t}`, result: dollars(total.vsBudget) },
    { formula: `IF(B${t}=0,"",D${t}/B${t})`, result: total.vsBudgetPct ?? '' },
    { formula: `SUM(F2:F${last})`, result: dollars(total.prior) },
    { formula: `C${t}-F${t}`, result: dollars(total.vsPrior) },
    { formula: `IF(F${t}=0,"",G${t}/F${t})`, result: total.vsPriorPct ?? '' },
  ]);
  totalRow.font = { bold: true };
  totalRow.eachCell((c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; });
  redIfPositive(ws, `E2:E${last}`);
  ws.addRow([]);
  ws.addRow(['Red cells: more than 10% over budget. Negative figures are under budget or lower than last month.']).font = { italic: true, color: { argb: 'FF666666' } };
  return ws;
}

export async function writeWorkbook(path, s, rows, issues, stats) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'monthend-report-demo';
  wb.created = wb.modified = new Date(Date.UTC(2026, 10, 1));
  wb.calcProperties.fullCalcOnLoad = true; // Excel recomputes every formula on open

  // --- Summary ---------------------------------------------------------------
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: NAVY } } });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 14 }];
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = `Month-end expense summary: ${monthLabel(s.period)}`;
  ws.getCell('A1').font = { size: 16, bold: true, color: { argb: NAVY } };
  ws.getCell('A2').value = 'Example Co. (synthetic data, generated for this demo)';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  const kpi = [
    ['Total spend', dollars(s.total.actual), MONEY],
    ['Budget', dollars(s.total.budget), MONEY],
    ['Over / (under) budget', dollars(s.total.vsBudget), MONEY],
    ['Over / (under) budget %', s.total.vsBudgetPct, PCT],
    [`Change vs ${monthLabel(s.prior)}`, dollars(s.total.vsPrior), MONEY],
    ['Change vs prior month %', s.total.vsPriorPct, PCT],
    ['Transactions this month', s.transactionCount, '#,##0'],
  ];
  kpi.forEach(([k, v, fmt], i) => {
    const r = ws.getRow(4 + i);
    r.getCell(1).value = k; r.getCell(1).font = { bold: true };
    r.getCell(2).value = v; r.getCell(2).numFmt = fmt;
  });

  let r = 4 + kpi.length + 1;
  ws.getCell(`A${r}`).value = 'Categories more than 10% over budget'; ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: NAVY } };
  r++;
  ws.getRow(r).values = ['Category', 'Over budget', 'Over budget %']; headerRow(ws, r); ws.getRow(r).height = 18;
  if (!s.overBudget.length) { r++; ws.getCell(`A${r}`).value = 'None'; }
  for (const c of s.overBudget) {
    r++;
    ws.getRow(r).values = [c.name, dollars(c.vsBudget), c.vsBudgetPct];
    ws.getCell(`B${r}`).numFmt = MONEY; ws.getCell(`C${r}`).numFmt = PCT;
  }

  r += 2;
  ws.getCell(`A${r}`).value = 'Top vendors this month'; ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: NAVY } };
  r++;
  ws.getRow(r).values = ['Vendor', 'Spend', 'Transactions']; headerRow(ws, r); ws.getRow(r).height = 18;
  for (const v of s.topVendors) {
    r++;
    ws.getRow(r).values = [v.vendor, dollars(v.amount), v.count];
    ws.getCell(`B${r}`).numFmt = MONEY;
  }

  r += 2;
  ws.getCell(`A${r}`).value = 'Data cleaning'; ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: NAVY } };
  const cleaning = [
    ['Lines read from exports', stats.linesRead],
    ['Transactions kept', stats.kept],
    ['Lines skipped or excluded (see Data Issues)', issues.length],
    ['  of which need follow-up', issues.filter((i) => i.action.startsWith('Excluded')).length],
    ['Dates reformatted', stats.datesReformatted],
    ['Amounts reformatted ($, commas, brackets)', stats.amountsReformatted],
    ['Department names standardised', stats.departmentsRenamed],
    ['Category names standardised', stats.categoriesFixed],
    ['Vendor names standardised', stats.vendorsFixed],
  ];
  for (const [k, v] of cleaning) { r++; ws.getRow(r).values = [k, v]; ws.getCell(`B${r}`).numFmt = '#,##0'; }

  // --- Variance sheets --------------------------------------------------------
  varianceSheet(wb, 'By Category', 'Category', s.byCategory, s.total, s);
  varianceSheet(wb, 'By Department', 'Department', s.byDepartment, s.total, s);

  // --- Transactions -----------------------------------------------------------
  const tx = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
  tx.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Txn ID', key: 'txnId', width: 16 },
    { header: 'Vendor', key: 'vendor', width: 26 },
    { header: 'Department', key: 'department', width: 13 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: MONEY } },
    { header: 'Memo', key: 'memo', width: 30 },
    { header: 'Source file', key: 'source', width: 30 },
  ];
  headerRow(tx, 1); tx.getRow(1).height = 20;
  for (const row of rows) {
    const [y, m, d] = row.date.split('-').map(Number);
    tx.addRow({ ...row, month: row.date.slice(0, 7), date: new Date(Date.UTC(y, m - 1, d)), amount: dollars(row.amount) });
  }
  tx.autoFilter = { from: 'A1', to: 'I1' };

  // --- Data issues ------------------------------------------------------------
  const di = wb.addWorksheet('Data Issues', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FFC0504D' } } });
  di.columns = [
    { header: 'Source file', key: 'source', width: 30 },
    { header: 'Line', key: 'line', width: 7 },
    { header: 'Txn ID', key: 'txnId', width: 16 },
    { header: 'Issue', key: 'issue', width: 44 },
    { header: 'Action', key: 'action', width: 26 },
    { header: 'Original line', key: 'raw', width: 70 },
  ];
  headerRow(di, 1); di.getRow(1).height = 20;
  issues.forEach((i) => {
    const row = di.addRow(i);
    if (i.action.startsWith('Excluded')) row.getCell('action').font = { bold: true, color: { argb: 'FF9C0006' } };
  });
  di.autoFilter = { from: 'A1', to: 'F1' };

  await wb.xlsx.writeFile(path);
}
