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
