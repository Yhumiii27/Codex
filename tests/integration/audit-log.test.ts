import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema as s } from '@/db';
import { audit } from '@/lib/lifecycle';
import { addDoc, fixClock, journalOf, setupDb } from '../support/db';

// The journal is append-only (step 6, docs/decisions.md "Journal d'audit"): the database refuses UPDATE, DELETE and
// TRUNCATE on audit_log, whoever issues them, and accepts entries about a document or about a target without one.

const db = setupDb();
fixClock();

const ID = 'PRO-QUA-0001';

/** Two journal entries about the document. */
async function withEntries() {
  await addDoc(db(), { id: ID });
  await db().transaction(async (tx) => {
    await audit(tx, 'owner', 'edit', ID, 'one');
    await audit(tx, 'manager', 'hold', ID, 'two');
  });
  return journalOf(db(), ID);
}

/** The Postgres error behind a refused statement (drizzle wraps it, the driver's message is in `cause`). */
async function refusal(statement: Promise<unknown>): Promise<string> {
  try {
    await statement;
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? (err as Error).message;
  }
  throw new Error('statement was accepted');
}

describe('append-only journal (step 6)', () => {
  it('refuses UPDATE', async () => {
    const before = await withEntries();
    expect(await refusal(db().update(s.auditLog).set({ detail: 'rewritten' }).where(eq(s.auditLog.id, before[0].id)))).toMatch(/audit_log is append-only: UPDATE refused/);
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('refuses DELETE', async () => {
    const before = await withEntries();
    expect(await refusal(db().delete(s.auditLog).where(eq(s.auditLog.docId, ID)))).toMatch(/audit_log is append-only: DELETE refused/);
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('refuses TRUNCATE', async () => {
    const before = await withEntries();
    expect(await refusal(db().execute(sql`truncate audit_log`))).toMatch(/audit_log is append-only: TRUNCATE refused/);
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('refuses a change even when it touches no row (statement-level trigger)', async () => {
    await withEntries();
    expect(await refusal(db().update(s.auditLog).set({ detail: 'x' }).where(sql`false`))).toMatch(/UPDATE refused/);
    expect(await refusal(db().delete(s.auditLog).where(sql`false`))).toMatch(/DELETE refused/);
  });

  it('rolls back the whole transaction that tried to rewrite the journal', async () => {
    const before = await withEntries();
    await expect(db().transaction(async (tx) => {
      await audit(tx, 'owner', 'edit', ID, 'three');
      await tx.update(s.auditLog).set({ detail: 'rewritten' }).where(eq(s.auditLog.id, before[0].id));
    })).rejects.toThrow();
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('lets a document change its ID (reclassification) without touching the entries written under the former one', async () => {
    const before = await withEntries();
    await db().update(s.documents).set({ id: 'PRO-ING-0001', aliases: [ID] }).where(eq(s.documents.id, ID));
    expect(await journalOf(db(), ID)).toEqual(before);
  });
});

describe('entries with or without a document (step 6)', () => {
  it('stamps an entry with the UTC instant, its author, its revision and its structured data', async () => {
    await addDoc(db(), { id: ID });
    await db().transaction((tx) => audit(tx, 'owner', 'edit', ID, 'A', 7, { changes: [{ field: 'title', before: 'x', after: 'y' }] }));
    const [e] = await journalOf(db(), ID);
    expect(e).toMatchObject({ userId: 'owner', action: 'edit', docId: ID, targetKind: null, targetId: null, detail: 'A', revisionId: 7, data: { changes: [{ field: 'title', before: 'x', after: 'y' }] } });
    expect(new Date(e.at).toISOString()).toBe('2026-10-10T08:00:00.000Z');
  });

  it('accepts entries about a target without document: rights, organisation, functions, register, exports', async () => {
    await db().transaction(async (tx) => {
      await audit(tx, 'manager', 'perm', { kind: 'permission', id: 'contributeur:upload' }, '', null, { changes: [{ field: 'granted', before: true, after: false }] });
      await audit(tx, 'manager', 'org_add', { kind: 'department', id: 'JUR' });
      await audit(tx, 'manager', 'holder_add', { kind: 'function', id: 'resp_qualite' });
      await audit(tx, 'manager', 'type', { kind: 'type', id: 'PRO' });
      await audit(tx, 'auditor', 'export', { kind: 'export', id: 'audit' }, '', null, { export: { rows: 12 } });
    });
    const rows = await db().select().from(s.auditLog).orderBy(s.auditLog.id);
    expect(rows.map((r) => [r.docId, r.targetKind, r.targetId])).toEqual([
      [null, 'permission', 'contributeur:upload'],
      [null, 'department', 'JUR'],
      [null, 'function', 'resp_qualite'],
      [null, 'type', 'PRO'],
      [null, 'export', 'audit'],
    ]);
  });

  it('refuses an entry about nothing: neither a document nor a complete target', async () => {
    await expect(db().insert(s.auditLog).values({ at: '2026-10-10T08:00:00Z', userId: 'manager', action: 'edit' })).rejects.toThrow();
    await expect(db().insert(s.auditLog).values({ at: '2026-10-10T08:00:00Z', userId: 'manager', action: 'perm', targetKind: 'permission' })).rejects.toThrow();
  });
});
