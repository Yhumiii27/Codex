import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptAttr, admittedExtensions, cfbNames, cleanFileName, DEFAULT_EXTENSIONS, DENIED_EXTENSIONS, extensionOf, fileIssue, fileIssueReason, fileIssueText, fileRules, hasMacros, isExecutable, maxFileBytes, zipEntries } from '@/lib/filetypes';
import { DICT } from '@/lib/i18n';
import { cfb, zip } from '../support/containers';

// Formats and size admitted for a file entering Codex (src/lib/filetypes.ts), whatever the way in: new document, working
// version, copy of a template, import (point 32 of docs/reste-a-faire.md). Executables and scripts are refused by name
// and by content; a known format must have the content its extension announces; one size limit for every entry.

const MB = 1024 * 1024;
const rules = fileRules({});
const bytes = (...parts: (string | number[])[]) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

const PDF = bytes('%PDF-1.7\n%%EOF\n');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF');
/** A Word document (Office Open XML): a ZIP holding its content types. */
const ZIP = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w:document/>']]);
const ODT = zip([['mimetype', 'application/vnd.oasis.opendocument.text'], ['content.xml', '<office:document-content/>']]);
/** A Word 97-2003 document: a compound file. */
const OLE2 = cfb(['WordDocument', '1Table', '\x05SummaryInformation']);
/** An Office Open XML file encrypted by a password or a sensitivity label: a compound file (MS-OFFCRYPTO). */
const ENCRYPTED = cfb(['EncryptionInfo', 'EncryptedPackage', '\x06DataSpaces']);
const RTF = bytes('{\\rtf1\\ansi Rapport}');
const DWG = bytes('AC1032', [0, 0, 0, 0, 0, 6]);
const MP4 = bytes([0, 0, 0, 0x18], 'ftypmp42');
/** A Windows program: "MZ", and "PE\0\0" where the DOS header points (0x40). */
const PE = (() => {
  const b = Buffer.alloc(0x80);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  return b;
})();
const ELF = bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
const MACHO = bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]);

