import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { simplePdf } from '@/lib/pdf';
import { countPdfPages, normalizeMime } from '@/lib/storage';

// File types and PDF page counts of uploaded files (src/lib/storage.ts); nothing here touches a store.

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('normalizeMime', () => {
  it('keeps the declared type, bare and in lower case', () => {
    expect(normalizeMime('Application/PDF; charset=binary', 'plan.pdf')).toBe(PDF);
    expect(normalizeMime('image/png', 'photo.png')).toBe('image/png');
    expect(normalizeMime('image/png', 'photo.pdf')).toBe('image/png');
  });

  it('infers a missing or generic type from the extension', () => {
    expect(normalizeMime('', 'note.docx')).toBe(DOCX);
    expect(normalizeMime(null, 'Plan.PDF')).toBe(PDF);
    expect(normalizeMime(undefined, 'photo.jpeg')).toBe('image/jpeg');
    expect(normalizeMime('application/octet-stream', 'tableau.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(normalizeMime('application/octet-stream', 'ancien.ppt')).toBe('application/vnd.ms-powerpoint');
  });

  it('takes text/plain for a non-text file as generic (a multipart part without Content-Type)', () => {
    expect(normalizeMime('text/plain', 'scan.pdf')).toBe(PDF);
    expect(normalizeMime('text/plain', 'notes.txt')).toBe('text/plain');
    expect(normalizeMime('text/plain', 'export.csv')).toBe('text/plain');
    expect(normalizeMime('text/plain', 'serveur.log')).toBe('text/plain');
  });

  it('recognises a PDF by its signature when the bytes are at hand', () => {
    const pdf = Buffer.from('%PDF-1.7\n%…');
    expect(normalizeMime('', 'sans-extension', pdf)).toBe(PDF);
    expect(normalizeMime('application/octet-stream', 'scan.bin', pdf)).toBe(PDF);
    expect(normalizeMime('text/plain', 'scan.dat', pdf)).toBe(PDF);
    expect(normalizeMime('', 'sans-extension', Buffer.from('PK\x03\x04'))).toBe('application/octet-stream');
  });

  it('falls back to a generic type for an unknown extension', () => {
    expect(normalizeMime('', 'archive.xyz')).toBe('application/octet-stream');
    expect(normalizeMime('application/octet-stream', 'archive.xyz')).toBe('application/octet-stream');
  });

  // Known gap, reported with this test: text/plain sent for a file that is not text is generic (normalizeMime's own
  // rule), yet with an extension Codex does not know (.dwg, .xyz…) the declared text/plain is kept. A drawing posted to
  // POST /api/import as a multipart part without Content-Type is then stored, served inline and previewed as text.
  // When normalizeMime is fixed, this test fails: drop `.fails`.
  it.fails('does not keep text/plain for a non-text file of unknown extension', () => {
    expect(normalizeMime('text/plain', 'plan.dwg')).toBe('application/octet-stream');
  });
});

/** A PDF made of the given objects (bodies between "n 0 obj" and "endobj"), without cross-reference table. */
function pdf(...objects: (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  objects.forEach((body, i) => parts.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body), Buffer.from('\nendobj\n')));
  parts.push(Buffer.from('%%EOF\n'));
  return Buffer.concat(parts);
}

/** A compressed object stream (PDF 1.5) holding `content`; `extra` goes into its dictionary. */
function objStm(content: string, extra = '', data: Buffer = deflateSync(Buffer.from(content, 'latin1'))): Buffer {
  return Buffer.concat([Buffer.from(`<< /Type /ObjStm /N 2 /First 9 /Filter /FlateDecode${extra} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
}

const page = (parent: number) => `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 595 842] >>`;

describe('countPdfPages', () => {
  it('counts the page of the stand-in PDF of the demo documents', () => {
    expect(countPdfPages(simplePdf([{ text: 'PRO-QUA-0003 — A' }]), PDF)).toBe(1);
  });

  it('reads the /Count of the root of the page tree, written before its children', () => {
    const tree = pdf(
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 7 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R] /Count 3 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [6 0 R] /Count 4 >>',
      page(3), page(4),
    );
    expect(countPdfPages(tree, PDF)).toBe(7);
  });

  it('reads the /Count of the root of the page tree, written after its children (as pdfTeX does)', () => {
    const tree = pdf(
      '<< /Type /Catalog /Pages 6 0 R >>',
      page(4), page(5),
      '<< /Type /Pages /Parent 6 0 R /Kids [2 0 R] /Count 3 >>',
      '<< /Type /Pages /Parent 6 0 R /Kids [3 0 R] /Count 4 >>',
      '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 7 >>',
    );
    expect(countPdfPages(tree, PDF)).toBe(7);
  });

  it('reads /Count written before /Type', () => {
    expect(countPdfPages(pdf('<< /Type /Catalog /Pages 2 0 R >>', '<< /Count 4 /Kids [3 0 R] /Type /Pages >>', page(2)), PDF)).toBe(4);
  });

  it('reads the page tree inside a compressed object stream', () => {
    const file = pdf('<< /Type /Catalog /Pages 2 0 R >>', objStm(`2 0 3 60 << /Type /Pages /Kids [3 0 R] /Count 12 >> ${page(2)}`));
    expect(countPdfPages(file, PDF)).toBe(12);
  });

  it('skips an object stream it cannot decode', () => {
    const damaged = pdf('<< /Type /Catalog /Pages 2 0 R >>', objStm('', '', Buffer.from('not deflate data')), page(2), page(2));
    expect(countPdfPages(damaged, PDF)).toBe(2);
    const predictor = pdf('<< /Type /Catalog /Pages 2 0 R >>', objStm('<< /Type /Pages /Count 12 >>', ' /DecodeParms << /Predictor 12 /Columns 4 >>'), page(2));
    expect(countPdfPages(predictor, PDF)).toBe(1);
  });

  it('counts the /Page objects when no page tree gives a count', () => {
    expect(countPdfPages(pdf('<< /Type /Pages /Kids [2 0 R 3 0 R 4 0 R] >>', page(1), page(1), page(1)), PDF)).toBe(3);
  });

  it('gives no count for another type of file or for bytes that hold no page', () => {
    expect(countPdfPages(simplePdf([{ text: 'x' }]), 'image/png')).toBeNull();
    expect(countPdfPages(Buffer.from('%PDF-1.7\n%%EOF\n'), PDF)).toBeNull();
    expect(countPdfPages(Buffer.from('PK\x03\x04 not a pdf'), PDF)).toBeNull();
  });
});
