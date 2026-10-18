import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { openDb, schema as s, type Db } from '@/db';
import { seed } from '@/db/seed';
import { getAccessIndex, isUsableTemplate } from '@/lib/access';
import { COOKIE_LANG, getCtx, type Ctx } from '@/lib/context';
import { addDays, parisStamp, todayIso } from '@/lib/format';
import { SIM_ROLES, type SimRole } from '@/lib/i18n';
import {
  actionsAmong, archivedDocs, deadlines, departmentDocs, departmentPage, docWorkflows, dueDeadlines, eventDocs, inForceThisWeek, listAudit, listDocs,
  listTemplates, listWorkflows, myActions, projectDocs, readableBriefs, recentActivity, recentDocs, typeCounts,
} from '@/lib/queries';
import { RETENTION_TRIGGERS, DISPOSITIONS } from '@/lib/registry-rules';
import { isEventTrigger } from '@/lib/retention';
import { addWorkflow, fixClock, setupDb, useDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, cookieStore } from '../support/session';
import { random, variedDocuments, variedMetadata, PERSONS } from '../support/varied';

// What the shell, the home, Archivage, the department pages and the record read now (lib/queries.ts: only the documents
// and workflows they show) against what they computed from every document and every workflow before (listDocs,
// listWorkflows, which stay the reference): the same items, in the same order, read the same, for every person under
// every simulated role. The demo seed, then varied documents with varied retention, dates and journal entries.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

/** The home's « mis en vigueur cette semaine » as it was computed, over the whole journal instead of its last 500 entries. */
async function inForceReference(ctx: Ctx, docs: Awaited<ReturnType<typeof listDocs>>): Promise<number> {
  const visible = new Map(docs.map((d) => [d.id, d]));
  const weekAgo = addDays(todayIso(), -7);
  const audit = await listAudit(ctx, { limit: 1_000_000, docsOnly: true, consultations: 'without' });
  return new Set(audit.filter((a) => a.action === 'in_force' && a.local.slice(0, 10) >= weekAgo && !!a.currentId && visible.get(a.currentId)?.revInForce === a.detail).map((a) => a.currentId)).size;
}

/** Items compared, per kind: each must be met on the data of a test, or the comparison would prove nothing. */
type Tally = Record<'actions' | 'deadlines' | 'inForce' | 'activity' | 'templates' | 'events' | 'archives' | 'deptWorkflows' | 'docWorkflows' | 'projectDocs', number>;
const tally = (): Tally => ({ actions: 0, deadlines: 0, inForce: 0, activity: 0, templates: 0, events: 0, archives: 0, deptWorkflows: 0, docWorkflows: 0, projectDocs: 0 });