describe('admitted extensions', () => {
  it('admits by default the formats of the register: documents, spreadsheets, drawings, photos, data', () => {
    for (const e of ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.csv', '.txt', '.dwg', '.dxf', '.step', '.stp', '.ifc', '.jpg', '.png', '.tif', '.heic', '.msg', '.mpp', '.vsdx', '.mp4', '.json', '.xml']) {
      expect(rules.extensions, e).toContain(e);
    }
  });

  it('refuses by default archives, executables, scripts, pages and Office files with macros', () => {
    for (const e of ['.zip', '.exe', '.bat', '.cmd', '.msi', '.js', '.vbs', '.ps1', '.html', '.htm', '.svg', '.docm', '.xlsm', '.iso', '.lnk', '.jar']) {
      expect(rules.extensions, e).not.toContain(e);
      expect(fileIssue(`f${e}`, 10, null, rules), e).toEqual({ code: 'format', ext: e });
    }
    expect(DEFAULT_EXTENSIONS.filter((e) => DENIED_EXTENSIONS.has(e))).toEqual([]);
  });

  it('takes the whole list from CODEX_FILE_EXTENSIONS, with or without dots, in any case', () => {
    expect(admittedExtensions({ CODEX_FILE_EXTENSIONS: 'pdf, .DOCX ,zip,,pdf' })).toEqual(['.pdf', '.docx', '.zip']);
    const zip = fileRules({ CODEX_FILE_EXTENSIONS: 'pdf,zip' });
    expect(fileIssue('lot.zip', ZIP.length, ZIP, zip)).toBeNull();
    expect(fileIssue('plan.docx', ZIP.length, ZIP, zip)).toEqual({ code: 'format', ext: '.docx' });
  });

  it('never admits an executable or a script, even listed', () => {
    expect(admittedExtensions({ CODEX_FILE_EXTENSIONS: 'pdf,exe,.js,html,docm' })).toEqual(['.pdf']);
    // A list that leaves nothing falls back to the default one rather than refusing everything.
    expect(admittedExtensions({ CODEX_FILE_EXTENSIONS: 'exe' })).toEqual([...DEFAULT_EXTENSIONS]);
    expect(admittedExtensions({ CODEX_FILE_EXTENSIONS: ' ' })).toEqual([...DEFAULT_EXTENSIONS]);
  });

  it('offers them to the file picker', () => {
    expect(acceptAttr(fileRules({ CODEX_FILE_EXTENSIONS: 'pdf,dwg' }))).toBe('.pdf,.dwg');
  });

  it('records a file under the last segment of its name, without what would hide its extension', () => {
    expect(cleanFileName('procedure.hta/')).toBe('procedure.hta');
    expect(cleanFileName('procedure.hta\\')).toBe('procedure.hta');
    expect(cleanFileName('procedure.hta. ')).toBe('procedure.hta');
    expect(cleanFileName('C:\\fakepath\\Plan v2.PDF')).toBe('Plan v2.PDF');
    expect(cleanFileName('GED1/2019/proc.pdf')).toBe('proc.pdf');
    expect(cleanFileName('rapport\u202Efdp.exe')).toBe('rapportfdp.exe');
    expect(cleanFileName('note\u0000.txt\n')).toBe('note.txt');
    expect(cleanFileName('Relevé .profile')).toBe('Relevé .profile');
    expect(cleanFileName('../')).toBe('');
    // The extension checked is then the one a path reader would see.
    for (const raw of ['procedure.hta/', 'procedure.hta\\', 'procedure.hta.', 'procedure.hta /']) {
      expect(fileIssue(cleanFileName(raw), PDF.length, PDF, rules), raw).toEqual({ code: 'format', ext: '.hta' });
    }
  });

  it('reads the extension of the last segment, in lower case', () => {
    expect(extensionOf('Plan.PDF')).toBe('.pdf');
    expect(extensionOf('facture.pdf.exe')).toBe('.exe');
    expect(extensionOf('C:\\dossier.v2\\LISEZMOI')).toBe('');
    expect(extensionOf('.profile')).toBe('');
    expect(fileIssue('facture.pdf.exe', 10, null, rules)).toEqual({ code: 'format', ext: '.exe' });
    expect(fileIssue('PLAN.PDF', PDF.length, PDF, rules)).toBeNull();
  });
});

describe('largest file', () => {
  it('is 50 MB by default, CODEX_MAX_FILE_MB otherwise, for every entry', () => {
    expect(maxFileBytes({})).toBe(50 * MB);
    expect(maxFileBytes({ CODEX_MAX_FILE_MB: '120' })).toBe(120 * MB);
    expect(maxFileBytes({ CODEX_MAX_FILE_MB: '0.5' })).toBe(MB / 2);
    for (const bad of ['0', '-3', 'abc', '']) expect(maxFileBytes({ CODEX_MAX_FILE_MB: bad }), bad).toBe(50 * MB);
  });

  it('is capped at 250 MB with SharePoint, whose simple upload goes no further', () => {
    expect(maxFileBytes({ CODEX_MAX_FILE_MB: '400', CODEX_STORAGE: 'sharepoint' })).toBe(250 * MB);
    expect(maxFileBytes({ CODEX_MAX_FILE_MB: '400', CODEX_STORAGE: 'local' })).toBe(400 * MB);
  });

  it('refuses a larger file, by its size alone', () => {
    expect(fileIssue('plan.pdf', 50 * MB, null, rules)).toBeNull();
    expect(fileIssue('plan.pdf', 50 * MB + 1, null, rules)).toEqual({ code: 'too_large', size: 50 * MB + 1, maxBytes: 50 * MB });
  });
});

describe('request body of a Server Action (next.config.ts)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Room for the other fields of the form: a file just over the limit gets stageFile's explicit refusal, never the
  // framework's generic error.
  it('holds the largest file plus 1 MB, read from CODEX_MAX_FILE_MB when the server starts', async () => {
    for (const [mb, expected] of [['', 51 * MB], ['120', 121 * MB]] as const) {
      vi.stubEnv('CODEX_MAX_FILE_MB', mb);
      vi.resetModules();
      const { default: config } = await import('../../next.config');
      expect(config.experimental?.serverActions?.bodySizeLimit, mb).toBe(expected);
      expect(config.experimental?.proxyClientMaxBodySize, mb).toBe(expected);
    }
  });
});

