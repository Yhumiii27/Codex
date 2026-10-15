import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { getCtx } from '@/lib/context';
import { AUDIT_ID_MAX, AUDIT_PAGE_SIZE, auditPage, listAudit, type AuditFilter } from '@/lib/queries';
import { addDoc, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Journal tab of the administration (point 50 of docs/reste-a-faire.md): filtered and paged by the database
// (lib/queries.ts auditPage), newest first, a keyset on the time and the ID. Whoever reads it gets the entries
// auditForReader lets them read, as on the other journal screens (D-14): the others take no room on a page.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

type Entry = typeof s.auditLog.$inferInsert;
/** `n` entries about `docId`, five per instant (ties the keyset must keep apart), an hour apart from 1 October. */
function entries(n: number, docId: string, more: Partial<Entry> = {}): Entry[] {
  return Array.from({ length: n }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 1, 0, 0) + Math.floor(i / 5) * 3_600_000).toISOString(), userId: 'manager', action: 'edit', docId, detail: `#${i}`, ...more,
  }));
}

async function as(who: Person) {
  actAs(who);
  return getCtx();
}

/** Every page, from the newest, following the link to older entries; then back, following the link to newer ones. */
async function walk(who: Person, f: AuditFilter = {}) {
  const ctx = await as(who);
  const forth: number[][] = [];
  let page = await auditPage(ctx, f);
  expect(page.newer).toBeNull();
  forth.push(page.rows.map((r) => r.id));
  while (page.older != null) {
    page = await auditPage(ctx, f, { before: page.older });
    forth.push(page.rows.map((r) => r.id));
  }
  const back: number[][] = [forth[forth.length - 1]];
  while (page.newer != null) {
    page = await auditPage(ctx, f, { after: page.newer });
    back.unshift(page.rows.map((r) => r.id));
  }
  return { forth, back };
}

describe('Journal tab: pages', () => {
  it('pages the whole journal, newest first, never an entry twice nor missed, and back again', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().insert(s.auditLog).values(entries(2 * AUDIT_PAGE_SIZE + 37, 'PRO-QUA-0001'));
    const { forth, back } = await walk('manager');
    expect(forth.map((p) => p.length)).toEqual([AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE, 37]);
    // The same entries, in the order of the other journal screens.
    expect(forth.flat()).toEqual((await listAudit(await as('manager'), { limit: 10_000 })).map((a) => a.id));
    expect(back).toEqual(forth);
  });

  it('gives no room on a page to entries the reader may not read (D-14)', async () => {
    // An administrator who is not a records manager (the matrix lets the validator role administer, here).
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft' }] });
    // Work on a draft outside the reader's drafting circle: hidden; then readable entries, older.
    await db().insert(s.auditLog).values([
      ...entries(AUDIT_PAGE_SIZE + 20, 'PRO-QUA-0002', { action: 'working', at: '2026-10-08T10:00:00Z' }),
      ...entries(30, 'PRO-QUA-0001'),
    ]);
    const head = await walk('head');
    expect(head.forth.map((p) => p.length)).toEqual([30]);
    expect((await walk('manager')).forth.map((p) => p.length)).toEqual([AUDIT_PAGE_SIZE, 50]);
  });

  it('reads the journal batch after batch (500 entries each) until a page is full, both ways', async () => {
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft' }] });
    // Newest first: 520 hidden entries, 5 readable ones, 500 hidden, then 130 readable: the first readable entries lie
    // in the second batch, the next ones beyond the third.
    await db().insert(s.auditLog).values([
      ...entries(130, 'PRO-QUA-0001'),
      ...entries(500, 'PRO-QUA-0002', { action: 'working', at: '2026-10-08T10:00:00Z' }),
      ...entries(5, 'PRO-QUA-0001', { at: '2026-10-08T12:00:00Z' }),
      ...entries(520, 'PRO-QUA-0002', { action: 'working', at: '2026-10-09T10:00:00Z' }),
    ]);
    const head = await walk('head');
    expect(head.forth.map((p) => p.length)).toEqual([AUDIT_PAGE_SIZE, 35]);
    expect(head.back).toEqual(head.forth);
    expect(head.forth.flat()).toEqual((await listAudit(await as('head'), { limit: 10_000 })).map((a) => a.id));
    const manager = await walk('manager');
    expect(manager.forth.map((p) => p.length)).toEqual([...Array(11).fill(AUDIT_PAGE_SIZE), 55]);
    expect(manager.back).toEqual(manager.forth);
  });
});

