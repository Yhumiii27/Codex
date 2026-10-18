import { createHash } from 'node:crypto';
import { rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/documents/[id]/file/route';
import { FILES_DIR, schema as s } from '@/db';
import { checkFileIntegrity, createDocument } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { importDocument } from '@/lib/importer';
import { integrityL, listAudit } from '@/lib/queries';
import { addDoc, fixClock, journalOf, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Point 31 of docs/reste-a-faire.md: every file entering Codex gets its SHA-256 (working_versions.sha256), shown on the
// record and checked afterwards (Administration, npm run integrity, whole downloads); a file identical to one already
// filed brings a warning naming that document, only when the user may have that very file (D-14).

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-integrity-files-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

beforeAll(() => {
  vi.stubEnv('CODEX_STORAGE', 'local');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const t = DICT.fr;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const pdfBytes = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Pages /Count 1 >> endobj\n%%EOF\n`);
const asFile = (bytes: Buffer, name = 'plan.pdf') => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Stores `bytes` as the file of working version `n` of a revision, its fingerprint recorded (or `recorded`). */
async function attach(docId: string, letter: string, n: number, bytes: Buffer | null, recorded: string | null = bytes ? sha(bytes) : null) {
  const [v] = await db().select({ id: s.workingVersions.id }).from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(and(eq(s.workingVersions.docId, docId), eq(s.revisions.letter, letter), eq(s.workingVersions.n, n)));
  const key = `00000000-0000-4000-8000-${String(v.id).padStart(12, '0')}-${docId}_${letter}.${n}.pdf`;
  if (bytes) writeFileSync(path.join(FILES_DIR, key), bytes);
  await db().update(s.workingVersions).set({ storage: 'local', fileKey: key, fileName: 'plan.pdf', mime: 'application/pdf', size: bytes?.length ?? 99, sha256: recorded }).where(eq(s.workingVersions.id, v.id));
  return { id: v.id, key };
}

/** Creates a document from `bytes` as `who`; its result. */
async function upload(who: Person, bytes: Buffer, title = 'Nouveau') {
  actAs(who);
  return createDocument(form({ title, typeCode: 'PRO', file: asFile(bytes) }));
}

const FILES = {
  workA1: pdfBytes('PRO-QUA-0001 A.1, a working version'),
  finalA2: pdfBytes('PRO-QUA-0001 A.2, the file in force'),
  draft: pdfBytes('PRO-QUA-0002 A.1, a draft'),
  secret: pdfBytes('PRO-QUA-0003 A.1, highly confidential'),
};

/**
 * PRO-QUA-0001 in force at A (A.1 a working version, A.2 the final file), PRO-QUA-0002 a draft, PRO-QUA-0003 highly
 * confidential in force; all three owned by `owner`, none in the drafting circle of `writer`.
 */
async function filed() {
  await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner', 'owner'] }] });
  await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
  await addDoc(db(), { id: 'PRO-QUA-0003', conf: 'tres_confidentiel' });
  return {
    workA1: await attach('PRO-QUA-0001', 'A', 1, FILES.workA1),
    finalA2: await attach('PRO-QUA-0001', 'A', 2, FILES.finalA2),
    draft: await attach('PRO-QUA-0002', 'A', 1, FILES.draft),
    secret: await attach('PRO-QUA-0003', 'A', 1, FILES.secret),
  };
}

const lastVersion = async () => (await db().select().from(s.workingVersions).orderBy(asc(s.workingVersions.id))).at(-1)!;

describe('fingerprint recorded as the file enters Codex', () => {
  it('records the SHA-256 of a new document’s file, of a copy of a template and of an import, and journals it', async () => {
    const bytes = pdfBytes('new');
    expect(await upload('writer', bytes)).toMatchObject({ ok: true });
    const created = await lastVersion();
    expect(created.sha256).toBe(sha(bytes));
    expect((await journalOf(db(), created.docId)).find((e) => e.action === 'upload')?.data).toEqual({ sha256: sha(bytes), text: { code: 'version', params: { label: 'A.1', size: bytes.length } } });

    // A copy of a template: its bytes are the template's, and the copy carries no duplicate warning.
    await addDoc(db(), { id: 'FRM-QMS-0001', typeCode: 'FRM' });
    const tpl = pdfBytes('template');
    await attach('FRM-QMS-0001', 'A', 1, tpl);
    actAs('writer');
    const copy = await createDocument(form({ title: 'Depuis le modèle', typeCode: 'PRO', templateId: 'FRM-QMS-0001' }));
    expect(copy).toMatchObject({ ok: true });
    expect(copy).not.toHaveProperty('warning');
    expect((await lastVersion()).sha256).toBe(sha(tpl));

    const imported = pdfBytes('imported');
    const res = await importDocument({ legacyRef: 'GED/42', title: 'Reprise', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'B', inForceAt: '2025-03-12' }, { buf: imported, name: 'reprise.pdf', mime: 'application/pdf' });
    expect(res).toMatchObject({ kind: 'created' });
    expect((await lastVersion()).sha256).toBe(sha(imported));
  });

  it('refuses to copy a template whose stored bytes no longer match its fingerprint', async () => {
    await addDoc(db(), { id: 'FRM-QMS-0001', typeCode: 'FRM' });
    const { key } = await attach('FRM-QMS-0001', 'A', 1, pdfBytes('template'));
    writeFileSync(path.join(FILES_DIR, key), pdfBytes('template, changed on disk'));
    actAs('writer');
    expect(await createDocument(form({ title: 'Depuis le modèle', typeCode: 'PRO', templateId: 'FRM-QMS-0001' }))).toEqual({ ok: false, error: `${t.file_altered_template} : FRM-QMS-0001` });
  });
});

describe('duplicate warning (never naming what D-14 hides)', () => {
  it('names the file in force of a document the user reads, never a working version, a draft or a document they cannot read', async () => {
    await filed();
    const named = await upload('writer', FILES.finalA2);
    expect(named).toMatchObject({ ok: true, warning: t.same_file.replace('{docs}', 'PRO-QUA-0001 A « PRO-QUA-0001 »') });
    // Recorded all the same: the warning does not block.
    expect((await lastVersion()).sha256).toBe(sha(FILES.finalA2));
    for (const bytes of [FILES.workA1, FILES.draft, FILES.secret]) {
      const res = await upload('writer', bytes);
      expect(res).toMatchObject({ ok: true });
      expect(res).not.toHaveProperty('warning');
    }
  });

  it('names a working version or a draft to its drafting circle, a confidential document to who may read it', async () => {
    await filed();
    expect(await upload('owner', FILES.workA1)).toMatchObject({ warning: expect.stringContaining('PRO-QUA-0001 A.1 ') });
    expect(await upload('owner', FILES.draft)).toMatchObject({ warning: expect.stringContaining('PRO-QUA-0002 A.1 ') });
    expect(await upload('manager', FILES.secret)).toMatchObject({ warning: expect.stringContaining('PRO-QUA-0003 A ') });
  });

  it('warns the migration tool of a file in force readable by every reader of the group only', async () => {
    await filed();
    const meta = (ref: string) => ({ legacyRef: ref, title: `Doc ${ref}`, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' });
    const file = (buf: Buffer) => ({ buf, name: 'x.pdf', mime: 'application/pdf' });
    const same = await importDocument(meta('GED/1'), file(FILES.finalA2));
    expect(same).toMatchObject({ kind: 'created', warnings: [{ field: 'file', code: 'duplicate_file', message: expect.stringContaining('PRO-QUA-0001 A') }] });
    for (const [ref, buf] of [['GED/2', FILES.workA1], ['GED/3', FILES.draft], ['GED/4', FILES.secret]] as const) {
      expect(await importDocument(meta(ref), file(buf)), ref).toMatchObject({ kind: 'created', warnings: [] });
    }
  });
});

describe('fingerprint in the journal (D-14)', () => {
  it('shows the fingerprint of an upload to the drafting circle, not to a reader outside it', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    const [rev] = await db().select().from(s.revisions).where(eq(s.revisions.docId, 'PRO-QUA-0001'));
    await db().insert(s.auditLog).values({ at: '2026-10-01T08:00:00Z', userId: 'owner', action: 'working', docId: 'PRO-QUA-0001', detail: 'A.2 · 1 Ko', revisionId: rev.id, data: { sha256: 'ab'.repeat(32) } });
    actAs('owner');
    expect((await listAudit(await getCtx(), { docId: 'PRO-QUA-0001' }))[0].detail).toBe(`A.2 · 1 Ko · SHA-256 ${'ab'.repeat(8)}…`);
    actAs('writer');
    const [seen] = await listAudit(await getCtx(), { docId: 'PRO-QUA-0001' });
    expect(seen.detail).toBe('A.2 · 1 Ko');
    expect(seen.data).toEqual({});
  });
});

describe('integrity check from Administration', () => {
  it('reports altered and missing files, records missing fingerprints, journals it; records managers only', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner', 'owner', 'owner', 'owner'] }] });
    const intact = pdfBytes('intact');
    await attach('PRO-QUA-0001', 'A', 1, intact);
    const altered = await attach('PRO-QUA-0001', 'A', 2, pdfBytes('as uploaded'));
    writeFileSync(path.join(FILES_DIR, altered.key), pdfBytes('changed afterwards'));
    const missing = await attach('PRO-QUA-0001', 'A', 3, pdfBytes('gone'));
    unlinkSync(path.join(FILES_DIR, missing.key));
    const older = pdfBytes('stored before fingerprints');
    const legacy = await attach('PRO-QUA-0001', 'A', 4, older, null);

    actAs('writer');
    expect(await checkFileIntegrity()).toEqual({ ok: false, error: t.forbidden });
    actAs('head');
    expect(await checkFileIntegrity()).toEqual({ ok: false, error: t.forbidden });
    expect(await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'integrity_checked'))).toEqual([]);

    actAs('manager');
    const res = await checkFileIntegrity();
    expect(res).toMatchObject({ ok: true, warning: expect.stringContaining('altérés : 1 · absents : 1 · empreintes enregistrées : 1') });
    const [legacyRow] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.id, legacy.id));
    expect(legacyRow.sha256).toBe(sha(older));
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'integrity_checked'));
    expect(entry).toMatchObject({ userId: 'manager', targetKind: 'integrity', targetId: 'files', docId: null });
    expect(entry.data?.integrity).toEqual({
      checked: 3, bytes: intact.length + pdfBytes('changed afterwards').length + older.length,
      altered: [{ v: altered.id, doc: 'PRO-QUA-0001', label: 'A.2' }], alteredCount: 1,
      missing: [{ v: missing.id, doc: 'PRO-QUA-0001', label: 'A.3' }], missingCount: 1, filled: 1, skipped: 0, by: 'app',
    });
    // Documents and counts to records managers only; an administrator who is not one learns that something was found.
    const ctx = await getCtx();
    expect(integrityL(ctx, entry.data!.integrity!)).toContain('altérés : 1 : PRO-QUA-0001 A.2');
    expect(integrityL({ ...ctx, seesAll: false }, entry.data!.integrity!)).toBe(t.integrity_found);

    // A second check: the fingerprint recorded by the first now holds, nothing else changes.
    actAs('manager');
    expect(await checkFileIntegrity()).toMatchObject({ warning: expect.not.stringContaining('empreintes enregistrées') });
  });

  it('says so when every file matches', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await attach('PRO-QUA-0001', 'A', 1, pdfBytes('fine'));
    actAs('manager');
    expect(await checkFileIntegrity()).toMatchObject({ ok: true, message: expect.stringContaining(t.integrity_ok) });
  });
});

describe('a whole download checked on the way', () => {
  const get = (id: string, init?: RequestInit) => GET(new Request(`http://codex.test/api/documents/${id}/file?download=1`, init), { params: Promise.resolve({ id }) });

  it('serves an intact file whole', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    const bytes = pdfBytes('intact');
    await attach('PRO-QUA-0001', 'A', 1, bytes);
    actAs('writer');
    const res = await get('PRO-QUA-0001');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await journalOf(db(), 'PRO-QUA-0001')).map((e) => e.action)).toEqual(['download']);
  });

  it('cuts an altered file short, never handing it over as whole, and journals it', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    const { key } = await attach('PRO-QUA-0001', 'A', 1, pdfBytes('as uploaded'));
    writeFileSync(path.join(FILES_DIR, key), pdfBytes('changed afterwards'));
    actAs('writer');
    const res = await get('PRO-QUA-0001');
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    const journal = await journalOf(db(), 'PRO-QUA-0001');
    expect(journal.map((e) => [e.action, e.userId, e.detail])).toEqual([['download', 'writer', 'A · PDF'], ['file_altered', 'writer', 'A']]);
  });
});
