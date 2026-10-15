// Minimal PDF writer, without dependency: A4 pages, Helvetica and Helvetica-Bold in WinAnsi encoding (French accents,
// œ, €, typographic quotes), lines wrapped to the page width and as many pages as the text needs, an optional footer
// on every page. Used for the stand-in file of records that have no stored file (the seeded demo documents) and for
// the approval record of a revision (lib/approval.ts).

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 64;
/** Baseline of the first line of a page, and lowest baseline before the footer. */
const TOP = 770;
const BOTTOM = 72;
const FOOTER_Y = 40;

const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Characters outside WinAnsi that have a plain equivalent; any other one prints as '?'. Non-breaking spaces stay so. */
const SUBSTITUTES: Record<string, string> = {
  '\u2007': '\u00a0', '\u202f': '\u00a0', '\u2009': ' ', '\u2010': '-', '\u2011': '-', '\u2212': '-',
  '→': '->', '←': '<-', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '✓': 'v', '✔': 'v',
};

/**
 * Text as the PDF prints it on one row: composed accents (NFC), tabs and line breaks as spaces (wrap() splits on line
 * breaks first), control and zero-width characters removed, substitutes for a few characters outside WinAnsi.
 */
export function pdfSafe(text: string): string {
  return [...text.normalize('NFC').replace(/[\t\n\v\f\r]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g, '')]
    .map((ch) => SUBSTITUTES[ch] ?? ch)
    .join('');
}

/** WinAnsi bytes of a text already made safe, with the string escapes of the PDF syntax. */
function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    const byte = code <= 0xff && ch.length === 1 ? code : 0x3f; // '?' for anything outside WinAnsi
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return out;
}

// ── Measuring and wrapping ───────────────────────────────────────────────

// Glyph widths (1/1000 em) of the standard Helvetica fonts, from their AFM metrics, for ASCII 32-126.
const ASCII = {
  regular: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
};
/** Other WinAnsi glyphs whose width is not that of their base letter: [regular, bold]. */
const WIDE: Record<string, [number, number]> = {
  '\u00a0': [278, 278], '€': [556, 556], '‚': [222, 278], '„': [333, 500], '…': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500],
  '•': [350, 350], '–': [556, 556], '—': [1000, 1000], '‰': [1000, 1000], '™': [1000, 1000], 'œ': [944, 944], 'Œ': [1000, 1000], 'æ': [889, 889], 'Æ': [1000, 1000],
  '«': [556, 556], '»': [556, 556], '‹': [333, 333], '›': [333, 333], '°': [400, 400], '·': [278, 278], '×': [584, 584], 'ß': [611, 611], '§': [556, 556], '©': [737, 737], '®': [737, 737],
};

function charWidth(ch: string, bold: boolean): number {
  const table = bold ? ASCII.bold : ASCII.regular;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  const wide = WIDE[ch];
  if (wide) return wide[bold ? 1 : 0];
  // An accented letter is as wide as its base letter (é as e); anything else is printed as '?', or about as wide.
  const base = ch.normalize('NFD').charCodeAt(0);
  return base >= 32 && base <= 126 && ch.length === 1 ? table[base - 32] : table[0x3f - 32];
}

/** Width in points of a text already made safe (pdfSafe), set at `size`. */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/**
 * Rows of a text that fit `width` points at `size`: one paragraph per line break, words (between plain spaces: a
 * non-breaking space holds « 1 200 € » together) kept whole when they fit, a word longer than the width cut where it
 * overflows. An empty text gives one empty row.
 */
export function wrap(text: string, width: number, size: number, bold = false): string[] {
  const rows: string[] = [];
  for (const para of text.split(/\r\n|\r|\n/)) {
    const words = pdfSafe(para).split(' ').filter(Boolean);
    let row = '';
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (textWidth(candidate, size, bold) <= width) {
        row = candidate;
        continue;
      }
      if (row) rows.push(row);
      row = '';
      // A word wider than the line (an address, a long reference) is cut into pieces that fit.
      let piece = '';
      for (const ch of word) {
        if (piece && textWidth(piece + ch, size, bold) > width) {
          rows.push(piece);
          piece = '';
        }
        piece += ch;
      }
      row = piece;
    }
    rows.push(row);
  }
  return rows;
}

// ── Layout ───────────────────────────────────────────────────────────────

