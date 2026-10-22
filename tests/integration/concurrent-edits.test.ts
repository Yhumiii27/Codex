import { readdirSync, rmSync } from 'node:fs';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { addWorkingVersion, createDocument, recordReview, requestChange, requestValidation, setReaders, updateMeta } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { audit, refreshHeadline } from '@/lib/lifecycle';
import { getDoc as getDocView } from '@/lib/queries';
import { addDoc, baseOf, fixClock, getDoc, getRevision, journalOf, revisionStatuses, setClock, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Concurrent changes from two views of the same record (point 20 of docs/reste-a-faire.md): two people open the record,
// the first one saves, the second one's dialog is refused as outdated, nothing written, and names who changed it, or the
// working version uploaded since and its author (D-12: both versions are kept once seen; an approval request does not
// start on a version its requester has not seen). Two sessions are simulated by switching the user (actAs) between
// actions that start from the same view (viewOf, baseOf, read before the first one acts). The version itself stays
// within the drafting circle (D-14).

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
const ID = 'PRO-QUA-0001'; // addDoc: owned by `owner`, revision A in force
const stale = (who: string) => ({ ok: false, error: t.stale.replace('{who}', who), stale: true });
const workingStale = (label: string, who: string) => ({ ok: false, error: t.working_stale.replace('{label}', label).replace('{who}', who), stale: true });
const validateStale = (label: string, who: string) => ({ ok: false, error: t.validate_stale.replace('{label}', label).replace('{who}', who), stale: true });
const anon = { ok: false, error: t.stale_anon, stale: true };

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** `who` saves the metadata dialog opened on `view` (its version), with these fields. */
function saveMeta(who: Person, view: { version: string }, fields: Record<string, string>, id = ID) {
  actAs(who);
  return updateMeta(form({ docId: id, version: view.version, ...fields }));
}

const pdf = () => new File(['%PDF-1.4\n%%EOF'], 'v.pdf', { type: 'application/pdf' });

/** `who` uploads from the dialog opened on `view` (the last working version it showed). */
function upload(who: Person, view: { baseRevision: string; baseVersion: string }, id = ID) {
  actAs(who);
  return addWorkingVersion(form({ docId: id, file: pdf(), baseRevision: view.baseRevision, baseVersion: view.baseVersion }));
}

/** Labels and authors of the working versions of the document, oldest first. */
async function versions(id = ID) {
  const rows = await db().select({ revisionId: s.workingVersions.revisionId, n: s.workingVersions.n, authorId: s.workingVersions.authorId }).from(s.workingVersions)
    .where(eq(s.workingVersions.docId, id)).orderBy(asc(s.workingVersions.id));
  const revs = await db().select().from(s.revisions).where(eq(s.revisions.docId, id));
  return rows.map((v) => [`${revs.find((r) => r.id === v.revisionId)?.letter}.${v.n}`, v.authorId]);
}

/**
 * Runs `meanwhile` as the action's next transaction opens: a change that comes in between its first checks and its
 * write (during an upload, say). PGlite runs one transaction at a time, so this is how the check made again inside the
 * transaction is reached.
 */
function meanwhileBeforeWrite(meanwhile: () => Promise<unknown>) {
  const d = db();
  const real = d.transaction.bind(d);
  vi.spyOn(d, 'transaction').mockImplementationOnce((async (...args: Parameters<typeof real>) => {
    await meanwhile();
    return real(...args);
  }) as typeof real);
}

const readersOf = async (id = ID) => (await db().select().from(s.documentReaders).where(eq(s.documentReaders.docId, id))).map((r) => r.userId).sort();

describe('documents.version (trigger documents_version, src/db/index.ts)', () => {
  it('moves one step at every change of the row, whatever writes it, and not for an update that changes nothing', async () => {
    await addDoc(db(), { id: ID });
    const v = (await getDoc(db(), ID)).version;
    // The headline is already in step with the revisions: nothing changes, the version stays.
    await db().transaction((tx) => refreshHeadline(tx, ID));
    expect((await getDoc(db(), ID)).version).toBe(v);
    await db().update(s.documents).set({ title: 'Autre titre' }).where(eq(s.documents.id, ID));
    expect((await getDoc(db(), ID)).version).toBe(v + 1);
    await db().update(s.documents).set({ title: 'Autre titre' }).where(eq(s.documents.id, ID));
    expect((await getDoc(db(), ID)).version).toBe(v + 1);
    // A statement that sets the version itself only moves it by one step.
    await db().update(s.documents).set({ version: 99 }).where(eq(s.documents.id, ID));
    expect((await getDoc(db(), ID)).version).toBe(v + 2);
  });
});

describe('updateMeta from an outdated view', () => {
  it('refuses the second of two edits made from the same view, names who saved first, and writes nothing', async () => {
    await addDoc(db(), { id: ID });
    const seen = await viewOf(db(), ID); // the owner and a records manager open the record
    expect(await saveMeta('owner', seen, { title: 'Titre du propriétaire' })).toEqual({ ok: true, message: t.saved_ok });
    const journal = (await journalOf(db(), ID)).length;
    expect(await saveMeta('manager', seen, { title: 'Titre du gestionnaire', keywords: 'levage' })).toEqual(stale('owner'));
    expect(await getDoc(db(), ID)).toMatchObject({ title: 'Titre du propriétaire', keywords: [] });
    expect((await journalOf(db(), ID)).length).toBe(journal);
    // Once the record is reloaded, the edit goes through.
    expect(await saveMeta('manager', await viewOf(db(), ID), { title: 'Titre du gestionnaire' })).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).title).toBe('Titre du gestionnaire');
  });

  it('checks the version again where it writes: a change that came in after the first check is not overwritten', async () => {
    await addDoc(db(), { id: ID });
    const seen = await viewOf(db(), ID);
    meanwhileBeforeWrite(async () => {
      actAs('manager');
      expect(await recordReview(ID, '2027-09-30')).toMatchObject({ ok: true });
    });
    expect(await saveMeta('owner', seen, { reviewDueAt: '2028-01-31', title: 'Trop tard' })).toEqual(stale('manager'));
    expect(await getDoc(db(), ID)).toMatchObject({ reviewDueAt: '2027-09-30', title: ID });
  });

  it('is refused after a change of the record by another path, and names its author, not who only read it', async () => {
    await addDoc(db(), { id: ID });
    const seen = await viewOf(db(), ID);
    actAs('owner');
    expect(await recordReview(ID, '2027-09-30')).toMatchObject({ ok: true });
    // A download leaves the record as it was: its author is not who changed it.
    await audit(db(), 'writer', 'download', ID, 'A · PDF');
    expect(await saveMeta('manager', seen, { reviewDueAt: '' })).toEqual(stale('owner'));
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2027-09-30');
  });

  it('names who changed the record, not who asked for a change since without changing it', async () => {
    await addDoc(db(), { id: ID });
    const seen = await viewOf(db(), ID); // the owner and a records manager open the record
    expect(await saveMeta('owner', seen, { title: 'Titre du propriétaire' })).toMatchObject({ ok: true });
    actAs('writer');
    expect(await requestChange(ID, 'modification', 'Coquille', '')).toMatchObject({ ok: true });
    expect(await saveMeta('manager', seen, { title: 'Titre du gestionnaire' })).toEqual(stale('owner'));
  });

  it('names who changed the record, not who uploaded a second working version the same day (the record unchanged)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const seen = await viewOf(db(), ID);
    expect(await saveMeta('owner', seen, { title: 'Titre du propriétaire' })).toMatchObject({ ok: true });
    const edited = (await getDoc(db(), ID)).version;
    // The owner's edit dated the record today: the designated author's upload leaves it as it was.
    expect(await upload('writer', await viewOf(db(), ID))).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).version).toBe(edited);
    expect(await saveMeta('manager', seen, { title: 'Titre du gestionnaire' })).toEqual(stale('owner'));
    // The first upload of a day dates the record: it changes it, and names its author.
    const today = await viewOf(db(), ID);
    setClock('2026-10-11T09:00:00Z');
    expect(await upload('writer', await viewOf(db(), ID))).toMatchObject({ ok: true });
    expect(await saveMeta('manager', today, { title: 'Titre du gestionnaire' })).toEqual(stale('writer'));
  });

  it('names the person whose action changed the record rather than Codex, which put the revision in force in it', async () => {
    const COR = 'COR-QUA-0001'; // no approval step: in force as soon as requested
    await addDoc(db(), { id: COR, typeCode: 'COR', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await viewOf(db(), COR);
    actAs('manager');
    expect(await requestValidation(COR, null, await baseOf(db(), COR))).toMatchObject({ ok: true });
    expect(await revisionStatuses(db(), COR)).toEqual({ A: 'in_force' });
    expect((await journalOf(db(), COR)).map((e) => [e.action, e.userId])).toEqual(expect.arrayContaining([['request', 'manager'], ['in_force', 'codex']]));
    expect(await saveMeta('owner', seen, { title: 'Courrier' }, COR)).toEqual(stale('manager'));
  });

  it('answers a form without its version (a page older than this rule) as outdated, naming nobody', async () => {
    await addDoc(db(), { id: ID });
    actAs('owner');
    expect(await updateMeta(form({ docId: ID, title: 'Sans version' }))).toEqual({ ok: false, error: t.stale_anon, stale: true });
    expect(await updateMeta(form({ docId: ID, version: 'abc', title: 'Sans version' }))).toEqual({ ok: false, error: t.stale_anon, stale: true });
    expect((await getDoc(db(), ID)).title).toBe(ID);
  });

  it('answers a form on the former ID of a reclassified document as outdated, to its drafting circle only', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await viewOf(db(), ID);
    expect(await saveMeta('manager', seen, { department: 'ING' })).toMatchObject({ ok: true, message: `${t.act_reclass} : PRO-ING-0001` });
    expect(await saveMeta('owner', seen, { title: 'Ancien ID' })).toEqual(stale('manager'));
    expect((await getDoc(db(), 'PRO-ING-0001')).title).toBe(ID);
    // Someone who may not read the draft learns nothing of it.
    expect(await saveMeta('writer', seen, { title: 'Ancien ID' })).toEqual({ ok: false, error: t.not_found });
  });

  it('still refuses a locked document with its lock, before its version', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const seen = await viewOf(db(), ID);
    expect(await saveMeta('owner', seen, { title: 'Gelé' })).toEqual({ ok: false, error: t.locked_hold });
  });
});

