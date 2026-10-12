import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { openDb, schema as s, type Db } from '@/db';
import type { Conf, DocState, RevStatus } from '@/db/schema';
import { refreshHeadline } from '@/lib/lifecycle';
import { insertFixtures, TYPES, type Person } from './fixtures';

// In-memory database for the integration tests: the schema of drizzle/ and the append-only journal (openDb in
// src/db/index.ts), plus the reference data of fixtures.ts. Opening PGlite takes seconds, so each test file opens one
// database, and every test starts from it emptied and filled with the fixtures again (a few milliseconds).

let opened: Promise<Db> | null = null;
let current: Db | null = null;

/**
 * Empties every table of the application, the journal included, and writes the fixtures again. The journal refuses
 * TRUNCATE (src/db/index.ts): session_replication_role = replica skips its trigger for this one transaction (SET
 * LOCAL), and the trigger itself stays in place for the test.
 */
async function reset(db: Db): Promise<void> {
  const { rows } = await db.$client.query<{ name: string }>(`select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`);
  await db.$client.transaction(async (tx) => {
    await tx.exec(`set local session_replication_role = replica; truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade;`);
  });
  await insertFixtures(db);
}

/** The test file's database, emptied and filled with the fixtures: migrated, with the journal trigger, no document. */
async function freshDb(): Promise<Db> {
  opened ??= openDb();
  const db = await opened;
  await reset(db);
  return db;
}

/**
 * Gives every test of the file a fresh database (freshDb), returned by the getter and by currentDb(), which a test
 * file that mocks getDb() hands to the code under test. Closed after the last test of the file.
 */
export function setupDb(): () => Db {
  beforeEach(async () => {
    current = await freshDb();
  });
  afterEach(() => {
    current = null;
  });
  afterAll(async () => {
    if (opened) await (await opened).$client.close();
    opened = null;
  });
  return currentDb;
}

/** The database of the running test, for a mocked getDb(). */
export function currentDb(): Db {
  if (!current) throw new Error('no test database: call setupDb() at the top of the test file');
  return current;
}

// ── Clock ───────────────────────────────────────────────────────────────

/**
 * Freezes the clock (Date only: PGlite's timers keep running) at `instant`. Paris is UTC+2 in October: 08:00 UTC is
 * 10:00 in Paris, the same day for todayIso().
 */
export function setClock(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
}

/** Freezes the clock on 10 October 2026 for every test of the file. */
export function fixClock(instant = '2026-10-10T08:00:00Z'): void {
  beforeEach(() => setClock(instant));
  afterEach(() => {
    vi.useRealTimers();
  });
}

// ── Documents ───────────────────────────────────────────────────────────

export type RevSpec = {
  letter: string;
  status: RevStatus;
  modifierId?: Person | null;
  effectiveAt?: string | null;
  changeRef?: string | null;
  /** Authors of the working versions n° 1, 2… (none by default). */
  versions?: Person[];
};

export type DocSpec = {
  id: string;
  typeCode?: string;
  department?: string;
  ownerId?: Person;
  conf?: Conf;
  state?: DocState;
  legalHold?: boolean;
  projectCode?: string | null;
  aliases?: string[];
  /** Revisions in order; revision A in force with one working version by the owner by default. */
  revisions?: RevSpec[];
};

/**
 * Writes a document with its revisions and working versions, as the application would have left them (headline status
 * and revision letters through refreshHeadline). Dates are fixed in September 2026.
 */