/** Each targeted read against its reference, for the person `ctx` is about; counts in `n` the items compared. */
async function compare(ctx: Ctx, who: string, n: Tally): Promise<void> {
  const [all, workflows, ix] = await Promise.all([listDocs(ctx), listWorkflows(ctx), getAccessIndex(ctx)]);
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  // Home: recent documents, deadlines, the week's entries into force, activity; the shell's activity.
  expect(await recentDocs(ctx, 5), who).toEqual(all.slice(0, 5));
  const due = deadlines(ctx, all);
  expect(await dueDeadlines(ctx), who).toEqual(due);
  const week = await inForceReference(ctx, all);
  expect(await inForceThisWeek(ctx), who).toBe(week);
  n.deadlines += due.length;
  n.inForce += week;
  const seen = new Set(ids(all));
  for (const [shown, window] of [[5, 60], [6, 500], [3, 4]]) {
    const ref = (await listAudit(ctx, { limit: window, docsOnly: true, consultations: 'without' })).filter((a) => a.currentId && seen.has(a.currentId)).slice(0, shown);
    expect(await recentActivity(ctx, shown, window), `${who} activity ${shown}/${window}`).toEqual(ref);
    n.activity += ref.length;
  }
  // « À traiter », the templates of « Nouveau depuis un modèle ».
  const actions = await actionsAmong(ctx, all, workflows);
  expect(await myActions(ctx), who).toEqual(actions);
  const templates = all.filter((d) => isUsableTemplate(ctx, d, ix));
  expect(ids(await listTemplates(ctx)), who).toEqual(ids(templates));
  n.actions += actions.length;
  n.templates += templates.length;
  // Archivage: per type, events, archives.
  const counts = new Map<string, { n: number; overrides: number }>();
  for (const d of all) {
    const c = counts.get(d.typeCode) ?? { n: 0, overrides: 0 };
    counts.set(d.typeCode, { n: c.n + 1, overrides: c.overrides + (d.retentionOverride ? 1 : 0) });
  }
  expect(await typeCounts(ctx), who).toEqual(counts);
  const events = all.filter((d) => isEventTrigger(d.retentionTrigger)), archives = all.filter((d) => d.state === 'archived');
  expect(await eventDocs(ctx), who).toEqual(events);
  expect(await archivedDocs(ctx), who).toEqual(archives);
  n.events += events.length;
  n.archives += archives.length;
  // Department pages.
  const departments = [...new Set(all.map((d) => d.department))];
  for (const code of departments) {
    const own = all.filter((d) => d.department === code);
    expect(await departmentDocs(ctx, code), `${who} ${code}`).toEqual(own);
    const page = await departmentPage(ctx, code);
    if (page) {
      const inDept = new Set(ids(own));
      const running = workflows.filter((w) => w.visible && !w.done && inDept.has(w.docId));
      expect(page.workflows, `${who} ${code}`).toEqual(running);
      n.deptWorkflows += running.length;
    }
  }
  // The record: its circuits, the documents its dialogs offer, the project's documents.
  expect(await readableBriefs(ctx), who).toEqual([...all].sort((a, b) => a.id.localeCompare(b.id)).map((d) => ({ id: d.id, title: d.title, state: d.state, obsoleteAt: d.obsoleteAt, ownerId: d.ownerId })));
  for (const d of all.slice(0, 12)) {
    const own = workflows.filter((w) => w.docId === d.id);
    expect(await docWorkflows(ctx, d.id), `${who} ${d.id}`).toEqual(own);
    n.docWorkflows += own.length;
  }
  const everything = await listDocs(ctx, { includeHidden: true });
  for (const code of [...new Set(everything.flatMap((d) => (d.attachment === 'project' && d.projectCode ? [d.projectCode] : [])))]) {
    const ref = everything.filter((d) => d.attachment === 'project' && d.projectCode === code);
    expect(new Map((await projectDocs(ctx, code)).map((d) => [d.id, d])), `${who} ${code}`).toEqual(new Map(ref.map((d) => [d.id, d])));
    n.projectDocs += ref.length;
  }
}

/** Every kind of item was met. */
function expectMet(n: Tally, except: (keyof Tally)[] = []) {
  for (const [k, v] of Object.entries(n)) if (!except.includes(k as keyof Tally)) expect(v, k).toBeGreaterThan(0);
}

async function asViewer(who: string, role: SimRole | undefined, lang: 'fr' | 'en' = 'fr') {
  actAs(who as Person, role);
  (await cookieStore()).set(COOKIE_LANG, lang);
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

  it('each screen reads what it read from every document, for every person under their role and some under another', { timeout: 120_000 }, async () => {
    const users = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.isSystem, false));
    const others: [string, SimRole][] = [['cbardet', 'gestionnaire'], ['jwagner', 'auditeur'], ['gcomte', 'validateur'], ['jholt', 'collaborateur'], ['lfabre', 'gestionnaire']];
    const n = tally();
    for (const { id } of users) await compare(await asViewer(id, undefined, id === 'jholt' ? 'en' : 'fr'), id, n);
    for (const [id, role] of others) await compare(await asViewer(id, role), `${id} (${role})`, n);
    expect(users.length).toBeGreaterThan(5);
    // No revision of the demo entered into force in the week before 12 October: the varied documents below have some.
    expectMet(n, ['inForce']);
  });
});