describe('setReaders from an outdated view', () => {
  it('refuses the second of two lists chosen from the same view, and keeps the first', async () => {
    await addDoc(db(), { id: ID, conf: 'confidentiel' });
    const seen = Number((await viewOf(db(), ID)).version);
    actAs('owner');
    expect(await setReaders(ID, ['writer2'], seen)).toEqual({ ok: true, message: t.saved_ok });
    actAs('manager');
    expect(await setReaders(ID, ['engineer'], seen)).toEqual(stale('owner'));
    expect(await readersOf()).toEqual(['writer2']);
    expect(await setReaders(ID, ['engineer'], Number((await viewOf(db(), ID)).version))).toMatchObject({ ok: true });
    expect(await readersOf()).toEqual(['engineer']);
  });

  it('checks the version again where it writes', async () => {
    await addDoc(db(), { id: ID, conf: 'confidentiel' });
    const seen = Number((await viewOf(db(), ID)).version);
    meanwhileBeforeWrite(() => saveMeta('owner', { version: String(seen) }, { title: 'Entre-temps' }));
    actAs('manager');
    expect(await setReaders(ID, ['engineer'], seen)).toEqual(stale('owner'));
    expect(await readersOf()).toEqual([]);
  });

  it('changes the version of the record: a metadata form opened before is outdated, and the other way round', async () => {
    await addDoc(db(), { id: ID, conf: 'confidentiel' });
    const seen = await viewOf(db(), ID);
    actAs('manager');
    expect(await setReaders(ID, ['writer2'], Number(seen.version))).toMatchObject({ ok: true });
    // Lowering the level would drop the readers just named: refused until the record is reloaded.
    expect(await saveMeta('owner', seen, { conf: 'interne' })).toEqual(stale('manager'));
    expect(await readersOf()).toEqual(['writer2']);

    const again = await viewOf(db(), ID);
    expect(await saveMeta('owner', again, { title: 'Nouveau titre' })).toMatchObject({ ok: true });
    actAs('manager');
    expect(await setReaders(ID, [], Number(again.version))).toEqual(stale('owner'));
    expect(await readersOf()).toEqual(['writer2']);
  });

  it('answers a list chosen on the former ID of a reclassified document as outdated, to whoever may still set it only', async () => {
    await addDoc(db(), { id: ID, conf: 'confidentiel', revisions: [{ letter: 'A', status: 'draft', modifierId: 'writer', versions: ['owner'] }] });
    const seen = Number((await viewOf(db(), ID)).version);
    expect(await saveMeta('manager', await viewOf(db(), ID), { department: 'ING' })).toMatchObject({ ok: true, message: `${t.act_reclass} : PRO-ING-0001` });
    actAs('owner');
    expect(await setReaders(ID, ['writer2'], seen)).toEqual(stale('manager'));
    // The designated author reads the draft but may not name its readers: the former ID tells him nothing more.
    actAs('writer');
    expect(await setReaders(ID, ['writer2'], seen)).toEqual({ ok: false, error: t.not_found });
    expect(await readersOf('PRO-ING-0001')).toEqual([]);
  });
});

