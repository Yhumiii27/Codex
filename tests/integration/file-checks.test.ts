import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getFile } from '@/app/api/documents/[id]/file/route';
import { GET as exportAudit } from '@/app/api/export/audit/route';
import { POST } from '@/app/api/import/route';
import { FILES_DIR, schema as s } from '@/db';
import { addWorkingVersion, createDocument } from '@/lib/actions';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditPage } from '@/lib/queries';
import { FileRejectedError, stageFile } from '@/lib/storage';
import { deadAddress, EICAR, fakeClamd, type FakeClamd } from '../support/clamd';
import { cfb, zip } from '../support/containers';
import { addDoc, fixClock, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, cookieStore } from '../support/session';

// Every way a file enters Codex — new document, copy of a template, working version, import — goes through stageFile
// (src/lib/storage.ts): formats and size (src/lib/filetypes.ts), then the virus scan (src/lib/antivirus.ts), before the
// file reaches the store. A refused file leaves no document, no version and no file behind; an infected one is journaled
// in the Administration journal, where only records managers see which document it was meant for (D-14).

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-checks-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const t = DICT.fr;
const TOKEN = 'test-token';
let clamd: FakeClamd;

beforeAll(async () => {
  clamd = await fakeClamd();
});
beforeEach(() => {
  vi.stubEnv('CODEX_STORAGE', 'local');
  vi.stubEnv('CODEX_IMPORT_TOKEN', TOKEN);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clamd.mode = 'normal';
  for (const f of readdirSync(FILES_DIR)) rmSync(path.join(FILES_DIR, f));
});
afterAll(async () => {
  await clamd.close();
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const PDF = '%PDF-1.4\n%%EOF\n';
/** A Windows program: "MZ", and "PE\0\0" where the DOS header points. */
const PE = (() => {
  const b = Buffer.alloc(0x80);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  return b;
})();

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const file = (content: string | Buffer, name: string, type = '') => new File([new Uint8Array(Buffer.from(content))], name, { type });

/** A new procedure filed by `who` with this file. */
function create(f: File, who: Person = 'writer') {
  actAs(who);
  return createDocument(form({ title: 'Procédure', typeCode: 'PRO', department: 'QUA', file: f }));
}

/** A working version of PRO-QUA-0001 (a draft of `writer`) uploaded from the record as it is now. */
async function upload(f: File) {
  actAs('writer');
  const { baseRevision, baseVersion } = await viewOf(db(), 'PRO-QUA-0001');
  return addWorkingVersion(form({ docId: 'PRO-QUA-0001', file: f, baseRevision, baseVersion }));
}

/** Imports one in-force procedure with this file. */
function importWith(legacyRef: string, name: string, bytes: string | Buffer) {
  const b = 'codex-test-boundary';
  const meta = { legacyRef, title: legacyRef, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' };
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return POST(new Request('http://codex.test/api/import', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${b}` }, body }));
}

const documents = async () => (await db().select({ id: s.documents.id }).from(s.documents)).map((d) => d.id);
const versionCount = async (docId: string) => (await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, docId))).length;
const stored = () => readdirSync(FILES_DIR);
const refusals = () => db().select().from(s.auditLog).where(eq(s.auditLog.action, 'file_rejected'));

describe('formats and size, on every way in', () => {
  it('refuses an executable or a page on a new document, by its extension', async () => {
    expect(await create(file(PE, 'outil.exe'))).toEqual({ ok: false, error: expect.stringMatching(/^Format non admis : \.exe\. Formats admis : \.pdf, /) });
    expect(await create(file('<script>alert(1)</script>', 'page.html', 'text/html'))).toMatchObject({ ok: false, error: expect.stringMatching(/^Format non admis : \.html\./) });
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('refuses a program whatever its name, and a content that is not its extension', async () => {
    expect(await create(file(PE, 'rapport.pdf', 'application/pdf'))).toEqual({ ok: false, error: t.file_executable });
    expect(await create(file('pas un PDF', 'rapport.pdf', 'application/pdf'))).toEqual({ ok: false, error: 'Le contenu de ce fichier n’est pas celui d’un fichier .pdf : il est refusé.' });
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('refuses a file over the size limit with the limit, and takes one under it', async () => {
    vi.stubEnv('CODEX_MAX_FILE_MB', String(1 / 1024)); // 1 KB
    const big = file(Buffer.concat([Buffer.from(PDF), Buffer.alloc(2048 - PDF.length, 0x20)]), 'gros.pdf', 'application/pdf');
    expect(await create(big)).toEqual({ ok: false, error: 'Fichier trop volumineux : 2,0 Ko, pour 1 Ko au plus.' });
    expect(await documents()).toEqual([]);
    expect(await create(file(PDF, 'petit.pdf', 'application/pdf'))).toMatchObject({ ok: true });
    expect(await documents()).toEqual(['PRO-QUA-0001']);
  });

  it('checks a working version the same way, adding none', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    expect(await upload(file(PDF, 'v.docx'))).toEqual({ ok: false, error: 'Le contenu de ce fichier n’est pas celui d’un fichier .docx : il est refusé.' });
    expect(await upload(file(PE, 'macro.xlsm'))).toMatchObject({ ok: false, error: expect.stringMatching(/^Format non admis : \.xlsm\./) });
    expect(await versionCount('PRO-QUA-0001')).toBe(1);
    expect(await upload(file(PDF, 'v2.pdf', 'application/pdf'))).toMatchObject({ ok: true });
    expect(await versionCount('PRO-QUA-0001')).toBe(2);
  });

  it('checks the copy of a template: its file enters a new document, and the refusal names the template', async () => {
    await addDoc(db(), { id: 'FRM-QMS-0001', typeCode: 'FRM' });
    // A template stored before formats were checked, with macros: the user chose no file, the refusal says whose it is.
    const tpl = (fileName: string, bytes: Buffer) => {
      writeFileSync(path.join(FILES_DIR, 'tpl-modele'), bytes);
      return db().update(s.workingVersions).set({ storage: 'local', fileKey: 'tpl-modele', fileName, mime: 'application/octet-stream', size: bytes.length }).where(eq(s.workingVersions.docId, 'FRM-QMS-0001'));
    };
    const copy = () => {
      actAs('writer');
      return createDocument(form({ title: 'Fiche', typeCode: 'PRO', department: 'QUA', templateId: 'FRM-QMS-0001' }));
    };
    const docm = zip([['[Content_Types].xml', '<Types/>'], ['word/vbaProject.bin', 'VBA']]);
    await tpl('modele.docm', docm);
    expect(await copy()).toEqual({ ok: false, error: 'Le fichier du modèle FRM-QMS-0001 n’est plus admis (format .docm non admis) : son propriétaire doit en déposer une nouvelle version.' });
    await tpl('modele.docx', docm);
    expect(await copy()).toEqual({ ok: false, error: 'Le fichier du modèle FRM-QMS-0001 n’est plus admis (il contient des macros) : son propriétaire doit en déposer une nouvelle version.' });
    await tpl('modele.docx', Buffer.from(PDF));
    actAs('writer');
    (await cookieStore()).set(COOKIE_LANG, 'en');
    expect(await createDocument(form({ title: 'Form', typeCode: 'PRO', department: 'QUA', templateId: 'FRM-QMS-0001' }))).toEqual({ ok: false, error: 'The file of template FRM-QMS-0001 is no longer accepted (its content is not that of a .docx file): its owner must upload a new version of it.' });
    expect(await documents()).toEqual(['FRM-QMS-0001']);
    // A template in an admitted format is copied.
    (await cookieStore()).set(COOKIE_LANG, 'fr');
    await tpl('modele.pdf', Buffer.from(PDF));
    expect(await copy()).toMatchObject({ ok: true });
  });

  it('refuses VBA macros whatever the extension, on screen and on import', async () => {
    const xls = cfb(['Workbook', '_VBA_PROJECT_CUR', 'VBA', '_VBA_PROJECT']);
    expect(await create(file(xls, 'calcul.xls'))).toEqual({ ok: false, error: t.file_macros });
    const res = await importWith('L-M', 'calcul.xls', xls);
    expect([res.status, await res.json()]).toMatchObject([415, { error: 'file_format', reason: 'macros', ext: '.xls' }]);
    // An encrypted Office Open XML file is a compound file too: admitted under its own extension.
    const encrypted = cfb(['EncryptionInfo', 'EncryptedPackage']);
    expect(await create(file(encrypted, 'contrat.docx'))).toMatchObject({ ok: true });
    expect(await documents()).toEqual(['PRO-QUA-0001']);
  });

  it('answers the import with 415 and the formats admitted, 413 beyond the size', async () => {
    let res = await importWith('L-1', 'outil.exe', PE);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'file_format', reason: 'format', ext: '.exe', allowed: expect.arrayContaining(['.pdf', '.docx', '.dwg']) });
    res = await importWith('L-2', 'scan.pdf', PE);
    expect([res.status, await res.json()]).toMatchObject([415, { error: 'file_format', reason: 'executable' }]);
    vi.stubEnv('CODEX_MAX_FILE_MB', String(1 / 1024));
    res = await importWith('L-3', 'gros.pdf', Buffer.concat([Buffer.from(PDF), Buffer.alloc(2048, 0x20)]));
    expect([res.status, await res.json()]).toEqual([413, { error: 'too_large', maxBytes: 1024 }]);
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
  });
});

describe('the name a file is recorded and served under', () => {
  // The extension checked is the one the file is stored and downloaded with: "procedure.hta/" is a .hta for path.extname,
  // which named the stored file and the download, while the last segment of its name is empty.
  it('refuses a name whose extension hides behind a trailing separator, on screen and on import', async () => {
    const hta = `%PDF-1.4\n<html><head><HTA:APPLICATION/></head><body><script>close()</script></body></html>`;
    for (const name of ['procedure.hta/', 'procedure.hta\\', 'procedure.hta.', 'procedure.hta /']) {
      expect(await create(file(hta, name)), name).toMatchObject({ ok: false, error: expect.stringMatching(/^Format non admis : \.hta\./) });
    }
    const res = await importWith('L-HTA', 'note.hta/', hta);
    expect([res.status, await res.json()]).toMatchObject([415, { error: 'file_format', reason: 'format', ext: '.hta' }]);
    await expect(stageFile(Buffer.from(hta), 'x.hta/', '', { userId: 'writer', entry: 'create' })).rejects.toThrow(FileRejectedError);
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('keeps the last segment of a path, and its extension', async () => {
    const res = await importWith('L-PATH', 'C:\\fakepath\\Rapport final.pdf', PDF);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [v] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, id));
    expect([v.fileName, v.mime]).toEqual(['Rapport final.pdf', 'application/pdf']);
    expect(v.fileKey).toMatch(new RegExp(`-${id}_C\\.pdf$`));
  });

  it('gives a name without extension the extension of its content, never that of the type it was sent with', async () => {
    const origin = { userId: 'writer', entry: 'create' } as const;
    const pdf = await stageFile(Buffer.from(PDF), 'scan', 'image/svg+xml', origin);
    expect([pdf.mime, pdf.ext]).toEqual(['application/pdf', '.pdf']);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    const photo = await stageFile(png, 'photo', 'image/svg+xml', origin);
    expect([photo.mime, photo.ext]).toEqual(['application/octet-stream', '']);
  });

  it('serves a file recorded before under such a name without the hidden extension', async () => {
    const res = await importWith('L-OLD', 'note.pdf', PDF);
    const { id } = (await res.json()) as { id: string };
    // As a row stored before names were cleaned would read.
    await db().update(s.workingVersions).set({ fileName: 'note.hta/' }).where(eq(s.workingVersions.docId, id));
    actAs('manager');
    const got = await getFile(new Request(`http://codex.test/api/documents/${id}/file?download=1`), { params: Promise.resolve({ id }) });
    expect(got.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${id}_C.pdf`);
  });
});

describe('virus scan', () => {
  beforeEach(() => {
    vi.stubEnv('CODEX_CLAMD', clamd.address);
  });

  it('stores a clean file after scanning it', async () => {
    const before = clamd.streams.length;
    expect(await create(file(PDF, 'propre.pdf', 'application/pdf'))).toMatchObject({ ok: true });
    expect(clamd.streams.slice(before).map((b) => b.toString('latin1'))).toEqual([PDF]);
    expect(stored()).toHaveLength(1);
    expect(await refusals()).toEqual([]);
  });

  it('refuses an infected new document: nothing stored, an entry in the Administration journal', async () => {
    expect(await create(file(EICAR, 'eicar.txt', 'text/plain'))).toEqual({ ok: false, error: 'Fichier refusé : l’analyse antivirus a détecté « Eicar-Test-Signature ». Il n’a pas été enregistré.' });
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
    expect(await refusals()).toMatchObject([{ userId: 'writer', docId: null, targetKind: 'file', targetId: 'create', revisionId: null, data: { file: { name: 'eicar.txt', size: EICAR.length, threat: 'Eicar-Test-Signature' } } }]);
  });

  it('refuses an infected working version; the journal names its file and document to records managers only (D-14)', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    const content = `Rapport\n${EICAR}\n`;
    // The usual name of a working version downloaded, edited and sent again: it gives the draft's ID and version.
    const res = await upload(file(content, 'PRO-QUA-0001_A.1.txt', 'text/plain'));
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('Eicar-Test-Signature') });
    expect(await versionCount('PRO-QUA-0001')).toBe(1);
    expect(stored()).toEqual([]);
    expect(await refusals()).toMatchObject([{ targetKind: 'file', targetId: 'working', docId: null, data: { file: { name: 'PRO-QUA-0001_A.1.txt', doc: 'PRO-QUA-0001' } } }]);

    actAs('manager');
    const [row] = (await auditPage(await getCtx(), { action: 'file_rejected' })).rows;
    expect([row.actionLabel, row.ref, row.detail, row.href]).toEqual(['Fichier refusé (antivirus)', 'Fichier déposé · version de travail', `PRO-QUA-0001_A.1.txt · ${content.length} o · « Eicar-Test-Signature » · PRO-QUA-0001`, '/administration?tab=audit']);

    // An approver given the Administer right reads the journal without documents: neither this draft's ID nor the name
    // of its file, on screen or in the export.
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    actAs('quality');
    const seen = (await auditPage(await getCtx(), { action: 'file_rejected' })).rows;
    expect(seen.map((r) => [r.ref, r.detail])).toEqual([['Fichier déposé · version de travail', `.txt · ${content.length} o · « Eicar-Test-Signature »`]]);
    const csv = await (await exportAudit(new Request('http://codex.test/api/export/audit'))).text();
    expect(csv).toContain('« Eicar-Test-Signature »');
    expect(csv).not.toContain('PRO-QUA-0001');
    // Nor does the record's own journal show anything.
    expect(await db().select().from(s.auditLog).where(eq(s.auditLog.docId, 'PRO-QUA-0001'))).toEqual([]);
  });

  it('refuses an infected import with 422, journaled under its legacy reference', async () => {
    const res = await importWith('GED1/VIRUS', 'note.txt', EICAR);
    expect([res.status, await res.json()]).toEqual([422, { error: 'file_infected', threat: 'Eicar-Test-Signature' }]);
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
    expect(await refusals()).toMatchObject([{ userId: 'codex', targetId: 'import', data: { file: { name: 'note.txt', ref: 'GED1/VIRUS' } } }]);
  });

  it('refuses the file when clamd cannot be reached, unless CODEX_CLAMD_ON_ERROR=accept', async () => {
    vi.stubEnv('CODEX_CLAMD', await deadAddress());
    expect(await create(file(PDF, 'a.pdf', 'application/pdf'))).toEqual({ ok: false, error: t.file_scan_failed });
    const res = await importWith('L-9', 'a.pdf', PDF);
    expect([res.status, res.headers.get('retry-after'), await res.json()]).toEqual([503, '60', { error: 'scan_unavailable' }]);
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
    expect(await refusals()).toEqual([]);

    vi.stubEnv('CODEX_CLAMD_ON_ERROR', 'accept');
    expect(await create(file(PDF, 'a.pdf', 'application/pdf'))).toMatchObject({ ok: true });
    expect(await documents()).toEqual(['PRO-QUA-0001']);
  });

  it('refuses a file beyond clamd\'s limits as such, without asking to send it again', async () => {
    clamd.mode = 'limit';
    expect(await create(file(PDF, 'gros.pdf', 'application/pdf'))).toEqual({ ok: false, error: t.file_scan_too_large });
    const res = await importWith('L-BIG', 'gros.pdf', PDF);
    expect([res.status, res.headers.get('retry-after'), await res.json()]).toEqual([413, null, { error: 'scan_too_large' }]);
    // Reported by clamd with AlertExceedsMax: not a threat, not journaled.
    clamd.mode = 'exceeds';
    expect(await create(file(PDF, 'gros.pdf', 'application/pdf'))).toEqual({ ok: false, error: t.file_scan_too_large });
    expect(await documents()).toEqual([]);
    expect(stored()).toEqual([]);
    expect(await refusals()).toEqual([]);
  });

  it('scans nothing without CODEX_CLAMD: files are stored, as in local use', async () => {
    vi.stubEnv('CODEX_CLAMD', '');
    const before = clamd.streams.length;
    expect(await create(file(EICAR, 'eicar.txt', 'text/plain'))).toMatchObject({ ok: true });
    expect(clamd.streams.length).toBe(before);
  });
});
