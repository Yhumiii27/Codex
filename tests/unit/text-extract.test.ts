import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { simplePdf } from '@/lib/pdf';
import { decodeText, extractLimits, extractText, textFormat, unescapeXml, type ExtractLimits } from '@/lib/text-extract';
import { docx, odt, pptx, xlsx, zip } from '../support/office';

// Text of a file for the comparison of versions (src/lib/text-extract.ts, point 14 of docs/reste-a-faire.md): PDF,
// Office Open XML, OpenDocument and plain text, as normalised lines; bounded; a failure is a reason, never an exception.

const LABELS = { sheet: 'Feuille', slide: 'Diapositive' };
const limits = (over: Partial<ExtractLimits> = {}) => ({ ...extractLimits({}), ...over });
const lines = async (buf: Buffer, format: Parameters<typeof extractText>[1], over: Partial<ExtractLimits> = {}) => extractText(buf, format, limits(over), LABELS);

describe('textFormat', () => {
  it('reads PDF, Office Open XML, OpenDocument and text files, by the extension they are stored with', () => {
    expect(textFormat('.pdf', 'application/pdf')).toBe('pdf');
    expect(textFormat('', 'application/pdf')).toBe('pdf');
    expect(textFormat('.DOCX', null)).toBe('docx');
    expect(textFormat('.xlsx', null)).toBe('xlsx');
    expect(textFormat('.pptx', null)).toBe('pptx');
    expect(textFormat('.odt', null)).toBe('odf');
    expect(textFormat('.csv', 'text/csv')).toBe('text');
    expect(textFormat('.json', 'application/json')).toBe('text');
  });

  it('does not read Office 97-2003 files, images or drawings', () => {
    for (const ext of ['.doc', '.xls', '.ppt', '.png', '.dwg', '.msg', '.zip', '']) expect(textFormat(ext, 'application/octet-stream'), ext).toBeNull();
  });

  it('decodes UTF-8 (BOM dropped), else Windows-1252', () => {
    expect(decodeText(Buffer.from('﻿Été', 'utf8'))).toBe('Été');
    expect(decodeText(Buffer.from([0xc9, 0x74, 0xe9, 0x20, 0x80].map((x) => x)))).toBe('Été €');
    expect(unescapeXml('a &amp; b &lt;c&gt; &#233;&#x20AC; &quot;&apos; &bogus;')).toBe('a & b <c> é€ "\' &bogus;');
  });
});