describe('addWorkingVersion from an outdated view (D-12)', () => {
  it('refuses an upload whose dialog missed a later working version, naming it and its author', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await viewOf(db(), ID); // both dialogs show A.1 as the last version
    expect(await upload('owner', seen)).toMatchObject({ ok: true });
    const stored = readdirSync(FILES_DIR).length;
    expect(await upload('manager', seen)).toEqual(workingStale('A.2', 'owner'));
    expect(await versions()).toEqual([['A.1', 'owner'], ['A.2', 'owner']]);
    // Refused before the file went to the store: nothing is left behind.
    expect(readdirSync(FILES_DIR)).toHaveLength(stored);
    // Reloaded, the dialog starts from A.2: A.3 is added and both are kept.
    expect(await upload('manager', await viewOf(db(), ID))).toMatchObject({ ok: true });
    expect(await versions()).toEqual([['A.1', 'owner'], ['A.2', 'owner'], ['A.3', 'manager']]);
  });

  it('checks again in the transaction: a version uploaded while the file was being stored wins, the file is removed', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await viewOf(db(), ID);
    const stored = readdirSync(FILES_DIR).length;
    meanwhileBeforeWrite(async () => {
      expect(await upload('owner', seen)).toMatchObject({ ok: true });
      actAs('manager');
    });
    expect(await upload('manager', seen)).toEqual(workingStale('A.2', 'owner'));
    expect(await versions()).toEqual([['A.1', 'owner'], ['A.2', 'owner']]);
    // The owner's A.2 is stored; the manager's file, stored before the transaction, is removed.
    expect(readdirSync(FILES_DIR)).toHaveLength(stored + 1);
  });

  it('also guards the first working version of a document created without a file', async () => {
    actAs('owner');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO' }))).toMatchObject({ ok: true });
    const seen = await viewOf(db(), ID);
    expect(seen.baseVersion).toBe('0');
    expect(await upload('owner', seen)).toMatchObject({ ok: true });
    expect(await upload('manager', seen)).toEqual(workingStale('A.1', 'owner'));
    expect(await versions()).toEqual([['A.1', 'owner']]);
  });

  it('refuses an upload started on another revision, or without the version it started from', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'superseded', versions: ['owner'] }, { letter: 'B', status: 'in_force', versions: ['owner'] }, { letter: 'C', status: 'draft', versions: ['owner'] }] });
    const a = await getRevision(db(), ID, 'A');
    // The record was last changed by addDoc, which wrote no journal entry: nobody to name.
    expect(await upload('owner', { baseRevision: String(a.id), baseVersion: '1' })).toEqual(anon);
    actAs('owner');
    expect(await addWorkingVersion(form({ docId: ID, file: pdf() }))).toEqual(anon);
    // A version the revision does not have is no base either.
    const c = await getRevision(db(), ID, 'C');
    expect(await upload('owner', { baseRevision: String(c.id), baseVersion: '5' })).toMatchObject({ ok: false, stale: true });
    expect(await versions()).toEqual([['A.1', 'owner'], ['B.1', 'owner'], ['C.1', 'owner']]);
  });

  it('answers an upload on the former ID of a reclassified draft as outdated, to its drafting circle only', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await viewOf(db(), ID);
    expect(await saveMeta('manager', seen, { department: 'ING' })).toMatchObject({ ok: true, message: `${t.act_reclass} : PRO-ING-0001` });
    expect(await upload('owner', seen)).toEqual(stale('manager'));
    // Outside the drafting circle the draft does not exist, nor does its former ID (D-14).
    expect(await upload('writer', seen)).toEqual({ ok: false, error: t.not_found });
    expect(await versions('PRO-ING-0001')).toEqual([['A.1', 'owner']]);
  });
});