describe('Journal tab: filters', () => {
  async function journal() {
    await addDoc(db(), { id: 'PRO-QUA-0001', aliases: ['OLD-QUA-0001'] });
    // Never in force, reclassified: only its drafting circle reads it; its former ID shares nothing with the current one.
    await addDoc(db(), { id: 'PRO-QUA-0002', ownerId: 'writer', aliases: ['LEG-77'], revisions: [{ letter: 'A', status: 'draft' }] });
    await db().insert(s.auditLog).values([
      { at: '2026-10-02T08:00:00Z', userId: 'owner', action: 'edit', docId: 'OLD-QUA-0001' },
      { at: '2026-10-04T22:30:00Z', userId: 'manager', action: 'hold', docId: 'PRO-QUA-0001' }, // 5 October in Paris
      { at: '2026-10-05T22:30:00Z', userId: 'manager', action: 'edit', docId: 'PRO-QUA-0001' }, // 6 October in Paris
      { at: '2026-10-03T08:00:00Z', userId: 'writer', action: 'edit', docId: 'LEG-77' },
      { at: '2026-10-03T09:00:00Z', userId: 'manager', action: 'type', targetKind: 'type', targetId: 'PRO' },
    ]);
  }
  const actions = async (who: Person, f: AuditFilter) => (await auditPage(await as(who), f)).rows.map((r) => `${r.ref.split(' ')[0]} ${r.action}`);

  it('by person, action, piece of an ID or of a target (case ignored), and days in Paris time', async () => {
    await journal();
    expect(await actions('manager', { who: 'owner' })).toEqual(['OLD-QUA-0001 edit']);
    expect(await actions('manager', { action: 'hold' })).toEqual(['PRO-QUA-0001 hold']);
    // The current ID finds the entries written under the former ones; a target holds a piece too.
    expect(await actions('manager', { doc: 'qua-0001' })).toEqual(['PRO-QUA-0001 edit', 'PRO-QUA-0001 hold', 'OLD-QUA-0001 edit']);
    expect(await actions('manager', { doc: 'pro-qua-0002' })).toEqual(['LEG-77 edit']);
    expect(await actions('manager', { doc: 'pro', action: 'type' })).toEqual(['Type type']);
    expect(await actions('manager', { from: '2026-10-05', to: '2026-10-05' })).toEqual(['PRO-QUA-0001 hold']);
    expect(await actions('manager', { from: '2026-10-06' })).toEqual(['PRO-QUA-0001 edit']);
    expect(await actions('manager', { to: '2026-10-02' })).toEqual(['OLD-QUA-0001 edit']);
    expect(await actions('manager', { doc: '%' })).toEqual([]);
    expect(await actions('manager', { doc: 'qua\0' })).toEqual([]);
  });

  it('takes every day a date field accepts, from 0001 to 9999, and ignores a cursor no entry can have', async () => {
    await journal();
    const every = await actions('manager', {});
    expect(every).toHaveLength(5);
    expect(await actions('manager', { from: '0001-01-01' })).toEqual(every);
    expect(await actions('manager', { to: '9999-12-31' })).toEqual(every);
    expect(await actions('manager', { from: '0001-01-01', to: '9999-12-31' })).toEqual(every);
    expect(await actions('manager', { to: '0001-01-01' })).toEqual([]);
    expect(await actions('manager', { from: '9999-12-31' })).toEqual([]);
    // Not a day: no bound.
    expect(await actions('manager', { from: '2026-02-30', to: 'demain' })).toEqual(every);
    const ctx = await as('manager');
    for (const cursor of [9_999_999_999, AUDIT_ID_MAX, AUDIT_ID_MAX + 1, 0, -1, 1.5]) {
      for (const at of [{ before: cursor }, { after: cursor }]) {
        expect((await auditPage(ctx, {}, at)).rows.map((r) => `${r.ref.split(' ')[0]} ${r.action}`), JSON.stringify(at)).toEqual(every);
      }
    }
  });

  it('never follows the former IDs of a document the reader may not read: its current ID would tell its reclassification', async () => {
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    await journal();
    // The entry itself stays in the journal, under the ID of its time, without its detail (auditForReader).
    expect(await actions('head', {})).toContain('LEG-77 edit');
    expect(await actions('head', { doc: 'pro-qua-0002' })).toEqual([]);
    expect(await actions('head', { doc: 'leg-77' })).toEqual(['LEG-77 edit']);
  });
});