describe('content of the file', () => {
  it('accepts a known format whose content is the one its extension announces', () => {
    const cases: [string, Buffer][] = [['a.pdf', PDF], ['a.png', PNG], ['a.jpg', JPEG], ['a.jpeg', JPEG], ['a.docx', ZIP], ['a.xlsx', ZIP], ['a.vsdx', ZIP], ['a.odt', ODT], ['a.ods', ODT], ['a.doc', OLE2], ['a.msg', OLE2], ['a.mpp', OLE2], ['a.rtf', RTF], ['a.dwg', DWG], ['a.mp4', MP4]];
    for (const [name, buf] of cases) expect(fileIssue(name, buf.length, buf, rules), name).toBeNull();
  });

  it('accepts an encrypted Office Open XML file, a compound file, under its own extension', () => {
    for (const name of ['contrat.docx', 'salaires.xlsx', 'revue.pptx', 'modele.dotx']) expect(fileIssue(name, ENCRYPTED.length, ENCRYPTED, rules), name).toBeNull();
    // Another compound file is not one: a Word 97-2003 document named .docx.
    expect(fileIssue('rapport.docx', OLE2.length, OLE2, rules)).toEqual({ code: 'signature', ext: '.docx' });
    expect(fileIssue('rapport.docx', PDF.length, PDF, rules)).toEqual({ code: 'signature', ext: '.docx' });
  });

  it('accepts a .doc saved as RTF, as older systems export it', () => {
    expect(fileIssue('ancien.doc', RTF.length, RTF, rules)).toBeNull();
    expect(fileIssue('ancien.xls', RTF.length, RTF, rules)).toEqual({ code: 'signature', ext: '.xls' });
  });

  it('wants the package an Office or OpenDocument file is, not any ZIP', () => {
    const archive = zip([['setup.exe', 'MZ'], ['LISEZMOI.txt', 'Lancez setup.exe']]);
    for (const name of ['archive.docx', 'archive.xlsx', 'archive.odt', 'archive.vsdx']) expect(fileIssue(name, archive.length, archive, rules), name).toEqual({ code: 'signature', ext: extensionOf(name) });
    // OpenDocument: its type, or failing that its manifest.
    const manifest = zip([['META-INF/manifest.xml', '<manifest:manifest/>'], ['content.xml', '']]);
    expect(fileIssue('note.odt', manifest.length, manifest, rules)).toBeNull();
    expect(fileIssue('note.odt', ZIP.length, ZIP, rules)).toEqual({ code: 'signature', ext: '.odt' });
    // A ZIP cut short has no directory to read.
    expect(fileIssue('rapport.docx', 40, ZIP.subarray(0, 40), rules)).toEqual({ code: 'signature', ext: '.docx' });
  });

  it('refuses VBA macros whatever the extension says', () => {
    const docm = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', ''], ['word/vbaProject.bin', 'VBA']]);
    expect(fileIssue('rapport.docx', docm.length, docm, rules)).toEqual({ code: 'macros', ext: '.docx' });
    expect(fileIssue('export.csv', docm.length, docm, rules)).toEqual({ code: 'macros', ext: '.csv' });
    // Excel 97-2003 (_VBA_PROJECT_CUR), Word 97-2003 (Macros/VBA/_VBA_PROJECT), in any case.
    const xls = cfb(['Workbook', '_VBA_PROJECT_CUR', 'VBA', 'dir', 'Module1']);
    const doc = cfb(['WordDocument', 'Macros', 'VBA', '_vba_project', 'PROJECT']);
    expect(fileIssue('calcul.xls', xls.length, xls, rules)).toEqual({ code: 'macros', ext: '.xls' });
    expect(fileIssue('ancien.doc', doc.length, doc, rules)).toEqual({ code: 'macros', ext: '.doc' });
    expect(hasMacros(ZIP)).toBe(false);
    expect(hasMacros(OLE2)).toBe(false);
    expect(hasMacros(PDF)).toBe(false);
    // A text that names the stream is not one.
    const text = bytes('Le flux _VBA_PROJECT et word/vbaProject.bin');
    expect(fileIssue('notes.txt', text.length, text, rules)).toBeNull();
  });

  it('refuses a known format whose content is something else', () => {
    expect(fileIssue('rapport.docx', PDF.length, PDF, rules)).toEqual({ code: 'signature', ext: '.docx' });
    expect(fileIssue('scan.pdf', 5, bytes('hello'), rules)).toEqual({ code: 'signature', ext: '.pdf' });
    expect(fileIssue('photo.png', JPEG.length, JPEG, rules)).toEqual({ code: 'signature', ext: '.png' });
    expect(fileIssue('ancien.xls', ZIP.length, ZIP, rules)).toEqual({ code: 'signature', ext: '.xls' });
    expect(fileIssue('plan.dwg', 6, bytes('AC10AB'), rules)).toEqual({ code: 'signature', ext: '.dwg' });
  });

  it('finds a PDF header anywhere in the first kilobyte, as readers do', () => {
    const late = Buffer.concat([Buffer.alloc(600, 0x20), PDF]);
    expect(fileIssue('scan.pdf', late.length, late, rules)).toBeNull();
    const tooLate = Buffer.concat([Buffer.alloc(1100, 0x20), PDF]);
    expect(fileIssue('scan.pdf', tooLate.length, tooLate, rules)).toEqual({ code: 'signature', ext: '.pdf' });
  });

  it('takes text and exchange formats on their name', () => {
    for (const name of ['notes.txt', 'mesures.csv', 'piece.step', 'piece.stl', 'plan.dxf', 'export.json']) {
      expect(fileIssue(name, 4, bytes([0, 1, 2, 3]), rules), name).toBeNull();
    }
  });

  it('refuses a program whatever its name', () => {
    for (const [what, buf] of [['PE', PE], ['ELF', ELF], ['Mach-O', MACHO]] as const) {
      expect(isExecutable(buf), what).toBe(true);
      for (const name of ['rapport.pdf', 'notes.txt', 'plan.dwg', 'LISEZMOI']) expect(fileIssue(name, buf.length, buf, rules), `${what} ${name}`).toEqual({ code: 'executable' });
    }
  });

  it('does not take for a program a text that starts with MZ', () => {
    const text = bytes('MZ Bâtiment, relevé du 12 mars\n'.padEnd(200, '.'));
    expect(isExecutable(text)).toBe(false);
    expect(fileIssue('releve.txt', text.length, text, rules)).toBeNull();
  });

  it('admits a file without extension only when its content names an admitted format', () => {
    expect(fileIssue('scan', PDF.length, PDF, rules)).toBeNull();
    expect(fileIssue('photo', PNG.length, PNG, rules)).toBeNull();
    expect(fileIssue('LISEZMOI', DWG.length, DWG, rules)).toBeNull();
    // A ZIP or OLE2 container may be several formats, an archive among them; text says nothing.
    expect(fileIssue('document', ZIP.length, ZIP, rules)).toEqual({ code: 'no_extension' });
    expect(fileIssue('document', OLE2.length, OLE2, rules)).toEqual({ code: 'no_extension' });
    expect(fileIssue('notes', 5, bytes('hello'), rules)).toEqual({ code: 'no_extension' });
    // Not when that format is not admitted.
    expect(fileIssue('scan', PDF.length, PDF, fileRules({ CODEX_FILE_EXTENSIONS: 'docx' }))).toEqual({ code: 'no_extension' });
    // In the browser, without the bytes, the server decides.
    expect(fileIssue('scan', PDF.length, null, rules)).toBeNull();
  });
});

