import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { INLINE_SAFE, previewKind } from '@/lib/filetypes';
import { simplePdf } from '@/lib/pdf';
import { countPdfPages, normalizeMime } from '@/lib/storage';

// File types and PDF page counts of uploaded files (src/lib/storage.ts), and how the preview shows them
// (src/lib/filetypes.ts); nothing here touches a store.

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

  // Order of inference: the extension first (the type a browser gives the same file when it is uploaded on screen),
  // the signature only when the extension says nothing.
  it('prefers the type of a known extension to the PDF signature', () => {
    const pdf = Buffer.from('%PDF-1.7\n');
    expect(normalizeMime('', 'rapport.docx', pdf)).toBe(DOCX);
    expect(normalizeMime('application/octet-stream', 'photo.png', pdf)).toBe('image/png');
    expect(normalizeMime('text/plain', 'tableau.xlsx', pdf)).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(normalizeMime('', 'notes.txt', pdf)).toBe('text/plain');
    expect(normalizeMime('', 'plan.pdf', Buffer.from('PK\x03\x04'))).toBe(PDF);
  });

  it('falls back to a generic type for an unknown extension', () => {
    expect(normalizeMime('', 'archive.xyz')).toBe('application/octet-stream');
    expect(normalizeMime('application/octet-stream', 'archive.xyz')).toBe('application/octet-stream');
  });

  // text/plain sent for a file whose extension is not a known text one is generic, the extension being unknown or
  // missing too: a drawing posted to POST /api/import as a multipart part without Content-Type (which arrives as
  // text/plain) must not be stored, served inline and previewed as text.
  it('does not keep text/plain for a non-text file of unknown extension', () => {
    expect(normalizeMime('text/plain', 'plan.dwg')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'piece.step')).toBe('application/octet-stream');
    expect(normalizeMime('Text/Plain; charset=UTF-8', 'PLAN.DWG')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'export.tar.gz')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'plan.dwg', Buffer.from([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0x00, 0xff]))).toBe('application/octet-stream');
    // Bytes that are a PDF are still recognised.
    expect(normalizeMime('text/plain', 'piece.step', Buffer.from('%PDF-1.4\n'))).toBe(PDF);
  });

  it('does not keep text/plain for a file without extension', () => {
    expect(normalizeMime('text/plain', 'LISEZMOI')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', '.bashrc')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'plan.')).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'LISEZMOI', Buffer.from('\x00\x01\x02'))).toBe('application/octet-stream');
    expect(normalizeMime('text/plain', 'scan', Buffer.from('%PDF-1.7\n'))).toBe(PDF);
  });

  it('keeps text/plain for a text file, and any specific type declared for an unknown extension', () => {
    expect(normalizeMime('text/plain; charset=utf-8', 'NOTES.TXT')).toBe('text/plain');
    expect(normalizeMime('', 'notes.txt')).toBe('text/plain');
    expect(normalizeMime('application/octet-stream', 'serveur.log')).toBe('text/plain');
    expect(normalizeMime('image/vnd.dwg', 'plan.dwg')).toBe('image/vnd.dwg');
    expect(normalizeMime('model/step', 'piece.step')).toBe('model/step');
  });

  it('gives the same type when a stored type is normalised again (the file route and the preview do)', () => {
    for (const [raw, name, buf] of [
      ['text/plain', 'plan.dwg'], ['text/plain', 'LISEZMOI'], ['text/plain', 'notes.txt'], ['', 'scan', Buffer.from('%PDF-1.7\n')],
      ['application/octet-stream', 'tableau.xlsx'], ['image/vnd.dwg', 'plan.dwg'], ['', 'rapport.docx', Buffer.from('%PDF-1.7\n')],
    ] as [string, string, Buffer?][]) {
      const stored = normalizeMime(raw, name, buf);
      expect(normalizeMime(stored, name)).toBe(stored);
    }
  });
});

// The preview shows a file only when the file route serves it inline (src/lib/filetypes.ts); otherwise it offers the
// download ("Aperçu indisponible pour ce format").
describe('previewKind', () => {
  it('shows a PDF, an image the route serves inline, and plain text', () => {
    expect(previewKind(PDF)).toBe('pdf');
    for (const m of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(previewKind(m), m).toBe('image');
    expect(previewKind('text/plain')).toBe('text');
  });

  it('shows no other type, images included: the route hands them out as downloads', () => {
    for (const m of ['image/vnd.dwg', 'image/tiff', 'image/heic', 'image/svg+xml', 'application/octet-stream', DOCX, 'text/csv', 'text/html', 'model/step', ''])
      expect(previewKind(m), m).toBeNull();
    expect(previewKind(null)).toBeNull();
    expect(previewKind(undefined)).toBeNull();
  });

  it('shows a type exactly when the route serves it inline', () => {
    for (const m of INLINE_SAFE) expect(previewKind(m), m).not.toBeNull();
  });

  it('offers a drawing as a download, whatever type it was sent with', () => {
    // An import without Content-Type (text/plain), a browser upload on Linux (image/vnd.dwg), a generic type.
    for (const raw of ['text/plain', 'image/vnd.dwg', 'application/octet-stream', ''])
      expect(previewKind(normalizeMime(raw, 'plan.dwg', Buffer.from([0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0x00, 0xff]))), raw).toBeNull();
    expect(previewKind(normalizeMime('text/plain', 'LISEZMOI'))).toBeNull();
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
