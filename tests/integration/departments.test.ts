import { desc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { setDepartmentFeatured } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DEFAULT_FEATURED } from '@/lib/departments';
import { DICT } from '@/lib/i18n';
import { auditDetailL, departmentPage, listSearchDocs } from '@/lib/queries';
import { parseSearch, runSearch } from '@/lib/search';
import { addDoc, addWorkflow, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Department pages (/departements/[code], point 11 of docs/reste-a-faire.md, G12): documents in force, due dates,
// running circuits, shared saved searches and featured filters of one department, under the rules of the other screens
// (D-14: nothing of the work in progress outside the drafting circle, confidential documents within their department).
// The featured filters are set in Administration (lib/actions.ts setDepartmentFeatured).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026

const t = DICT.fr;

type Meta = Partial<typeof s.documents.$inferInsert>;
async function doc(id: string, spec: Omit<Parameters<typeof addDoc>[1], 'id'> = {}, meta: Meta = {}) {
  await addDoc(db(), { id, ...spec });
  if (Object.keys(meta).length) await db().update(s.documents).set(meta).where(eq(s.documents.id, id));
}

/** The page of department `code` as `who` sees it. */
async function page(who: Person, code: string) {
  actAs(who);
  const p = await departmentPage(await getCtx(), code);
  if (!p) throw new Error(`no page for ${code}`);
  return p;
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
/** value → count of one featured facet of a page. */
const counts = (p: Awaited<ReturnType<typeof page>>, key: string) => Object.fromEntries(p.featured.find((f) => f.key === key)?.values.map((v) => [v.value, v.count]) ?? []);

describe('documents of the page (D-14)', () => {
  it('lists the department’s documents in force the user may read, never a draft outside its circle', async () => {
    await doc('PRO-QUA-0001');
    // B drafted by its owner: in force through A for everyone, the draft for its circle only.
    await doc('PRO-QUA-0002', { ownerId: 'writer', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', versions: ['writer'] }] });
    // Never in force: only its owner and records managers see it.
    await doc('PRO-QUA-0003', { ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    await doc('PRO-ING-0001', { department: 'ING', ownerId: 'writer2' });

    for (const who of ['auditor', 'writer', 'manager'] as const) {
      const p = await page(who, 'QUA');
      expect(ids(p.inForce), who).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002']);
      // The page shows no working label outside the circle.
      expect(p.inForce.find((d) => d.id === 'PRO-QUA-0002')?.rev, who).toBe('A');
    }
    // Featured status counts: the draft counts for its circle, not for the auditor.
    expect(counts(await page('auditor', 'QUA'), 'status')).toEqual({ in_force: 2 });
    expect(counts(await page('writer', 'QUA'), 'status')).toEqual({ in_force: 2, draft: 1 });
    expect(counts(await page('manager', 'QUA'), 'status')).toEqual({ in_force: 2, draft: 1 });
  });

  it('never shows a confidential document of another department, nor counts it', async () => {
    await doc('PRO-ING-0001', { department: 'ING', ownerId: 'writer2', conf: 'confidentiel' }, { keywords: ['secret'] });
    await doc('PRO-ING-0002', { department: 'ING', ownerId: 'writer2' }, { keywords: ['béton'] });
    await doc('PRO-QUA-0001', { conf: 'confidentiel' });

    const outsider = await page('writer', 'ING'); // QUA
    expect(ids(outsider.inForce)).toEqual(['PRO-ING-0002']);
    expect(counts(outsider, 'type')).toEqual({ PRO: 1 });
    // Its own department's confidential document stays on its own page.
    expect(ids((await page('writer', 'QUA')).inForce)).toEqual(['PRO-QUA-0001']);
    for (const who of ['engineer', 'manager'] as const) expect(ids((await page(who, 'ING')).inForce), who).toEqual(['PRO-ING-0001', 'PRO-ING-0002']);
  });

  it('gives the due dates of the department’s documents only', async () => {
    await doc('PRO-QUA-0001', {}, { reviewDueAt: '2026-11-15' });
    await doc('PRO-QUA-0002', {}, { reviewDueAt: '2027-06-01' }); // beyond 90 days
    await doc('PRO-ING-0001', { department: 'ING' }, { expiresAt: '2026-10-30' });
    const p = await page('auditor', 'QUA');
    expect(p.deadlines.map((d) => `${d.id} ${d.kind} ${d.end}`)).toEqual(['PRO-QUA-0001 review 2026-11-15']);
  });

  it('returns nothing for an unknown department', async () => {
    actAs('manager');
    expect(await departmentPage(await getCtx(), 'XYZ')).toBeNull();
  });
});

describe('running circuits of the page', () => {
  async function circuit() {
    await doc('PRO-QUA-0001', { ownerId: 'writer', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0001', letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
  }

  it('shows a running circuit to those who follow it, records managers included, and to no one else', async () => {
    await circuit();
    for (const who of ['writer', 'head', 'quality', 'manager'] as const) expect((await page(who, 'QUA')).workflows.map((w) => w.id), who).toEqual(['W-1']);
    // The auditor and an approver of the department outside the circuit: the revision under review does not exist for them.
    for (const who of ['auditor', 'quality2'] as const) expect((await page(who, 'QUA')).workflows, who).toEqual([]);
    // Only on the page of the document's department.
    expect((await page('manager', 'ING')).workflows).toEqual([]);
  });

  it('leaves out a circuit that is over', async () => {
    await circuit();
    await db().update(s.workflows).set({ outcome: 'approved', step: 3 }).where(eq(s.workflows.id, 'W-1'));
    expect((await page('manager', 'QUA')).workflows).toEqual([]);
  });
});

describe('saved searches of the page', () => {
  it('shows those shared with the department, then with the group; never personal ones', async () => {
    await db().insert(s.savedSearches).values([
      { label: 'Groupe', facets: { type: ['PRO'] }, ownerId: 'manager', scope: 'group', sort: 0 },
      { label: 'Qualité', facets: { type: ['PRO'] }, ownerId: 'manager', scope: 'department', department: 'QUA', sort: 1 },
      { label: 'Ingénierie', facets: { type: ['PRO'] }, ownerId: 'manager', scope: 'department', department: 'ING', sort: 2 },
      { label: 'Perso', facets: { type: ['PRO'] }, ownerId: 'writer', scope: 'personal', sort: 3 },
    ]);
    const labels = async (who: Person, code: string) => (await page(who, code)).saved.map((x) => x.labelL);
    expect(await labels('writer', 'QUA')).toEqual(['Qualité', 'Groupe']);
    // A member of another department only gets the group's searches on the ING page.
    expect(await labels('writer', 'ING')).toEqual(['Groupe']);
    expect(await labels('writer2', 'ING')).toEqual(['Ingénierie', 'Groupe']);
    // Records managers see every shared search, on the page of its department.
    expect(await labels('manager', 'ING')).toEqual(['Ingénierie', 'Groupe']);
    expect(await labels('manager', 'HSE')).toEqual(['Groupe']);
  });
});

describe('featured filters', () => {
  it('follow the default facets until Administration sets the department’s own', async () => {
    await doc('PRO-QUA-0001', {}, { keywords: ['ATEX'] });
    const p = await page('auditor', 'QUA');
    expect(p.featuredDefault).toBe(true);
    expect(p.featured.map((f) => f.key)).toEqual(DEFAULT_FEATURED.filter((k) => k !== 'project'));

    actAs('manager');
    expect(await setDepartmentFeatured('QUA', ['keywords', 'owner'])).toEqual({ ok: true, message: t.saved_ok });
    const q = await page('auditor', 'QUA');
    expect(q.featuredDefault).toBe(false);
    expect(q.featured.map((f) => [f.key, f.values.map((v) => v.value)])).toEqual([['keywords', ['ATEX']], ['owner', ['owner']]]);
    // Another department keeps the default ones.
    expect((await page('auditor', 'ING')).featuredDefault).toBe(true);

    actAs('manager');
    expect(await setDepartmentFeatured('QUA', null)).toMatchObject({ ok: true });
    expect((await page('auditor', 'QUA')).featuredDefault).toBe(true);
  });

  it('tell a list set empty apart from facets without any readable value', async () => {
    await doc('PRO-QUA-0001');
    // Default facets: the page says so.
    expect(await page('auditor', 'QUA')).toMatchObject({ featuredDefault: true, featuredKeys: DEFAULT_FEATURED });

    // The department's own facets, but none with a value in its documents: set, yet nothing to show.
    actAs('manager');
    await setDepartmentFeatured('QUA', ['keywords']);
    const own = await page('auditor', 'QUA');
    expect(own).toMatchObject({ featuredDefault: false, featuredKeys: ['keywords'], featured: [] });

    // Set to none: nothing put forward by choice, whatever the documents.
    actAs('manager');
    await setDepartmentFeatured('QUA', []);
    const none = await page('auditor', 'QUA');
    expect(none).toMatchObject({ featuredDefault: false, featuredKeys: [], featured: [] });
    // Another department still follows the default ones.
    expect(await page('auditor', 'ING')).toMatchObject({ featuredDefault: true, featuredKeys: DEFAULT_FEATURED });
  });

  it('lead to /recherche, whose results are the documents counted, for each person (D-14)', async () => {
    await doc('PRO-QUA-0001', {}, { keywords: ['ATEX', 'levage'] });
    await doc('PRO-QUA-0002', { ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] }, { keywords: ['ATEX'] });
    await doc('PRO-ING-0001', { department: 'ING' }, { keywords: ['ATEX'] });
    actAs('manager');
    await setDepartmentFeatured('QUA', ['keywords', 'status']);
    for (const who of ['auditor', 'writer'] as const) {
      const p = await page(who, 'QUA');
      const docs = await listSearchDocs(await getCtx());
      for (const f of p.featured) {
        for (const v of f.values) expect(runSearch(docs, parseSearch(new URL(v.href, 'http://codex').searchParams)).results.length, `${who} ${f.key} ${v.value}`).toBe(v.count);
      }
      expect(counts(p, 'keywords'), who).toEqual(who === 'writer' ? { ATEX: 2, levage: 1 } : { ATEX: 1, levage: 1 });
    }
  });
});

describe('setDepartmentFeatured', () => {
  const featuredOfQua = async () => (await db().select().from(s.departments).where(eq(s.departments.code, 'QUA')))[0].featured;
  const entries = () => db().select().from(s.auditLog).where(eq(s.auditLog.action, 'dept_featured')).orderBy(desc(s.auditLog.id));

  it('is reserved to whoever administers Codex', async () => {
    for (const who of ['writer', 'head', 'auditor'] as const) {
      actAs(who);
      expect(await setDepartmentFeatured('QUA', ['keywords']), who).toEqual({ ok: false, error: t.forbidden });
    }
    expect(await featuredOfQua()).toBeNull();
    expect(await entries()).toEqual([]);
  });

  it('refuses an invalid list or an unknown department, without changing anything', async () => {
    actAs('manager');
    expect(await setDepartmentFeatured('QUA', ['keywords', 'keywords'])).toEqual({ ok: false, error: t.featured_invalid });
    expect(await setDepartmentFeatured('QUA', ['department'])).toEqual({ ok: false, error: t.featured_invalid });
    expect(await setDepartmentFeatured('QUA', ['type', 'status', 'project', 'owner', 'keywords', 'site', 'lang'])).toEqual({ ok: false, error: t.featured_invalid });
    expect(await setDepartmentFeatured('XYZ', ['type'])).toEqual({ ok: false, error: t.error });
    expect(await featuredOfQua()).toBeNull();
    expect(await entries()).toEqual([]);
  });

  it('journals each change, before → after, and nothing when saved unchanged', async () => {
    actAs('manager');
    await setDepartmentFeatured('QUA', ['keywords', 'owner']);
    await setDepartmentFeatured('QUA', ['keywords', 'owner']);
    await setDepartmentFeatured('QUA', []);
    await setDepartmentFeatured('QUA', null);
    const rows = await entries();
    expect(rows.map((r) => [r.targetKind, r.targetId, r.docId, r.data?.changes])).toEqual([
      ['department', 'QUA', null, [{ field: 'featured', before: null, after: 'default' }]],
      ['department', 'QUA', null, [{ field: 'featured', before: ['keywords', 'owner'], after: null }]],
      ['department', 'QUA', null, [{ field: 'featured', before: 'default', after: ['keywords', 'owner'] }]],
    ]);
    const ctx = await getCtx();
    expect(auditDetailL(ctx, rows[2])).toBe(`${t.featured_filters} : ${t.featured_default} → ${t.keywords}, ${t.owner}`);
    expect(auditDetailL(ctx, rows[1])).toBe(`${t.featured_filters} : ${t.keywords}, ${t.owner} → ${t.featured_none}`);
  });
});