/**
 * One line of text, wrapped as needed. `gap`: distance from the previous baseline (default 1.6 × size; ignored at the
 * top of a page). `indent`: from the left margin. `label`: printed grey in a column of `labelWidth` points before the
 * text, both wrapped in their own column. `keep`: lines of body text that must fit under it on the same page (a
 * heading is never left alone at the foot of a page).
 */
export type PdfLine = { text: string; size?: number; gap?: number; grey?: boolean; bold?: boolean; indent?: number; label?: string; labelWidth?: number; keep?: number };

/** `title`: document title shown by PDF readers. `footer`: text at the foot of each page, given its number and the count. */
export type PdfOptions = { title?: string; footer?: (page: number, pages: number) => string };

type Run = { x: number; y: number; size: number; bold: boolean; grey: boolean; text: string };

function layout(lines: PdfLine[]): Run[][] {
  const pages: Run[][] = [[]];
  let y = TOP;
  let fresh = true;
  const newPage = () => {
    pages.push([]);
    y = TOP;
    fresh = true;
  };
  for (const l of lines) {
    const size = l.size ?? 11;
    const bold = !!l.bold;
    const left = MARGIN + (l.indent ?? 0);
    const labelWidth = l.label != null ? l.labelWidth ?? 130 : 0;
    const textX = left + labelWidth;
    const rows = wrap(l.text, PAGE_W - MARGIN - textX, size, bold);
    const labels = l.label != null ? wrap(l.label, labelWidth - 8, size) : [];
    const count = Math.max(rows.length, labels.length);
    const lead = size * 1.35;
    let gap = fresh ? 0 : l.gap ?? size * 1.6;
    // Short lines move to the next page whole; a long paragraph starts here and goes on over the next pages.
    const need = gap + Math.min(count - 1, 3) * lead + (l.keep ?? 0) * 11 * 1.6;
    if (!fresh && y - need < BOTTOM) {
      newPage();
      gap = 0;
    }
    y -= gap;
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        y -= lead;
        if (y < BOTTOM) newPage();
      }
      const page = pages[pages.length - 1];
      if (labels[i]) page.push({ x: left, y, size, bold: false, grey: true, text: labels[i] });
      if (rows[i]) page.push({ x: textX, y, size, bold, grey: !!l.grey, text: rows[i] });
    }
    fresh = false;
  }
  return pages;
}

/** UTF-16BE hex string with its byte order mark, for the document information dictionary. */
function utf16(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

export function simplePdf(lines: PdfLine[], opts: PdfOptions = {}): Buffer {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const pages = layout(lines);
  if (opts.footer) {
    pages.forEach((runs, i) => runs.push({ x: MARGIN, y: FOOTER_Y, size: 8, bold: false, grey: true, text: pdfSafe(opts.footer!(i + 1, pages.length)) }));
  }

  // Objects: 1 catalog, 2 page tree, 3-4 fonts, 5 information, then a page and its content stream for each page.
  const first = 6;
  const objects: number[][] = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii(`<< /Type /Pages /Kids [${pages.map((_, i) => `${first + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    ascii(`<< /Producer (Codex)${opts.title ? ` /Title ${utf16(opts.title)}` : ''} >>`),
  ];
  pages.forEach((runs, i) => {
    const content: number[] = [];
    for (const r of runs) {
      const head = `BT ${r.grey ? '0.45 0.47 0.55 rg' : '0.16 0.17 0.19 rg'} /${r.bold ? 'F2' : 'F1'} ${r.size} Tf ${r.x.toFixed(1)} ${r.y.toFixed(1)} Td (`;
      content.push(...ascii(head), ...encode(r.text), ...ascii(') Tj ET\n'));
    }
    objects.push(ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${first + 2 * i + 1} 0 R >>`));
    objects.push([...ascii(`<< /Length ${content.length} >>\nstream\n`), ...content, ...ascii('\nendstream')]);
  });

  const chunks: number[][] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: number[]) => { chunks.push(bytes); length += bytes.length; };
  push([...ascii('%PDF-1.4\n'), 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  objects.forEach((body, i) => {
    offsets.push(length);
    push([...ascii(`${i + 1} 0 obj\n`), ...body, ...ascii('\nendobj\n')]);
  });
  const xref = length;
  push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`));
  push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.from(chunks.flat());
}
