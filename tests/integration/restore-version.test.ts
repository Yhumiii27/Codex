import { rmSync } from 'node:fs';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { addWorkingVersion, createDocument, requestValidation, restoreWorkingVersion } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditDetailL, listAudit } from '@/lib/queries';
import { addDoc, baseOf, fixClock, journalOf, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, setLangCookie } from '../support/session';

// « Restaurer » in the Revisions tab (point 65 of docs/reste-a-faire.md): an earlier working version of the revision
// being drafted becomes its next working version (D-12: nothing is removed), under the same checks as an upload
// (drafting circle D-14, lock, draft only, last version seen). A revision in force is never restored here: going back
// to it is a change request to Vigie (D-16).

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-test-files-')), getDb: async () => (await import('../support/db')).currentDb() };
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
const ID = 'PRO-QUA-0001';
const pdf = (body: string, name = 'plan.pdf') => new File([`%PDF-1.4\n% ${body}\n1 0 obj << /Type /Pages /Count 1 >> endobj\n%%EOF`], name, { type: 'application/pdf' });

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function upload(who: Person, body: string) {
  actAs(who);
  const { baseRevision, baseVersion } = await viewOf(db(), ID);
  return addWorkingVersion(form({ docId: ID, file: pdf(body), baseRevision, baseVersion }));
}

/** A draft A with A.1 and A.2 (different files), by its owner. */
async function draftWithTwo() {
  actAs('owner');
  expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', file: pdf('un') }))).toMatchObject({ ok: true });
  expect(await upload('owner', 'deux')).toMatchObject({ ok: true });
}

const versions = async (docId = ID) => db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, docId)).orderBy(asc(s.workingVersions.id));
const versionId = async (n: number, docId = ID) => (await versions(docId)).find((v) => v.n === n)!.id;

async function restore(who: Person, n: number, base?: { revisionId: number; n: number } | null) {
  actAs(who);
  const seen = base === undefined ? await baseOf(db(), ID) : base;
  return restoreWorkingVersion(ID, await versionId(n), seen);
}

