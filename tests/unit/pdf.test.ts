import { describe, expect, it } from 'vitest';
import { pdfSafe, simplePdf, textWidth, wrap, type PdfLine } from '@/lib/pdf';
import { readPdf } from '../support/pdf';

// The PDF writer (src/lib/pdf.ts), read back by tests/support/pdf.ts as a reader would: accents and WinAnsi glyphs,
// lines wrapped to the page width, as many pages as needed with a footer on each, label columns, headings kept with
// what follows (point 21 of docs/reste-a-faire.md: comments of a circuit may run over a page).

/** Width of the text column of a page: A4 less two margins of 64 points. */
const WIDTH = 595 - 2 * 64;

describe('text made printable', () => {
  it('composes accents, turns spacing and line breaks into spaces, drops control and zero-width characters', () => {
    expect(pdfSafe('Re\u0301vision\u2009B ·\tA\r\nB\u200bC\u0007')).toBe('Révision B · A  BC');
  });

  it('keeps non-breaking spaces non-breaking: a figure and its unit stay on one row', () => {
    expect(pdfSafe('1\u202f200\u00a0€')).toBe('1\u00a0200\u00a0€');
    const rows = wrap(`${'mot '.repeat(18)}coût 1\u202f200\u00a0€`, 120, 10);
    expect(rows.at(-1)).toContain('1\u00a0200\u00a0€');
  });

  it('substitutes the few characters outside WinAnsi that have a plain equivalent', () => {
    expect(pdfSafe('A → B ≥ 2 − 1')).toBe('A -> B >= 2 - 1');
  });

  it('measures an accented letter as its base letter, and bold wider than regular', () => {
    expect(textWidth('été', 10)).toBe(textWidth('ete', 10));
    expect(textWidth('Approbation', 10, true)).toBeGreaterThan(textWidth('Approbation', 10));
  });
});

describe('wrapping', () => {
  const text = 'La révision B corrige le chapitre 4 (levage) et précise les contrôles avant manœuvre ; elle reprend les remarques du responsable qualité. '.repeat(6).trim();

  it('keeps every row within the width, and every word in order', () => {
    const rows = wrap(text, 300, 10);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(textWidth(r, 10)).toBeLessThanOrEqual(300);
    expect(rows.join(' ')).toBe(text);
  });

  it('starts a row at each line break, and gives one empty row for an empty text', () => {
    expect(wrap('Premier paragraphe\nSecond\r\n\nQuatrième', 300, 10)).toEqual(['Premier paragraphe', 'Second', '', 'Quatrième']);
    expect(wrap('', 300, 10)).toEqual(['']);
  });

  it('cuts a word wider than the row where it overflows', () => {
    const word = 'https://codex.example/documents/PRO-QUA-0001/approval?rev=B&download=1'.repeat(3);
    const rows = wrap(`Lien : ${word}`, 200, 10);
    for (const r of rows) expect(textWidth(r, 10)).toBeLessThanOrEqual(200);
    expect(rows.join('')).toBe(`Lien :${word}`);
  });
});

describe('the PDF read back', () => {
  it('prints French accents and the WinAnsi glyphs as they were given, with a title for readers', () => {
    const line = 'Révision approuvée — « œuvre » à 12 € ’ “Ç” déjà Î ü ÿ • …';
    const pdf = readPdf(simplePdf([{ text: line }], { title: 'Fiche de visa PRO-QUA-0001 Rév. B' }));
    expect(pdf.pages).toEqual([[line]]);
    expect(pdf.title).toBe('Fiche de visa PRO-QUA-0001 Rév. B');
  });

  it('escapes parentheses and backslashes, and prints what lies outside WinAnsi as a question mark', () => {
    const pdf = readPdf(simplePdf([{ text: 'Motif (voir § 4) : C:\\docs\\a.pdf' }, { text: 'Émoji 🙂 et 中' }]));
    expect(pdf.pages[0]).toEqual(['Motif (voir § 4) : C:\\docs\\a.pdf', 'Émoji ? et ?']);
  });

  it('keeps a short stand-in on one page, as the file route builds it', () => {
    const pdf = readPdf(simplePdf([{ text: 'PRO-QUA-0001 · A', size: 9, grey: true, gap: 0 }, { text: 'Titre', size: 16, gap: 40 }, { text: 'Propriétaire : owner', gap: 36 }]));
    expect(pdf.pages).toEqual([['PRO-QUA-0001 · A', 'Titre', 'Propriétaire : owner']]);
  });

  it('wraps a long line within the page and goes on over as many pages as needed, with a footer on each', () => {
    const lines: PdfLine[] = Array.from({ length: 80 }, (_, i) => ({ text: `Ligne ${i + 1}`, size: 10 }));
    const long = 'Commentaire du circuit : '.concat('le contrôle des élingues est désormais quotidien. '.repeat(120)).trim();
    lines.push({ text: long, size: 10 });
    const pdf = readPdf(simplePdf(lines, { footer: (page, pages) => `PRO-QUA-0001 · Page ${page}/${pages}` }));
    expect(pdf.pages.length).toBeGreaterThanOrEqual(3);
    pdf.pages.forEach((rows, i) => expect(rows.at(-1)).toBe(`PRO-QUA-0001 · Page ${i + 1}/${pdf.pages.length}`));
    const body = pdf.pages.flatMap((rows) => rows.slice(0, -1));
    expect(body.slice(0, 80)).toEqual(lines.slice(0, 80).map((l) => l.text));
    expect(body.slice(80).join(' ')).toBe(long);
    for (const r of body) expect(textWidth(r, 10)).toBeLessThanOrEqual(WIDTH);
  });

  it('prints a label in its own column before the text, both wrapped', () => {
    const pdf = readPdf(simplePdf([{ label: 'Identifiant', text: 'PRO-QUA-0001', size: 10 }, { label: 'Motif du rejet', text: 'mot '.repeat(150).trim(), size: 10 }]));
    expect(pdf.pages[0][0]).toBe('Identifiant PRO-QUA-0001');
    expect(pdf.pages[0][1].startsWith('Motif du rejet mot mot')).toBe(true);
    expect(pdf.pages[0].length).toBeGreaterThan(3);
  });

  it('sets bold lines in Helvetica-Bold', () => {
    const pdf = readPdf(simplePdf([{ text: 'Circuit de validation W-2', bold: true }, { text: 'Demandé par writer' }]));
    expect(pdf.fonts.get('Circuit de validation W-2')).toBe('F2');
    expect(pdf.fonts.get('Demandé par writer')).toBe('F1');
  });

  it('never leaves a heading alone at the foot of a page', () => {
    // 35 lines fill the first page down to its last baseline but one: the heading fits there, the line under it does not.
    const filler: PdfLine[] = Array.from({ length: 35 }, (_, i) => ({ text: `Ligne ${i + 1}`, size: 10, gap: 20 }));
    const heading = (keep?: number): PdfLine => ({ text: 'Commentaires', bold: true, size: 10, keep });
    const loose = readPdf(simplePdf([...filler, heading(), { text: 'Vu, conforme.', size: 10 }]));
    expect(loose.pages.map((p) => p.at(-1))).toEqual(['Commentaires', 'Vu, conforme.']);
    const kept = readPdf(simplePdf([...filler, heading(1), { text: 'Vu, conforme.', size: 10 }]));
    expect(kept.pages.map((p) => p.at(-1))).toEqual(['Ligne 35', 'Vu, conforme.']);
    expect(kept.pages[1]).toEqual(['Commentaires', 'Vu, conforme.']);
  });
});
