// Minimal RFC 4180 CSV reader/writer. Handles quoted fields, escaped quotes
// and newlines inside quotes, and keeps the source line number of each record
// so the cleaning log can point at the exact line in the original export.

export function parseCsv(text) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;

  const pushRow = () => {
    row.push(field);
    records.push({ line: rowStart, cells: row });
    row = [];
    field = '';
  };

  // Strip a UTF-8 BOM if the export tool added one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* ignore, \n ends the row */ }
    else if (ch === '\n') { pushRow(); line++; rowStart = line; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) pushRow();
  return records;
}

export function toCsv(rows) {
  return rows
    .map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n') + '\n';
}