describe('restoreWorkingVersion (point 65, D-12)', () => {
  it('makes an earlier working version the next one, its file copied, commented and journaled', async () => {
    await draftWithTwo();
    const [a1, a2] = await versions();
    expect(await restore('owner', 1)).toEqual({ ok: true, href: `/documents/${ID}?tab=versions`, message: t.restored_version.replace('{label}', 'A.3').replace('{from}', 'A.1') });
    const all = await versions();
    expect(all.map((v) => v.n)).toEqual([1, 2, 3]);
    const a3 = all[2];
    // Same bytes as A.1, under its own name; A.1 and A.2 untouched.
    expect(a3).toMatchObject({ sha256: a1.sha256, size: a1.size, authorId: 'owner', comment: { fr: 'Restaurée depuis A.1', en: 'Restored from A.1' } });
    expect(a3.fileKey).not.toBe(a1.fileKey);
    expect(a3.fileKey?.endsWith(`${ID}_A.3.pdf`)).toBe(true);
    expect((await versions()).slice(0, 2)).toEqual([a1, a2]);
    const entry = (await journalOf(db(), ID)).at(-1)!;
    expect(entry).toMatchObject({ userId: 'owner', action: 'working', detail: 'A.3 · A.1', data: { sha256: a1.sha256, text: { code: 'version_restored', params: { label: 'A.3', from: 'A.1', size: a1.size } } } });
    // Rendered in the reader's language (point 68).
    const ctx = await getCtx();
    expect(auditDetailL(ctx, { ...entry, data: { text: entry.data!.text } })).toBe(`A.3 · restaurée depuis A.1 · ${a1.size} o`);
    setLangCookie('en');
    expect(auditDetailL(await getCtx(), { ...entry, data: { text: entry.data!.text } })).toBe(`A.3 · restored from A.1 · ${a1.size} B`);
  });

  it('may be done by a records manager, never outside the drafting circle (D-14)', async () => {
    await draftWithTwo();
    // A draft never in force does not exist for someone outside its circle, nor for an auditor.
    expect(await restore('writer', 1)).toEqual({ ok: false, error: t.not_found });
    expect(await restore('auditor', 1)).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_upload}` });
    expect(await restore('manager', 1)).toMatchObject({ ok: true });
    expect((await versions()).map((v) => [v.n, v.authorId])).toEqual([[1, 'owner'], [2, 'owner'], [3, 'manager']]);
  });

  it('refuses the last version, a stale view, a revision under review and a locked document, writing nothing', async () => {
    await draftWithTwo();
    expect(await restore('owner', 2)).toEqual({ ok: false, error: t.restore_latest });
    // A view from before A.2: refused with who uploaded since.
    const old = await baseOf(db(), ID);
    expect(await restore('owner', 1, { ...old!, n: 1 })).toMatchObject({ ok: false, stale: true });
    expect(await restore('owner', 1, null)).toMatchObject({ ok: false, stale: true });
    actAs('owner');
    expect(await requestValidation(ID, null, await baseOf(db(), ID))).toMatchObject({ ok: true });
    expect(await restore('owner', 1)).toEqual({ ok: false, error: t.not_draft });
    expect((await versions()).map((v) => v.n)).toEqual([1, 2]);

    await addDoc(db(), { id: 'PRO-QUA-0002', legalHold: true, revisions: [{ letter: 'A', status: 'draft', versions: ['owner', 'owner'] }] });
    actAs('owner');
    const [v1] = await versions('PRO-QUA-0002');
    expect(await restoreWorkingVersion('PRO-QUA-0002', v1.id, await baseOf(db(), 'PRO-QUA-0002'))).toEqual({ ok: false, error: t.locked_hold });
  });

  it('restores only a version of the draft revision: a revision in force goes through Vigie (D-16)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner', 'owner'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    const [a1] = await versions();
    actAs('owner');
    expect(await restoreWorkingVersion(ID, a1.id, await baseOf(db(), ID))).toEqual({ ok: false, error: t.restore_other_revision });
    // Without a draft, nothing to restore into.
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    const [x1] = await versions('PRO-QUA-0002');
    expect(await restoreWorkingVersion('PRO-QUA-0002', x1.id, null)).toEqual({ ok: false, error: t.need_in_force });
    // A version of another document.
    expect(await restoreWorkingVersion(ID, x1.id, await baseOf(db(), ID))).toEqual({ ok: false, error: t.restore_other_revision });
  });

  it('refuses a version without file', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner', 'owner'] }] });
    expect(await restore('owner', 1)).toEqual({ ok: false, error: t.restore_no_file });
  });
});

describe('journal details in the reader’s language (point 68)', () => {
  it('stores the size of a file filed as a parameter, rendered in each language', async () => {
    await draftWithTwo();
    const [upload1, working] = await journalOf(db(), ID);
    expect(upload1).toMatchObject({ action: 'upload', detail: 'A.1', data: { text: { code: 'version', params: { label: 'A.1', size: expect.any(Number) } } } });
    expect(working).toMatchObject({ action: 'working', detail: 'A.2', data: { text: { code: 'version', params: { label: 'A.2' } } } });
    actAs('owner');
    const fr = (await listAudit(await getCtx(), { docId: ID })).map((e) => e.detail.split(' · SHA-256')[0]);
    setLangCookie('en');
    const en = (await listAudit(await getCtx(), { docId: ID })).map((e) => e.detail.split(' · SHA-256')[0]);
    const [v1, v2] = await versions();
    expect(fr).toEqual([`A.2 · ${v2.size} o`, `A.1 · ${v1.size} o`]);
    expect(en).toEqual([`A.2 · ${v2.size} B`, `A.1 · ${v1.size} B`]);
  });
});

describe('structured details of every code (point 68)', () => {
  const entry = (text: object) => ({ detail: 'ignored', targetId: null, data: { text } as never });
  it('renders each in French and in English, the older free details as written', async () => {
    const cases: [object, string, string][] = [
      [{ code: 'version', params: { label: 'A.1', size: 2048, template: 'FRM-QMS-001' } }, 'A.1 · 2,0 Ko · depuis le modèle FRM-QMS-001', 'A.1 · 2.0 KB · from template FRM-QMS-001'],
      [{ code: 'import', params: { ref: 'LEG-1', label: 'B', size: 1024 } }, 'LEG-1 → B · 1,0 Ko', 'LEG-1 → B · 1.0 KB'],
      [{ code: 'readers', params: { n: 3 } }, `${DICT.fr.readers} (3)`, `${DICT.en.readers} (3)`],
      [{ code: 'step_delegated', params: { wf: 'W-1', step: { fr: 'Responsable qualité', en: 'Quality manager' }, to: 'Anne' } }, 'W-1 · Responsable qualité → Anne', 'W-1 · Quality manager → Anne'],
      [{ code: 'step_reassigned', params: { wf: 'W-1', step: { fr: 'Direction', en: 'Management' }, from: 'Paul', to: 'Anne' } }, 'W-1 · Direction : Paul → Anne', 'W-1 · Management: Paul → Anne'],
      [{ code: 'step_transferred', params: { wf: 'W-1', step: { fr: 'Direction', en: 'Management' } } }, 'W-1 · Direction', 'W-1 · Management'],
      [{ code: 'modifier_swap', params: { ref: 'ECO-1', from: 'Paul', to: 'Anne', denied: true } }, `ECO-1 · Paul → Anne (${DICT.fr.not_allowed} : ${DICT.fr.perm_upload})`, `ECO-1 · Paul → Anne (${DICT.en.not_allowed}: ${DICT.en.perm_upload})`],
    ];
    actAs('manager');
    const fr = await getCtx();
    setLangCookie('en');
    const en = await getCtx();
    for (const [text, inFr, inEn] of cases) {
      expect(auditDetailL(fr, entry(text))).toBe(inFr);
      expect(auditDetailL(en, entry(text))).toBe(inEn);
    }
    // An entry of before 18 October keeps its free detail; an unknown code falls back on it.
    expect(auditDetailL(en, { detail: 'A.2 · 1 Ko', targetId: null, data: null })).toBe('A.2 · 1 Ko');
    expect(auditDetailL(en, entry({ code: 'other', params: {} }))).toBe('ignored');
  });
});
