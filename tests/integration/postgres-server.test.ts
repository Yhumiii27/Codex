import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { PgServerClient } from '@/db/sql-client';
import { backUpNow } from '@/lib/backup';
import { nextDocId, nextWorkflowId } from '@/lib/codification';
import type { IdInput } from '@/lib/codes';
import { importDocument } from '@/lib/importer';
import { fixClock, setupDb } from '../support/db';

// What only a PostgreSQL server shows (point 51 of docs/reste-a-faire.md, docs/postgres.md), run by npm run test:pg
// (CODEX_TEST_DATABASE_URL), skipped on PGlite: races between connections, which PGlite cannot have (its one connection
// runs the transactions one after the other): each check holds transactions open at the same time on distinct
// connections of the pool, and says what a second one sees while the first has not committed. And the backup from
// Administration, refused on a server (Codex's archives copy PGlite's data directory).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));

const db = setupDb();
fixClock();

const server = !!process.env.CODEX_TEST_DATABASE_URL?.trim();
const procedure: IdInput = { typeCode: 'PRO', attachment: 'none', department: 'QUA' };

/** A promise and the function that settles it: lets a test hold a transaction open until it says so. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((resolve) => (open = resolve));
  return { p, open };
}

/** Whether `p` is still pending after `ms` milliseconds. */
async function pendingAfter(p: Promise<unknown>, ms: number): Promise<boolean> {
  const tick = Symbol('pending');
  return (await Promise.race([p.then(() => null, () => null), new Promise((r) => setTimeout(() => r(tick), ms))])) === tick;
}

/** A procedure written with its drawn ID, in one transaction, as createDocument does. */
const create = () =>
  db().transaction(async (tx) => {
    const id = await nextDocId(tx, procedure);
    await tx.insert(s.documents).values({
      id, title: id, origin: 'interne', attachment: 'none', family: 'qualite', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne', keywords: [],
      status: 'draft', revWorking: 'A', retentionTrigger: 'superseded', retentionDisposition: 'destroy', createdAt: '2026-10-10', modifiedAt: '2026-10-10',
    });
    return id;
  });

describe.skipIf(!server)('on a PostgreSQL server, between connections', () => {
  it('runs on a pool of server connections', () => {
    expect(db().$client).toBeInstanceOf(PgServerClient);
  });

  it('makes a second drawing of the same counter wait for the first transaction, then gives it the next number', async () => {
    const hold = gate();
    const drawn = gate();
    const first = db().transaction(async (tx) => {
      const id = await nextDocId(tx, procedure);
      drawn.open();
      await hold.p;
      return id;
    });
    await drawn.p;
    const second = db().transaction((tx) => nextDocId(tx, procedure));
    try {
      // The counter row is locked by the first transaction: the second waits for it rather than reading the same number.
      expect(await pendingAfter(second, 300)).toBe(true);
    } finally {
      hold.open();
    }
    expect(await first).toBe('PRO-QUA-0001');
    expect(await second).toBe('PRO-QUA-0002');
  });

  it('hands the number of a transaction rolled back to the one that waited for it', async () => {
    const hold = gate();
    const drawn = gate();
    const failed = db().transaction(async (tx) => {
      await nextDocId(tx, procedure);
      drawn.open();
      await hold.p;
      throw new Error('rolled back');
    });
    await drawn.p;
    const waiting = db().transaction((tx) => nextDocId(tx, procedure));
    hold.open();
    await expect(failed).rejects.toThrow('rolled back');
    expect(await waiting).toBe('PRO-QUA-0001');
  });

  it('does not make counters of other scopes wait', async () => {
    const hold = gate();
    const drawn = gate();
    const first = db().transaction(async (tx) => {
      const id = await nextDocId(tx, procedure);
      drawn.open();
      await hold.p;
      return id;
    });
    await drawn.p;
    try {
      // Another type and context, and the circuits' counter: their own rows, not locked by the first transaction.
      expect(await db().transaction((tx) => nextDocId(tx, { typeCode: 'COR', attachment: 'none', department: 'QUA' }))).toBe('COR-QUA-0001');
      expect(await db().transaction((tx) => nextWorkflowId(tx))).toBe('W-1');
    } finally {
      hold.open();
    }
    expect(await first).toBe('PRO-QUA-0001');
  });

  it('gives distinct, consecutive IDs to 60 documents created at once on 10 connections', async () => {
    const ids = await Promise.all(Array.from({ length: 60 }, () => create()));
    expect(new Set(ids).size).toBe(60);
    expect([...ids].sort()).toEqual(Array.from({ length: 60 }, (_, i) => `PRO-QUA-${String(i + 1).padStart(4, '0')}`));
  });

  it('would give one ID twice with a maximum read then raised (max + 1), which the counters replace', async () => {
    // What codification.ts did before point 40, on two connections at once: both read the same maximum before either
    // writes, and the second document fails on the primary key once the first commits.
    const hold = gate();
    const read = [gate(), gate()];
    const naive = (k: number) => db().transaction(async (tx) => {
      const { rows } = await tx.execute<{ n: number }>(sql`select coalesce(max(substr(${s.documents.id}, 9)::int), 0) + 1 as n from ${s.documents} where ${s.documents.id} like 'PRO-QUA-%'`);
      read[k].open();
      await hold.p;
      const id = `PRO-QUA-${String(rows[0].n).padStart(4, '0')}`;
      await tx.insert(s.documents).values({
        id, title: id, origin: 'interne', attachment: 'none', family: 'qualite', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: 'interne', keywords: [],
        status: 'draft', revWorking: 'A', retentionTrigger: 'superseded', retentionDisposition: 'destroy', createdAt: '2026-10-10', modifiedAt: '2026-10-10',
      });
      return id;
    });
    const both = [naive(0), naive(1)];
    await Promise.all(read.map((g) => g.p));
    hold.open();
    const out = await Promise.allSettled(both);
    expect(out.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failed = out.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String((failed.reason as { cause?: unknown }).cause ?? failed.reason)).toMatch(/duplicate key/);
  });

  it('runs the imports one at a time (advisory lock): one document for simultaneous imports of a reference', async () => {
    const meta = { legacyRef: 'GED1-PRO-7', title: 'Doc', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' };
    const results = await Promise.all(Array.from({ length: 8 }, () => importDocument(meta, null)));
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'duplicate')).toHaveLength(7);
    expect(await db().select().from(s.documents)).toHaveLength(1);
  });

  it('refuses the backup from Administration: a server is backed up by its own tools', async () => {
    expect(await backUpNow('cbardet')).toBe('server');
  });
});
