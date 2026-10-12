import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { updateMeta } from '@/lib/actions';
import { nextDocId } from '@/lib/codification';
import type { IdInput } from '@/lib/codes';
import { importDocument } from '@/lib/importer';
import { promoteDue } from '@/lib/lifecycle';
import { addDoc, fixClock, getDoc, getRevisions, journalOf, revisionStatuses, setClock, setupDb, viewOf } from '../support/db';
import { actAs } from '../support/session';

// Import of legacy documents for the migration tool (D-21, docs/api.md "Import"), on the identifier rules of D-09 /
// D-10 and step 5: a legacy reference already in Codex's format for the document's type and context becomes its ID and
// raises the counter; any other one stays an alias whose number is never handed out; a replay creates nothing.

// Reclassification runs through the Server Action updateMeta (simulated session, tests/support/session.ts).
vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const procedure: IdInput = { typeCode: 'PRO', attachment: 'none', department: 'QUA' };
const meta = (legacyRef: string, over: Record<string, unknown> = {}) => ({ legacyRef, title: `Doc ${legacyRef}`, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12', ...over });
const next = (d: IdInput = procedure) => db().transaction((tx) => nextDocId(tx, d));

/** A procedure created in Codex: its ID drawn and its record written in one transaction, as createDocument does. */
const createInCodex = () =>
  db().transaction(async (tx) => {
    const id = await nextDocId(tx, procedure);
    await tx.insert(s.documents).values({
      id, title: id, origin: 'interne', attachment: 'none', family: 'qualite', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne', keywords: [],
      status: 'draft', revWorking: 'A', retentionTrigger: 'superseded', retentionDisposition: 'destroy', createdAt: '2026-10-10', modifiedAt: '2026-10-10',
    });
    return id;
  });

describe('importDocument: identifiers (D-09, D-10, step 5)', () => {
  // In the two tests below the scope's counter exists before the import: on its first use a counter starts from the
  // highest ID or alias already written, which would hide an import that forgot to raise it (reserveDocId).
  it('keeps a legacy reference already in Codex format for the type and context as the ID, and raises the counter past it', async () => {
    expect(await next()).toBe('PRO-QUA-0001'); // the PRO-QUA counter, already in use, stands at 1
    expect(await importDocument(meta('PRO-QUA-0042'), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0042', revision: 'C', version: 'C.1', revStatus: 'in_force' });
    expect(await getDoc(db(), 'PRO-QUA-0042')).toMatchObject({ aliases: ['PRO-QUA-0042'], status: 'in_force', revInForce: 'C', issuedAt: '2025-03-12' });
    expect(await next()).toBe('PRO-QUA-0043');
  });

  it('gives the next number to a document whose legacy reference reads another scope, and reserves that number in its own scope', async () => {
    expect(await next()).toBe('PRO-QUA-0001'); // drawn by a document created in Codex
    expect(await next({ ...procedure, department: 'ING' })).toBe('PRO-ING-0001'); // the PRO-ING counter stands at 1
    expect(await importDocument(meta('PRO-ING-0010'), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0002' });
    expect((await getDoc(db(), 'PRO-QUA-0002')).aliases).toEqual(['PRO-ING-0010']);
    // PRO-ING-0010 stays an alias: the PRO-ING counter never hands it out.
    expect(await next({ ...procedure, department: 'ING' })).toBe('PRO-ING-0011');
  });

  it('gives the next number to a legacy reference in another format, and keeps it as an alias', async () => {
    expect(await importDocument(meta('GED1/QUA/42'), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0001' });
    expect((await getDoc(db(), 'PRO-QUA-0001')).aliases).toEqual(['GED1/QUA/42']);
    expect(await next()).toBe('PRO-QUA-0002');
  });

  it('refuses a legacy reference that is the current ID of a document created in Codex, and leaves the counter alone', async () => {
    await addDoc(db(), { id: await next() }); // PRO-QUA-0001
    expect(await importDocument(meta('PRO-QUA-0001'), null)).toEqual({ kind: 'conflict', id: 'PRO-QUA-0001' });
    expect(await db().select().from(s.documents)).toHaveLength(1);
    expect(await next()).toBe('PRO-QUA-0002');
  });

  // docs/api.md: 409 `duplicate` is a legacy reference already imported; `ref_is_codex_id` is the Codex ID of another
  // document "qui n'a pas été importé depuis elle". A former ID kept as alias by a reclassification is such an ID: taken
  // for a replay, the migration tool would record the legacy document as migrated into an unrelated document.
  it('refuses as a Codex ID, not as a replay, a legacy reference equal to the former ID of a reclassified document', async () => {
    await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', aliases: ['PRO-QUA-0005'] });
    expect(await importDocument(meta('PRO-QUA-0005'), null)).toEqual({ kind: 'conflict', id: 'PRO-ING-0001' });
    expect(await getDoc(db(), 'PRO-ING-0001')).toMatchObject({ aliases: ['PRO-QUA-0005'], legacyRef: null });
    expect(await db().select({ id: s.documents.id }).from(s.documents)).toEqual([{ id: 'PRO-ING-0001' }]);
  });
});

describe('importDocument: replays', () => {
  it('answers a replay with the document already created, and creates nothing', async () => {
    const first = await importDocument(meta('GED1-PRO-7'), null);
    expect(first).toMatchObject({ kind: 'created', id: 'PRO-QUA-0001' });
    expect(await importDocument(meta('GED1-PRO-7', { title: 'changed' }), null)).toEqual({ kind: 'duplicate', id: 'PRO-QUA-0001' });
    expect(await db().select().from(s.documents)).toHaveLength(1);
    expect((await journalOf(db(), 'PRO-QUA-0001')).map((e) => [e.userId, e.action])).toEqual([['codex', 'import']]);
  });

  // PGlite runs the transactions below one after the other: these tests check the outcome of interleaved imports, not a
  // race between connections of a Postgres server (see codification.test.ts).
  it('creates one document for interleaved imports of the same reference, the others get the duplicate', async () => {
    const results = await Promise.all([importDocument(meta('GED1-PRO-7'), null), importDocument(meta('GED1-PRO-7'), null), importDocument(meta('GED1-PRO-7'), null)]);
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'duplicate')).toEqual([{ kind: 'duplicate', id: 'PRO-QUA-0001' }, { kind: 'duplicate', id: 'PRO-QUA-0001' }]);
    expect(await db().select().from(s.documents)).toHaveLength(1);
  });

  it('never gives one ID twice to interleaved imports and documents created at the same time', async () => {
    const created = await Promise.all([
      importDocument(meta('L-1'), null),
      createInCodex(),
      importDocument(meta('PRO-QUA-0003'), null),
      importDocument(meta('L-2'), null),
      createInCodex(),
    ]);
    const ids = created.flatMap((r) => (typeof r === 'string' ? [r] : r.kind === 'created' ? [r.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^PRO-QUA-\d{4}$/.test(id))).toBe(true);
    // The Codex-format reference became its document's ID if it was still free when its import ran; otherwise it is
    // refused as another document's ID (docs/api.md, 409 ref_is_codex_id), never given to a second document.
    const explicit = created[2];
    expect(typeof explicit !== 'string' && (explicit.kind === 'conflict' || (explicit.kind === 'created' && explicit.id === 'PRO-QUA-0003'))).toBe(true);
    const docs = await db().select({ id: s.documents.id }).from(s.documents);
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
  });
});

// An imported document never approved is re-codified by a reclassification (D-10): its aliases then hold the legacy
// reference it was imported from and the ID the import gave it. Only the first one is a replay.
describe('importDocument: replays after a reclassification (D-10)', () => {
  /** The owner moves a document to the ING department through the metadata form (Server Action updateMeta). */
  async function moveToIng(id: string) {
    actAs('owner');
    const fd = new FormData();
    fd.set('docId', id);
    fd.set('version', (await viewOf(db(), id)).version);
    fd.set('department', 'ING');
    return updateMeta(fd);
  }
  const draft = (legacyRef: string) => meta(legacyRef, { status: 'draft', revision: 'A' });

  it('answers a replay with the document under its new ID, and refuses as a Codex ID the ID the import gave it', async () => {
    expect(await importDocument(draft('GED1-PRO-7'), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0001' });
    expect(await moveToIng('PRO-QUA-0001')).toMatchObject({ ok: true });
    expect(await getDoc(db(), 'PRO-ING-0001')).toMatchObject({ aliases: ['GED1-PRO-7', 'PRO-QUA-0001'], legacyRef: 'GED1-PRO-7' });
    expect(await importDocument(draft('GED1-PRO-7'), null)).toEqual({ kind: 'duplicate', id: 'PRO-ING-0001' });
    expect(await importDocument(draft('PRO-QUA-0001'), null)).toEqual({ kind: 'conflict', id: 'PRO-ING-0001' });
    expect(await db().select({ id: s.documents.id }).from(s.documents)).toEqual([{ id: 'PRO-ING-0001' }]);
  });

  it('answers a replay of a legacy reference in Codex format that became the ID, even once it is a former ID', async () => {
    expect(await importDocument(draft('PRO-QUA-0042'), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0042' });
    expect(await moveToIng('PRO-QUA-0042')).toMatchObject({ ok: true });
    expect(await importDocument(draft('PRO-QUA-0042'), null)).toEqual({ kind: 'duplicate', id: 'PRO-ING-0001' });
    expect(await db().select({ id: s.documents.id }).from(s.documents)).toEqual([{ id: 'PRO-ING-0001' }]);
  });
});

describe('importDocument: revision (D-11)', () => {
  it('leaves a revision whose date is still to come « Approuvé », and puts it in force on that date', async () => {
    expect(await importDocument(meta('L-1', { inForceAt: '2026-10-15' }), null)).toMatchObject({ kind: 'created', id: 'PRO-QUA-0001', revStatus: 'approved' });
    expect(await revisionStatuses(db(), 'PRO-QUA-0001')).toEqual({ C: 'approved' });
    setClock('2026-10-15T08:00:00Z');
    await promoteDue(db());
    expect((await getRevisions(db(), 'PRO-QUA-0001'))[0]).toMatchObject({ letter: 'C', status: 'in_force', inForceAt: '2026-10-15' });
  });

  it('imports a draft without file as a draft waiting for its first working version', async () => {
    expect(await importDocument(meta('L-1', { status: 'draft', revision: 'A' }), null)).toMatchObject({ kind: 'created', revStatus: 'draft', version: null });
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ status: 'draft', revInForce: null, revWorking: 'A' });
    expect(await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'))).toEqual([]);
  });
});
