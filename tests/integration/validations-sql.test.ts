import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema as s, type Db } from '@/db';
import { seed } from '@/db/seed';
import { COOKIE_LANG, getCtx, type Ctx } from '@/lib/context';
import { SIM_ROLES, type SimRole } from '@/lib/i18n';
import { listWorkflows, validationsPage, WORKFLOW_FILTERS, type WorkflowFilter, type WorkflowView } from '@/lib/queries';
import { addWorkflow, fixClock, setupDb, useDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, cookieStore } from '../support/session';
import { PERSONS, variedDocuments } from '../support/varied';

// /validations filtered, counted and paged by the database (lib/queries.ts validationsPage, points 47 and 50 of
// docs/reste-a-faire.md) against what the page computed from every circuit (listWorkflows, kept as the reference):
// the same counts, the same circuits in the same order page after page, the same circuit shown, and the same answer
// for a circuit asked for that is hidden (D-14), for every person under every simulated role.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

/** Hidden circuits asked for, by whether the person took part: both must be met. */
const met = { tookPart: 0, other: 0, paged: 0 };

const PICK: Record<WorkflowFilter, (w: WorkflowView) => boolean> = { mine: (w) => w.mine, requested: (w) => w.requested, active: (w) => !w.done, done: (w) => w.done };

/** The list of a filter as the page made it from listWorkflows. */
function refList(all: WorkflowView[], f: WorkflowFilter): WorkflowView[] {
  const list = all.filter(PICK[f]);
  if (f === 'done') list.reverse();
  if (f === 'requested') list.sort((a, b) => Number(a.done) - Number(b.done));
  return list;
}

/** Compares, for the person `ctx` is about, every filter page by page (`size` circuits a page) and every circuit asked for. */
async function compare(ctx: Ctx, who: string, size: number): Promise<number> {
  const every = await listWorkflows(ctx);
  const all = every.filter((w) => w.visible);
  const ids = (xs: WorkflowView[]) => xs.map((w) => w.id);
  const landing = WORKFLOW_FILTERS.find((f) => all.some(PICK[f])) ?? 'mine';
  const first = await validationsPage(ctx, { size });
  expect(first.total, who).toBe(all.length);
  for (const f of WORKFLOW_FILTERS) expect(first.counts[f], `${who} ${f}`).toBe(all.filter(PICK[f]).length);
  expect(first.filter, who).toBe(landing);
  expect(first.selected?.id ?? null, who).toBe((refList(all, landing)[0] ?? all[0])?.id ?? null);
  for (const f of WORKFLOW_FILTERS) {
    const ref = refList(all, f);
    const got: WorkflowView[] = [];
    const pages = Math.max(1, Math.ceil(ref.length / size));
    if (pages > 1) met.paged++;
    for (let page = 1; page <= pages; page++) {
      const p = await validationsPage(ctx, { filter: f, page, size });
      expect([p.page, p.pages], `${who} ${f} ${page}`).toEqual([page, pages]);
      got.push(...p.list);
      if (page === 1) expect(p.selected?.id ?? null, `${who} ${f}`).toBe((ref[0] ?? all[0])?.id ?? null);
    }
    // The same views, item for item (not only the IDs).
    expect(got, `${who} ${f}`).toEqual(ref);
    // A page past the last one shows the last one.
    expect((await validationsPage(ctx, { filter: f, page: pages + 3, size })).page, `${who} ${f}`).toBe(pages);
  }
  // A circuit asked for: its filter (without one in the URL) and the page that holds it; hidden ones as the page said.
  // One circuit in two (alternating with the person, so that each is asked for by someone): the whole set is slow.
  for (const w of every.filter((_, i) => (i + who.length) % 2 === 0)) {
    const p = await validationsPage(ctx, { r: w.id, size });
    if (w.visible) {
      const f: WorkflowFilter = PICK.mine(w) ? 'mine' : w.requested ? 'requested' : w.done ? 'done' : 'active';
      expect([p.filter, p.selected?.id, p.hidden], `${who} ${w.id}`).toEqual([f, w.id, undefined]);
      const at = ids(refList(all, f)).indexOf(w.id);
      expect(p.page, `${who} ${w.id}`).toBe(Math.floor(at / size) + 1);
      expect(ids(p.list), `${who} ${w.id}`).toContain(w.id);
    } else {
      const tookPart = w.requested || w.steps.some((st) => st.assigneeId === ctx.user.id);
      expect(p.hidden, `${who} ${w.id}`).toEqual({ tookPart });
      met[tookPart ? 'tookPart' : 'other']++;
    }
  }
  expect((await validationsPage(ctx, { r: 'W-NONE', size })).hidden, who).toBeUndefined();
  return all.length;
}

async function asViewer(who: string, role: SimRole | undefined) {
  actAs(who as Person, role);
  (await cookieStore()).set(COOKIE_LANG, 'fr');
  return getCtx();
}

describe('on the demo seed', () => {
  let db: Db;
  beforeAll(async () => {
    db = await openDb();
    await seed(db);
    useDb(db);
  }, 60_000);
  afterAll(async () => {
    useDb(null);
    await db.$client.close();
  });
  fixClock('2026-10-12T08:00:00Z');

  it('for every person under their role and some under another', { timeout: 120_000 }, async () => {
    const users = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.isSystem, false));
    let seen = 0;
    for (const { id } of users) seen += await compare(await asViewer(id, undefined), id, 4);
    for (const [id, role] of [['cbardet', 'gestionnaire'], ['jwagner', 'auditeur'], ['gcomte', 'validateur'], ['jholt', 'collaborateur']] as const) {
      seen += await compare(await asViewer(id, role), `${id} (${role})`, 3);
    }
    expect(seen).toBeGreaterThan(20);
  });
});

describe('on varied documents', () => {
  const db = setupDb();
  fixClock('2026-10-10T08:00:00Z');

  it('for every person under every role, pages of 3 (and of 50 for some)', { timeout: 120_000 }, async () => {
    await db().insert(s.functionHolders).values({ functionKey: 'chef_projet', scopeValue: 'HLT-026', userId: 'engineer' });
    const ids = await variedDocuments(db(), 2041, 45);
    // Circuits on the same due date (ordered by ID), recalled ones, one past its last step without an outcome.
    await addWorkflow(db(), { id: 'W-X1', docId: ids[0], letter: 'A', requesterId: 'writer', author: 'writer', approvers: ['head'], step: 2, outcome: null });
    await addWorkflow(db(), { id: 'W-X2', docId: ids[1], letter: 'A', requesterId: 'writer', author: 'writer', approvers: ['quality'], step: 1, outcome: null });
    await db().update(s.workflows).set({ outcome: 'recalled', reason: 'r' }).where(eq(s.workflows.id, 'W-X2'));
    let seen = 0;
    for (const who of PERSONS) for (const role of SIM_ROLES) seen += await compare(await asViewer(who, role), `${who} (${role})`, 3);
    for (const who of ['manager', 'writer'] as const) seen += await compare(await asViewer(who, undefined), `${who} /50`, 50);
    expect(seen).toBeGreaterThan(30);
    expect(met.tookPart).toBeGreaterThan(0);
    expect(met.other).toBeGreaterThan(0);
    expect(met.paged).toBeGreaterThan(0);
  });
});