describe('extractText', () => {
  it('plain text: one line per line, blanks collapsed, empty lines left out', async () => {
    expect(await lines(Buffer.from('  Un   titre \r\n\r\nDeux\tmots\n\n'), 'text')).toEqual({ ok: true, lines: ['Un titre', 'Deux mots'], truncated: false });
  });

  it('PDF: the text layer, line by line, through pdf.js', async () => {
    const pdf = simplePdf([{ text: 'Procédure de contrôle' }, { text: 'Étape 1 : vérifier' }]);
    expect(await lines(pdf, 'pdf')).toEqual({ ok: true, lines: ['Procédure de contrôle', 'Étape 1 : vérifier'], truncated: false });
  });

  it('Word: one line per paragraph, tabs as blanks; deleted text and field codes are not text', async () => {
    expect(await lines(docx(['Titre & sous-titre', 'Colonne\tvaleur', '']), 'docx')).toEqual({ ok: true, lines: ['Titre & sous-titre', 'Colonne valeur'], truncated: false });
  });

  it('Excel: each sheet under its name, one line per row, cells in their columns', async () => {
    const book = xlsx({ Budget: [['Poste', 'Montant'], ['Études', 1200]], 'Notes <2>': [['Voir annexe']] });
    expect(await lines(book, 'xlsx')).toEqual({ ok: true, lines: ['[Feuille : Budget]', 'Poste | Montant', 'Études | 1200', '[Feuille : Notes <2>]', 'Voir annexe'], truncated: false });
  });

  it('PowerPoint: slides in their order (2 before 10), each under its number', async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Diapo ${i + 1}`]);
    const r = await lines(pptx(slides), 'pptx');
    expect(r.ok && r.lines.slice(0, 4)).toEqual(['[Diapositive 1]', 'Diapo 1', '[Diapositive 2]', 'Diapo 2']);
    expect(r.ok && r.lines.at(-1)).toBe('Diapo 11');
  });

  it('OpenDocument: one line per paragraph', async () => {
    expect(await lines(odt(['Premier  paragraphe', 'Second']), 'odf')).toEqual({ ok: true, lines: ['Premier paragraphe', 'Second'], truncated: false });
  });

  it('a stored (not deflated) ZIP is read as well', async () => {
    const stored = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Rangé</w:t></w:r></w:p></w:body></w:document>' }, { stored: true });
    expect(await lines(stored, 'docx')).toEqual({ ok: true, lines: ['Rangé'], truncated: false });
  });

  it('refuses a file beyond the size bound without reading it', async () => {
    expect(await lines(Buffer.alloc(2048, 0x61), 'text', { maxBytes: 1024 })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('an entry that unpacks beyond its bound stops there (ZIP bomb)', async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024, 0x20);
    const bomb = zip({ 'word/document.xml': huge });
    // Declared size within the bound, real one beyond it: inflating stops at the bound.
    const lying = Buffer.from(bomb);
    const dir = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(100, dir + 24);
    expect(deflateRawSync(huge).length).toBeLessThan(huge.length / 100);
    expect(await lines(bomb, 'docx', { maxEntryBytes: 1024 * 1024 })).toEqual({ ok: false, reason: 'too_large' });
    expect(await lines(lying, 'docx', { maxEntryBytes: 1024 * 1024 })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('cuts the text at the bounds of lines and characters, and says so', async () => {
    const many = Buffer.from(Array.from({ length: 50 }, (_, i) => `ligne ${i}`).join('\n'));
    const r = await lines(many, 'text', { maxLines: 10 });
    expect(r).toMatchObject({ ok: true, truncated: true });
    expect(r.ok && r.lines).toHaveLength(10);
    expect(await lines(many, 'text', { maxChars: 30 })).toMatchObject({ ok: true, truncated: true, lines: ['ligne 0', 'ligne 1', 'ligne 2', 'ligne 3'] });
  });

  it('gives up once past its deadline', async () => {
    expect(await lines(docx(['a']), 'docx', { deadline: Date.now() - 1 })).toEqual({ ok: false, reason: 'timeout' });
    expect(await lines(simplePdf([{ text: 'a' }]), 'pdf', { deadline: Date.now() - 1 })).toEqual({ ok: false, reason: 'timeout' });
  });

  it('says why when there is nothing to compare: damaged, empty, encrypted', async () => {
    expect(await lines(Buffer.from('PK\x03\x04 pas un zip'), 'docx')).toEqual({ ok: false, reason: 'unreadable' });
    expect(await lines(Buffer.from('pas un zip'), 'xlsx')).toEqual({ ok: false, reason: 'unreadable' });
    expect(await lines(zip({ 'autre.xml': '<x/>' }), 'docx')).toEqual({ ok: false, reason: 'unreadable' });
    expect(await lines(Buffer.from('%PDF-1.4 abîmé'), 'pdf')).toEqual({ ok: false, reason: 'unreadable' });
    expect(await lines(docx(['']), 'docx')).toEqual({ ok: false, reason: 'empty' });
    expect(await lines(Buffer.from(' \n\n '), 'text')).toEqual({ ok: false, reason: 'empty' });
    const locked = zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'META-INF/manifest.xml': '<manifest:file-entry><manifest:encryption-data/></manifest:file-entry>', 'content.xml': '<x/>' });
    expect(await lines(locked, 'odf')).toEqual({ ok: false, reason: 'encrypted' });
  });
});
