import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { updateMeta } from '@/lib/actions';
import { nextDocId, nextNumber, nextWorkflowId, reserveDocId } from '@/lib/codification';
import type { IdInput } from '@/lib/codes';
import { DICT } from '@/lib/i18n';
import { submitChange } from '@/lib/vigie';
import { addDoc, addWorkflow, fixClock, getDoc, getRevisions, journalOf, setClock, setupDb, viewOf, type DocSpec } from '../support/db';
import { actAs } from '../support/session';

// Identifiers on a real database (D-09, D-10, docs/modele-cible.md §3; counters of step 5): one counter per
// (type, context), never a number already used as an ID or kept as an alias, W-n circuits, ECR-AAAA-NNN requests.
//
// Limit of the "concurrent" tests: PGlite has a single connection and runs transactions one after the other. They
// check that interleaved callers (Promise.all) get no duplicate under that serialization; they cannot catch a counter
// that reads then writes in two statements, which would hand out one number twice to two connections of a Postgres
// server (step 5, O-03). That race needs a Postgres server to be tested.

// Reclassification runs through the Server Action updateMeta (simulated session, tests/support/session.ts).
vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const procedure: IdInput = { typeCode: 'PRO', attachment: 'none', department: 'QUA' };
const projectDoc: IdInput = { typeCode: 'PID', attachment: 'project', projectCode: 'HLT-026', department: 'ING' };
const template: IdInput = { typeCode: 'FRM', attachment: 'none', department: 'HSE' };
const research: IdInput = { typeCode: 'PRT', attachment: 'research', programCode: 'R2601', department: 'RDI' };

/** `n` IDs drawn one transaction after the other. */
async function draw(d: IdInput, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await db().transaction((tx) => nextDocId(tx, d)));
  return out;
}

describe('nextDocId (D-09, D-10)', () => {
  it('numbers each (type, context) pair on its own, from 1, consecutively', async () => {
    expect(await draw(procedure, 3)).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003']);
    expect(await draw({ ...procedure, department: 'ING' }, 2)).toEqual(['PRO-ING-0001', 'PRO-ING-0002']);
    expect(await draw({ ...procedure, typeCode: 'COR' }, 1)).toEqual(['COR-QUA-0001']);
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0004']);
  });

  it('codes a project document with the full project code, a template with QMS, a research document with its programme', async () => {
    expect(await draw(projectDoc, 2)).toEqual(['PID-HLT-026-001', 'PID-HLT-026-002']);
    expect(await draw(template, 1)).toEqual(['FRM-QMS-001']);
    // A template stays in the QMS space whatever its department: one counter for all templates.
    expect(await draw({ ...template, department: 'QUA' }, 1)).toEqual(['FRM-QMS-002']);
    expect(await draw(research, 1)).toEqual(['PRT-R2601-001']);
  });

  it('starts after the highest number already used by a document of the scope', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0007' });
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0008']);
  });

  it('never hands out a number kept as an alias (reclassified document, migrated legacy reference)', async () => {
    // A document reclassified from PRO-QUA-0005 to PRO-ING-0001 keeps its former ID as an alias.
    await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', aliases: ['PRO-QUA-0005'] });
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0006']);
  });

  it('never hands out again the number of a document reclassified after it drew it', async () => {
    const [first] = await draw(procedure, 1);
    await addDoc(db(), { id: first });
    // Reclassification before any approval: new ID, the former one kept as an alias (lib/actions.ts, updateMeta).
    const [moved] = await draw({ ...procedure, department: 'ING' }, 1);
    await db().update(s.documents).set({ id: moved, aliases: [first] }).where(sql`${s.documents.id} = ${first}`);
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0002']);
  });

  it('ignores identifiers of other scopes and malformed numbers', async () => {
    await addDoc(db(), { id: 'PRO-QUAL-0042', aliases: ['PRO-QUA-00x9', 'PRO-QUA-', 'XPRO-QUA-0050'] });
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0001']);
  });

  it('gives back the number of a transaction that rolled back: no document was ever written with it', async () => {
    await expect(db().transaction(async (tx) => {
      expect(await nextDocId(tx, procedure)).toBe('PRO-QUA-0001');
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0001']);
  });

  it('hands out distinct, consecutive IDs to interleaved transactions (serialized by PGlite)', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0010' });
    const ids = await Promise.all(Array.from({ length: 12 }, () => db().transaction((tx) => nextDocId(tx, procedure))));
    expect(new Set(ids).size).toBe(12);
    expect([...ids].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `PRO-QUA-${String(11 + i).padStart(4, '0')}`));
  });

  it('keeps interleaved transactions of different scopes apart (serialized by PGlite)', async () => {
    const scopes = [procedure, projectDoc, procedure, projectDoc, procedure];
    const ids = await Promise.all(scopes.map((d) => db().transaction((tx) => nextDocId(tx, d))));
    expect([...ids].sort()).toEqual(['PID-HLT-026-001', 'PID-HLT-026-002', 'PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003']);
  });
});