describe('requestValidation from an outdated view', () => {
  it('does not start the circuit on a working version uploaded since the dialog opened, and names it', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const seen = await baseOf(db(), ID); // the owner opens « Demander la validation » on B.1
    expect(await upload('writer', await viewOf(db(), ID))).toMatchObject({ ok: true });
    actAs('owner');
    expect(await requestValidation(ID, null, seen)).toEqual(validateStale('B.2', 'writer'));
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect(await db().select().from(s.workflows)).toEqual([]);
    // Reloaded, the circuit starts on B.2.
    expect(await requestValidation(ID, null, await baseOf(db(), ID))).toMatchObject({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'in_review' });
  });

  it('does not put in force at once, for a type without approval, a version its requester has not seen', async () => {
    const COR = 'COR-QUA-0001';
    await addDoc(db(), { id: COR, typeCode: 'COR', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    const seen = await baseOf(db(), COR);
    expect(await upload('owner', await viewOf(db(), COR), COR)).toMatchObject({ ok: true });
    actAs('manager');
    expect(await requestValidation(COR, null, seen)).toEqual(validateStale('A.2', 'owner'));
    expect(await revisionStatuses(db(), COR)).toEqual({ A: 'draft' });
  });

  it('refuses a request without the working version it started from, naming nobody', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    actAs('owner');
    expect(await requestValidation(ID, null, null)).toEqual(anon);
    expect(await requestValidation(ID, null, { revisionId: 0, n: 1 })).toEqual(anon);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
  });
});

describe('the version of the record stays within its drafting circle (D-14)', () => {
  /** The record as `who` is given it (lib/queries.ts getDoc, docView). */
  async function recordAs(who: Person) {
    actAs(who);
    const res = await getDocView(await getCtx(), ID);
    if (!res || res === 'hidden') throw new Error(`${ID} hidden from ${who}`);
    return res.doc;
  }

  it('is 0 outside the circle, whose view of the record does not change when a working version is uploaded', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    const outside = await recordAs('writer');
    expect(outside).toMatchObject({ version: 0, revWorking: null });
    const inside = (await recordAs('owner')).version;
    expect(inside).toBeGreaterThan(0);
    expect(await upload('owner', await viewOf(db(), ID))).toMatchObject({ ok: true });
    expect((await recordAs('owner')).version).toBe(inside + 1);
    expect(await recordAs('writer')).toEqual(outside);
  });
});