export async function addDoc(db: Db, spec: DocSpec) {
  const owner = spec.ownerId ?? 'owner';
  const revisions = spec.revisions ?? [{ letter: 'A', status: 'in_force', versions: [owner] }];
  const typeCode = spec.typeCode ?? 'PRO';
  const projectCode = spec.projectCode ?? null;
  await db.transaction(async (tx) => {
    await tx.insert(s.documents).values({
      id: spec.id, aliases: spec.aliases ?? [], title: spec.id, origin: 'interne', attachment: projectCode ? 'project' : 'none', projectCode,
      family: TYPES.find((t) => t.code === typeCode)?.family ?? 'qualite', typeCode, department: spec.department ?? 'QUA', ownerId: owner, authorId: owner,
      conf: spec.conf ?? 'interne', keywords: [], state: spec.state ?? 'active', status: 'draft', legalHold: spec.legalHold ?? false,
      issuedAt: revisions.some((r) => r.status === 'in_force' || r.status === 'superseded') ? '2026-09-10' : null,
      obsoleteAt: spec.state === 'obsolete' ? '2026-09-20' : null, archivedAt: spec.state === 'archived' ? '2026-09-25' : null,
      retentionYears: 10, retentionTrigger: 'superseded', retentionDisposition: 'destroy', createdAt: '2026-09-01', modifiedAt: '2026-09-01',
    });
    for (const r of revisions) {
      const final = r.status === 'in_force' || r.status === 'superseded' || r.status === 'approved';
      const [rev] = await tx.insert(s.revisions).values({
        docId: spec.id, letter: r.letter, status: r.status, modifierId: r.modifierId ?? null, changeRef: r.changeRef ?? null, effectiveAt: r.effectiveAt ?? null,
        approvedAt: final ? '2026-09-10' : null, inForceAt: r.status === 'in_force' || r.status === 'superseded' ? '2026-09-10' : null,
        supersededAt: r.status === 'superseded' ? '2026-09-15' : null, createdAt: '2026-09-01',
      }).returning();
      if (r.versions?.length) {
        await tx.insert(s.workingVersions).values(r.versions.map((authorId, i) => ({ revisionId: rev.id, docId: spec.id, n: i + 1, comment: `v${i + 1}`, authorId, date: '2026-09-05' })));
      }
    }
    await refreshHeadline(tx, spec.id);
  });
  return getDoc(db, spec.id);
}

/**
 * A circuit on a revision, running unless it has an `outcome`: step 0 is the author's, then one step per approver;
 * `step` is the current one.
 */
export async function addWorkflow(db: Db, w: { id: string; docId: string; letter: string; requesterId: Person; author: Person; approvers: Person[]; step?: number; outcome?: 'approved' | 'rejected' | null }) {
  const rev = await getRevision(db, w.docId, w.letter);
  await db.insert(s.workflows).values({ id: w.id, docId: w.docId, revisionId: rev.id, requesterId: w.requesterId, due: '2026-10-20', step: w.step ?? 1, outcome: w.outcome ?? null, createdAt: '2026-10-01' });
  await db.insert(s.workflowSteps).values([w.author, ...w.approvers].map((assigneeId, idx) => ({ workflowId: w.id, idx, name: `step ${idx}`, assigneeId, functionKey: idx ? 'resp_qualite' : null })));
}

export async function getDoc(db: Db, id: string) {
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, id));
  if (!d) throw new Error(`no document ${id}`);
  return d;
}

/**
 * What the record's dialogs send back of the view they were opened from (lib/concurrency.ts), read now: the version of
 * the document (metadata, readers), and the last working version of the revision being drafted (upload).
 */
export async function viewOf(db: Db, id: string) {
  const d = await getDoc(db, id);
  const open = (await getRevisions(db, id)).findLast((r) => r.status === 'draft' || r.status === 'in_review' || r.status === 'approved');
  const versions = open ? await db.select({ n: s.workingVersions.n }).from(s.workingVersions).where(eq(s.workingVersions.revisionId, open.id)) : [];
  return {
    version: String(d.version),
    baseRevision: open ? String(open.id) : '',
    baseVersion: String(Math.max(0, ...versions.map((v) => v.n))),
  };
}

/** The last working version the approval request dialog shows (requestValidation's `base`), read now; null without one. */
export async function baseOf(db: Db, id: string) {
  const { baseRevision, baseVersion } = await viewOf(db, id);
  return baseRevision ? { revisionId: Number(baseRevision), n: Number(baseVersion) } : null;
}

/** Revisions of a document, oldest first. */
export async function getRevisions(db: Db, docId: string) {
  return db.select().from(s.revisions).where(eq(s.revisions.docId, docId)).orderBy(asc(s.revisions.id));
}

export async function getRevision(db: Db, docId: string, letter: string) {
  const rev = (await getRevisions(db, docId)).find((r) => r.letter === letter);
  if (!rev) throw new Error(`no revision ${letter} of ${docId}`);
  return rev;
}

/** Letter → status of every revision of the document. */
export async function revisionStatuses(db: Db, docId: string): Promise<Record<string, RevStatus>> {
  return Object.fromEntries((await getRevisions(db, docId)).map((r) => [r.letter, r.status]));
}

export async function getChange(db: Db, id: string) {
  const [c] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!c) throw new Error(`no change request ${id}`);
  return c;
}

/** Journal entries of a document, in the order they were written. */
export async function journalOf(db: Db, docId: string) {
  return db.select().from(s.auditLog).where(eq(s.auditLog.docId, docId)).orderBy(asc(s.auditLog.id));
}