describe('updateMeta: reclassification (D-10, docs/modele-cible.md §3 and §6)', () => {
  const t = DICT.fr;

  /** The owner submits the metadata form with these fields; the others keep their stored values. */
  async function edit(id: string, fields: Record<string, string>) {
    actAs('owner');
    const fd = new FormData();
    fd.set('docId', id);
    fd.set('version', (await viewOf(db(), id)).version);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return updateMeta(fd);
  }

  /** The owner moves the document to the ING department through the metadata form. */
  const moveToIng = (id: string) => edit(id, { department: 'ING' });

  /** A project whose code starts with the code of the QUA department (a client "QUA"). */
  const addQuaProject = () => db().insert(s.projects).values({ code: 'QUA-012', name: 'Quai', client: 'QUA', stage: 'Etudes', managerId: 'pm', site: '', tiers: '', syncedAt: '2026-10-01 08:00:00' });
  const draft: DocSpec['revisions'] = [{ letter: 'A', status: 'draft', versions: ['owner'] }];

  it('re-codifies a document never approved, keeps its former ID as an alias, and never hands that number out again', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect(await moveToIng('PRO-QUA-0001')).toMatchObject({ ok: true, message: `${t.act_reclass} : PRO-ING-0001` });
    expect(await getDoc(db(), 'PRO-ING-0001')).toMatchObject({ department: 'ING', aliases: ['PRO-QUA-0001'], status: 'draft', revWorking: 'A' });
    expect(await db().select({ id: s.documents.id }).from(s.documents)).toEqual([{ id: 'PRO-ING-0001' }]);
    // The revision being drafted follows the new ID, and the journal links the two IDs on it.
    const [a] = await getRevisions(db(), 'PRO-ING-0001');
    expect(a.letter).toBe('A');
    expect((await journalOf(db(), 'PRO-ING-0001')).map((e) => [e.userId, e.action, e.detail, e.revisionId])).toContainEqual(['owner', 'reclass', 'PRO-QUA-0001 → PRO-ING-0001', a.id]);
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0002']);
  });

  it.each<[string, DocSpec['revisions']]>([
    ['a revision in force', [{ letter: 'A', status: 'in_force' }]],
    ['a revision approved, waiting for its effective date', [{ letter: 'A', status: 'approved', effectiveAt: '2026-10-20' }]],
  ])('never changes the ID of a document with %s', async (_, revisions) => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions });
    expect(await moveToIng('PRO-QUA-0001')).toMatchObject({ ok: true, message: t.saved_ok });
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ department: 'ING', aliases: [] });
    expect((await journalOf(db(), 'PRO-QUA-0001')).map((e) => e.action)).toEqual(['edit']);
  });

  it('re-codifies a project document moved to the department that shares its client code', async () => {
    await addQuaProject();
    await addDoc(db(), { id: 'COR-QUA-012-001', typeCode: 'COR', projectCode: 'QUA-012', revisions: draft });
    expect(await edit('COR-QUA-012-001', { attachment: 'none' })).toMatchObject({ ok: true, message: `${t.act_reclass} : COR-QUA-0001` });
    expect(await getDoc(db(), 'COR-QUA-0001')).toMatchObject({ attachment: 'none', projectCode: null, department: 'QUA', aliases: ['COR-QUA-012-001'] });
  });

  it('re-codifies a department document attached to a project whose client code is the department', async () => {
    await addQuaProject();
    await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR', revisions: draft });
    expect(await edit('COR-QUA-0001', { attachment: 'project', projectCode: 'QUA-012' })).toMatchObject({ ok: true, message: `${t.act_reclass} : COR-QUA-012-001` });
    expect(await getDoc(db(), 'COR-QUA-012-001')).toMatchObject({ attachment: 'project', projectCode: 'QUA-012', aliases: ['COR-QUA-0001'] });
  });

  it.each<[string, DocSpec, Record<string, string>]>([
    ['a project document (project code with a dash)', { id: 'PID-HLT-026-001', typeCode: 'PID', projectCode: 'HLT-026', department: 'ING' }, { projectCode: 'HLT-026' }],
    ['a department document', { id: 'PRO-QUA-0001' }, {}],
    ['a department document numbered past its width', { id: 'PRO-QUA-12345' }, {}],
    ['a template', { id: 'FRM-QMS-012', typeCode: 'FRM' }, {}],
    ['a research document', { id: 'PRT-R2601-004', typeCode: 'PRT', department: 'RDI' }, { programCode: 'R2601' }],
  ])('keeps the ID of %s never approved when neither its type nor its context changes', async (_, spec, fields) => {
    await addDoc(db(), { ...spec, revisions: draft });
    if (spec.typeCode === 'PRT') await db().update(s.documents).set({ attachment: 'research', programCode: 'R2601' }).where(sql`${s.documents.id} = ${spec.id}`);
    expect(await edit(spec.id, { ...fields, title: 'Nouveau titre' })).toMatchObject({ ok: true, message: t.saved_ok });
    expect(await getDoc(db(), spec.id)).toMatchObject({ title: 'Nouveau titre', aliases: [] });
    expect((await journalOf(db(), spec.id)).map((e) => e.action)).toEqual(['edit']);
  });

  it('refuses to change the type or context while a circuit runs, and changes nothing', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0001', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
    expect(await moveToIng('PRO-QUA-0001')).toEqual({ ok: false, error: t.circuit_running });
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ department: 'QUA', aliases: [] });
    expect(await journalOf(db(), 'PRO-QUA-0001')).toEqual([]);
    expect(await db().select().from(s.idCounters)).toEqual([]);
  });
});

