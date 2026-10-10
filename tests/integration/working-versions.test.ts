import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { addWorkingVersion, createDocument } from '@/lib/actions';
import { DICT } from '@/lib/i18n';
import { applyChangeDecision } from '@/lib/lifecycle';
import { submitChange } from '@/lib/vigie';
import { addDoc, fixClock, getDoc, journalOf, revisionStatuses, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Creating a document and adding working versions through the Server Actions: the ID is given to the draft at
// creation (D-09, D-10), working versions A.1, A.2… are kept under the same letter (D-12, docs/modele-cible.md §4) and
// stored as {ID}_{letter}.{n}.{ext} (§3); only the drafting circle adds them, never on a locked document or under review.

// The actions read the test's database; files go to a temporary folder instead of .data/files.
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
const pdf = (name = 'plan.pdf') => new File(['%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n%%EOF'], name, { type: 'application/pdf' });

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function upload(who: Person, docId = ID, comment = '') {
  actAs(who);
  return addWorkingVersion(form({ docId, file: pdf(), comment }));
}

/** Working versions of the document: label, author, stored file name (null without file). */
async function versions(docId = ID) {
  const rows = await db()
    .select({ letter: s.revisions.letter, n: s.workingVersions.n, authorId: s.workingVersions.authorId, fileKey: s.workingVersions.fileKey })
    .from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(eq(s.workingVersions.docId, docId))
    .orderBy(asc(s.workingVersions.id));
  return rows.map((r) => {
    if (r.fileKey) expect(existsSync(path.join(FILES_DIR, r.fileKey)), r.fileKey).toBe(true);
    // A local key is a UUID, a dash, then the file's name.
    return [`${r.letter}.${r.n}`, r.authorId, r.fileKey?.slice(37) ?? null];
  });
}

describe('createDocument (D-09, D-10)', () => {
  it('gives the draft its ID at creation, with revision A and working version A.1', async () => {
    actAs('owner');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', file: pdf() }))).toEqual({ ok: true, href: `/documents/${ID}?tab=meta`, message: `${t.id_preview} : ${ID}` });
    expect(await getDoc(db(), ID)).toMatchObject({ ownerId: 'owner', department: 'QUA', status: 'draft', revInForce: null, revWorking: 'A' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect(await versions()).toEqual([['A.1', 'owner', `${ID}_A.1.pdf`]]);
    expect((await journalOf(db(), ID)).map((e) => [e.userId, e.action])).toEqual([['owner', 'upload']]);
  });

  it('numbers documents created one after the other consecutively', async () => {
    actAs('owner');
    await createDocument(form({ title: 'One', typeCode: 'PRO' }));
    await createDocument(form({ title: 'Two', typeCode: 'PRO' }));
    await createDocument(form({ title: 'Other department', typeCode: 'PRO', department: 'ING' }));
    const ids = (await db().select({ id: s.documents.id }).from(s.documents)).map((d) => d.id);
    expect(ids.sort()).toEqual(['PRO-ING-0001', 'PRO-QUA-0001', 'PRO-QUA-0002']);
  });
});

describe('addWorkingVersion (D-12)', () => {
  it('adds A.2, A.3… under the same letter and keeps every earlier version', async () => {
    actAs('owner');
    await createDocument(form({ title: 'Procédure', typeCode: 'PRO', file: pdf() }));
    expect(await upload('owner')).toEqual({ ok: true, href: `/documents/${ID}?tab=versions` });
    expect(await upload('owner', ID, 'relecture')).toMatchObject({ ok: true });
    expect(await versions()).toEqual([
      ['A.1', 'owner', `${ID}_A.1.pdf`],
      ['A.2', 'owner', `${ID}_A.2.pdf`],
      ['A.3', 'owner', `${ID}_A.3.pdf`],
    ]);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect((await journalOf(db(), ID)).map((e) => e.detail.split(' · ')[0])).toEqual(['A.1', 'A.2', 'A.3']);
  });

  it('starts at B.1 on the revision an accepted change opens, for its designated author', async () => {
    await addDoc(db(), { id: ID });
    const req = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer', reason: 'r', description: '' }));
    await db().transaction((tx) => applyChangeDecision(tx, req, { accepted: true, ecoRef: 'ECO-2026-010', modifierId: 'writer2' }, 'vigie'));
    expect((await upload('writer2')).ok).toBe(true);
    expect((await upload('writer2')).ok).toBe(true);
    expect((await versions()).slice(-2)).toEqual([
      ['B.1', 'writer2', `${ID}_B.1.pdf`],
      ['B.2', 'writer2', `${ID}_B.2.pdf`],
    ]);
  });

  it('is refused outside the drafting circle (D-14)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: 'writer2' }] });
    expect(await upload('writer')).toEqual({ ok: false, error: t.not_allowed });
    // A draft that never entered into force does not exist for them.
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft' }] });
    expect(await upload('writer', 'PRO-QUA-0002')).toEqual({ ok: false, error: t.not_found });
  });

  it('is refused while the revision is under review, and on a locked document', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    expect(await upload('owner')).toEqual({ ok: false, error: t.not_draft });
    await addDoc(db(), { id: 'PRO-QUA-0002', legalHold: true, revisions: [{ letter: 'A', status: 'draft' }] });
    expect(await upload('owner', 'PRO-QUA-0002')).toEqual({ ok: false, error: t.locked_hold });
    expect(await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-QUA-0002'))).toEqual([]);
  });
});