describe('containers', () => {
  it('reads the entries of a ZIP from its central directory, ZIP64 included', () => {
    const entries: [string, string][] = [['[Content_Types].xml', '<Types/>'], ['word/document.xml', 'é']];
    expect(zipEntries(zip(entries))).toEqual(['[Content_Types].xml', 'word/document.xml']);
    expect(zipEntries(zip(entries, { zip64: true }))).toEqual(['[Content_Types].xml', 'word/document.xml']);
    expect(zipEntries(Buffer.concat([zip(entries), Buffer.alloc(0)]))).toHaveLength(2);
    expect(zipEntries(PDF)).toBeNull();
    // Cut short, or a directory that points past the end.
    const whole = zip(entries);
    expect(zipEntries(whole.subarray(0, whole.length - 30))).toBeNull();
    const broken = Buffer.from(whole);
    broken.writeUInt32LE(whole.length, whole.length - 6);
    expect(zipEntries(broken)).toBeNull();
  });

  it('reads the directory of a compound file through its allocation table', () => {
    expect(cfbNames(OLE2)).toEqual(['Root Entry', 'WordDocument', '1Table', '\x05SummaryInformation']);
    // 4096-byte sectors (version 4), a directory on several sectors, a directory beyond what the header's table reaches.
    expect(cfbNames(cfb(['Workbook'], { shift: 12 }))).toEqual(['Root Entry', 'Workbook']);
    const many = Array.from({ length: 9 }, (_, i) => `Flux${i}`);
    expect(cfbNames(cfb(many))).toEqual(['Root Entry', ...many]);
    expect(cfbNames(cfb(['EncryptedPackage'], { dirAt: 109 * 128 }))).toEqual(['Root Entry', 'EncryptedPackage']);
    expect(cfbNames(PDF)).toBeNull();
  });

  it('reads nothing from a damaged compound file', () => {
    expect(cfbNames(OLE2.subarray(0, 600))).toBeNull();
    const loop = Buffer.from(cfb(['WordDocument']));
    loop.writeUInt32LE(1, 512 + 4); // the directory sector chained to itself
    expect(cfbNames(loop)).toBeNull();
    const shift = Buffer.from(OLE2);
    shift.writeUInt16LE(7, 0x1e);
    expect(cfbNames(shift)).toBeNull();
    expect(fileIssue('ancien.doc', 600, OLE2.subarray(0, 600), rules)).toEqual({ code: 'signature', ext: '.doc' });
  });
});

