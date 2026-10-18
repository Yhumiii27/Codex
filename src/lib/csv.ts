type Cell = string | number | null | undefined;

/** One RFC 4180 line (semicolons, CRLF), formulas in user-controlled text neutralised. */
export function csvRow(r: Cell[]): string {
  const cell = (v: Cell) => {
    const s = v == null ? '' : String(v);
    // Neutralise spreadsheet formulas in user-controlled text.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return r.map(cell).join(';') + '\r\n';
}

/** RFC 4180 CSV with a BOM and semicolons, so Excel (fr-FR) opens it with accents and columns intact. */
export function csv(rows: Cell[][]): string {
  return '﻿' + rows.map(csvRow).join('');
}

export function csvHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, { headers: csvHeaders(filename) });
}

/**
 * Reads a CSV as csv() writes it, or as a spreadsheet saves it back: BOM dropped, semicolons (commas when the first
 * line has no semicolon), quoted cells with "" and line breaks, CRLF or LF. Lines left wholly empty are dropped.
 * The quote csvRow() puts before a formula is kept: unneutralise() takes it off where a value is compared.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = firstLine.includes(';') || !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === sep) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' && src[i + 1] === '\n') { endRow(); i += 2; continue; }
    if (ch === '\n' || ch === '\r') { endRow(); i++; continue; }
    cell += ch;
    i++;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** A cell read back: the quote csvRow() put before a formula taken off. */
export function unneutralise(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}