describe('reserveDocId (step 5)', () => {
  it('raises the counter to an explicit ID written without nextDocId, so that its number is never handed out', async () => {
    await db().transaction((tx) => reserveDocId(tx, 'PRO-QUA-0042'));
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0043']);
  });

  it('never lowers a counter already further on', async () => {
    await draw(procedure, 5);
    await db().transaction((tx) => reserveDocId(tx, 'PRO-QUA-0002'));
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0006']);
  });

  it('reserves within the right scope, a project code included', async () => {
    await db().transaction((tx) => reserveDocId(tx, 'PID-HLT-026-017'));
    expect(await draw(projectDoc, 1)).toEqual(['PID-HLT-026-018']);
    expect(await draw(procedure, 1)).toEqual(['PRO-QUA-0001']);
  });

  it('leaves the counters alone for a reference that does not read TYPE-CONTEXTE-SEQ', async () => {
    await db().transaction(async (tx) => {
      await reserveDocId(tx, 'GED1-0042x');
      await reserveDocId(tx, 'legacy');
    });
    expect(await db().select().from(s.idCounters)).toEqual([]);
  });
});

describe('nextWorkflowId (W-n)', () => {
  it('numbers circuits consecutively, after the highest circuit already written', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-300', docId: 'PRO-QUA-0001', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['quality'] });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await db().transaction((tx) => nextWorkflowId(tx)));
    expect(ids).toEqual(['W-301', 'W-302', 'W-303']);
  });

  it('hands out distinct circuit numbers to interleaved transactions (serialized by PGlite)', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => db().transaction((tx) => nextWorkflowId(tx))));
    expect([...ids].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))).toEqual(['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-6', 'W-7', 'W-8']);
  });
});

describe('submitChange (ECR-AAAA-NNN, D-16)', () => {
  const docs = ['PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003'];
  const request = (docId: string) => db().transaction((tx) => submitChange(tx, { kind: 'modification', docId, requesterId: 'writer', reason: 'r', description: '' }));

  it('numbers requests consecutively within the year, on three digits', async () => {
    for (const id of docs) await addDoc(db(), { id });
    expect([await request(docs[0]), await request(docs[1]), await request(docs[2])]).toEqual(['ECR-2026-001', 'ECR-2026-002', 'ECR-2026-003']);
  });

  it('starts after the highest reference of the year already mirrored, and again from 1 the next year', async () => {
    for (const id of docs) await addDoc(db(), { id });
    await db().insert(s.changeRequests).values([
      { id: 'ECR-2026-014', kind: 'modification', docId: docs[0], requesterId: 'writer', reason: 'r', status: 'rejected', createdAt: '2026-09-01 10:00:00' },
      { id: 'ECR-2025-090', kind: 'modification', docId: docs[0], requesterId: 'writer', reason: 'r', status: 'rejected', createdAt: '2025-09-01 10:00:00' },
    ]);
    expect(await request(docs[1])).toBe('ECR-2026-015');
    setClock('2027-01-04T08:00:00Z');
    expect(await request(docs[2])).toBe('ECR-2027-001');
  });

  it('takes the year of the Paris date: 31 December 23:30 UTC is already the next year in Paris', async () => {
    await addDoc(db(), { id: docs[0] });
    setClock('2026-12-31T23:30:00Z');
    expect(await request(docs[0])).toBe('ECR-2027-001');
  });

  it('hands out distinct references to interleaved requests (serialized by PGlite)', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => db().transaction((tx) => nextNumber(tx, 'ecr:2026', 'ECR-2026-', sql`select ${s.changeRequests.id} from ${s.changeRequests}`))));
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