describe('refusal texts', () => {
  const small = fileRules({ CODEX_MAX_FILE_MB: '1', CODEX_FILE_EXTENSIONS: 'pdf,docx' });

  it('give the limit, or the formats admitted', () => {
    expect(fileIssueText(DICT.fr, 'fr', { code: 'too_large', size: 3 * MB, maxBytes: MB }, small)).toBe('Fichier trop volumineux : 3,0 Mo, pour 1 Mo au plus.');
    expect(fileIssueText(DICT.en, 'en', { code: 'too_large', size: 3 * MB, maxBytes: MB }, small)).toBe('File too large: 3.0 MB, 1 MB at most.');
    expect(fileIssueText(DICT.fr, 'fr', { code: 'format', ext: '.exe' }, small)).toBe('Format non admis : .exe. Formats admis : .pdf, .docx.');
    expect(fileIssueText(DICT.en, 'en', { code: 'signature', ext: '.pdf' }, small)).toBe('The content of this file is not that of a .pdf file: it is refused.');
    expect(fileIssueText(DICT.fr, 'fr', { code: 'executable' }, small)).toBe(DICT.fr.file_executable);
    expect(fileIssueText(DICT.fr, 'fr', { code: 'no_extension' }, small)).toContain('Formats admis : .pdf, .docx.');
    expect(fileIssueText(DICT.en, 'en', { code: 'macros', ext: '.xls' }, small)).toBe(DICT.en.file_macros);
  });

  it('give a short reason, for a sentence that names the file', () => {
    expect(fileIssueReason(DICT.fr, 'fr', { code: 'format', ext: '.dotm' })).toBe('format .dotm non admis');
    expect(fileIssueReason(DICT.en, 'en', { code: 'signature', ext: '.docx' })).toBe('its content is not that of a .docx file');
    expect(fileIssueReason(DICT.fr, 'fr', { code: 'too_large', size: 3 * MB, maxBytes: MB })).toBe('trop volumineux : 3,0 Mo, pour 1 Mo au plus');
    expect(fileIssueReason(DICT.fr, 'fr', { code: 'macros', ext: '.xls' })).toBe('il contient des macros');
  });
});