describe('on varied documents', () => {
  const db = setupDb();
  fixClock('2026-10-10T08:00:00Z');

  /** Varied documents (tests/support/varied.ts), then retention classes, event dates and entries into force drawn at random. */
  async function varied(seedN: number, n: number) {
    await db().insert(s.sites).values([{ key: 'lyon', labelFr: 'Lyon', labelEn: 'Lyon' }, { key: 'le_havre', labelFr: 'Le Havre', labelEn: 'Le Havre' }]);
    await db().insert(s.functionHolders).values({ functionKey: 'chef_projet', scopeValue: 'HLT-026', userId: 'engineer' });
    const ids = await variedDocuments(db(), seedN, n);
    await variedMetadata(db(), seedN + 1, ids);
    const r = random(seedN + 2);
    const days = ['2016-01-15', '2020-02-29', '2021-07-14', '2023-10-31', '2025-12-31', '2026-01-10', '2026-09-30', '2026-10-03', '2026-10-09'];
    for (const id of ids) {
      await db().update(s.documents).set({
        retentionTrigger: r.pick(RETENTION_TRIGGERS),
        retentionDisposition: r.pick(DISPOSITIONS),
        retentionYears: r.pick([null, 0, 1, 3, 5, 10]),
        retentionEventAt: r.next() < 0.5 ? r.pick(days) : null,
        retentionOverride: r.next() < 0.2,
        createdAt: r.pick(days),
        obsoleteAt: r.next() < 0.2 ? r.pick(days) : null,
        archivedAt: r.next() < 0.1 ? r.pick(days) : null,
      }).where(eq(s.documents.id, id));
      // Entries into force over two weeks, some just before midnight UTC (the next day in Paris), on the revision in
      // force, on another one, or on none.
      const revs = await db().select().from(s.revisions).where(eq(s.revisions.docId, id));
      for (let k = Math.floor(r.next() * 3); k > 0; k--) {
        const rev = r.pick([...revs, null]);
        await db().insert(s.auditLog).values({
          at: `${r.pick(['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-09'])} ${r.pick(['08:00:00', '21:59:00', '22:30:00'])}+00`, userId: 'manager', action: 'in_force',
          docId: r.next() < 0.1 ? 'OLD-123' : id, revisionId: rev?.id ?? null, detail: rev?.letter ?? r.pick(['A', 'B']),
        });
      }
    }
    // Drafts sent back by a circuit whose drafting step was someone else's than the owner and the designated author:
    // « À traiter » lists them for that author too.
    const drafts = await db().select().from(s.revisions).where(and(eq(s.revisions.status, 'draft'), sql`${s.revisions.id} not in (select revision_id from workflows)`));
    for (const [i, rev] of drafts.slice(0, 6).entries()) {
      const [d] = await db().select().from(s.documents).where(eq(s.documents.id, rev.docId));
      const author = PERSONS.find((p) => p !== d.ownerId && p !== rev.modifierId && p !== 'manager')!;
      await addWorkflow(db(), { id: `W-S${i}`, docId: d.id, letter: rev.letter, requesterId: author, author, approvers: [PERSONS.find((p) => p !== author)!], step: 1, outcome: i % 2 ? 'rejected' : null });
      if (!(i % 2)) await db().update(s.workflows).set({ outcome: 'recalled', reason: 'r' }).where(eq(s.workflows.id, `W-S${i}`));
    }
    // Former IDs are never handed out twice (lib/codification.ts): one document holds OLD-123, journaled under it.
    await db().execute(sql`update documents set aliases = '[]'::jsonb`);
    await db().execute(sql`update documents set aliases = '["OLD-123"]'::jsonb where id = ${ids[0]}`);
    return ids;
  }

  it('each screen reads what it read from every document, for every kind of reader', { timeout: 120_000 }, async () => {
    await varied(2031, 90);
    const n = tally();
    for (const who of PERSONS) for (const role of SIM_ROLES) await compare(await asViewer(who, role), `${who} (${role})`, n);
    expectMet(n);
  });

  it('the week of entries into force is counted over the whole journal, in Paris time, not over its last 500 entries', async () => {
    const ids = await varied(2032, 20);
    const ctx = await asViewer('manager', 'gestionnaire');
    const journal = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'in_force'));
    // A document in force without any entry into force yet.
    const target = (await listDocs(ctx)).find((d) => d.revInForce && !journal.some((a) => a.docId === d.id))!;
    const [rev] = await db().select().from(s.revisions).where(and(eq(s.revisions.docId, target.id), eq(s.revisions.status, 'in_force')));
    const before = await inForceThisWeek(ctx);
    // Entered into force on 3 October at 22:30 UTC, 4 October in Paris (within the 7 days before 10 October), then
    // buried under 600 later entries.
    await db().insert(s.auditLog).values({ at: '2026-10-02 22:30:00+00', userId: 'manager', action: 'in_force', docId: target.id, revisionId: rev.id, detail: rev.letter });
    await db().insert(s.auditLog).values(Array.from({ length: 600 }, (_, i) => ({ at: `2026-10-09 10:${String(i % 60).padStart(2, '0')}:00+00`, userId: 'manager', action: 'edit', docId: ids[1] })));
    expect(parisStamp('2026-10-02 22:30:00+00').slice(0, 10)).toBe('2026-10-03');
    expect(await inForceThisWeek(ctx)).toBe(before + 1);
    expect(await inForceThisWeek(ctx)).toBe(await inForceReference(ctx, await listDocs(ctx)));
    // The former count, over the last 500 entries, missed it.
    const visible = new Map((await listDocs(ctx)).map((d) => [d.id, d]));
    const last500 = await listAudit(ctx, { limit: 500, docsOnly: true, consultations: 'without' });
    expect(last500.some((a) => a.action === 'in_force' && a.currentId === target.id && visible.get(target.id)?.revInForce === a.detail)).toBe(false);
  });
});
