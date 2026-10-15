import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { addFunctionHolder, addOrgValue, createDocument, deleteOrgValue, requestValidation, saveSearch, updateMeta, updateOrgValue } from '@/lib/actions';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { importDocument } from '@/lib/importer';
import { auditDetailL, auditTargetL, departmentPage, orgUsage } from '@/lib/queries';
import { addDoc, baseOf, fixClock, getDoc, setupDb, viewOf } from '../support/db';
import { actAs, cookieStore } from '../support/session';

// Administration of the organisation (point 62 of docs/reste-a-faire.md; D-10, D-19): departments and sites are renamed
// (French and English labels) and made inactive or active again by whoever has the right to administer; a department's
// code never changes (it stands in the IDs without attachment); a value documents, people, function holders, shared
// searches or IDs refer to is made inactive, never deleted; an inactive value is no longer offered to a new document
// or shared search and stays wherever it is set; an inactive department still takes function holders, for the circuits
// of its documents; every change is journaled, before → after.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const t = DICT.fr;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** The 'org' dialog of an existing value: labels and state; `original` names it. */
const orgForm = (original: string, over: Record<string, string> = {}) => form({ original, labelFr: original, labelEn: original, active: 'on', ...over });

const department = async (code: string) => (await db().select().from(s.departments).where(eq(s.departments.code, code)))[0];
const site = async (key: string) => (await db().select().from(s.sites).where(eq(s.sites.key, key)))[0];
const entries = (kind: 'department' | 'site', id: string) =>
  db().select().from(s.auditLog).where(and(eq(s.auditLog.targetKind, kind), eq(s.auditLog.targetId, id))).orderBy(asc(s.auditLog.id));

async function addSites() {
  await db().insert(s.sites).values([
    { key: 'lyon', labelFr: 'Lyon — siège', labelEn: 'Lyon — head office', sort: 0 },
    { key: 'le_havre', labelFr: 'Le Havre — magasin', labelEn: 'Le Havre — warehouse', sort: 1 },
  ]);
}

describe('the right to administer', () => {
  const everything = async () => ({
    departments: await db().select().from(s.departments).orderBy(asc(s.departments.code)),
    sites: await db().select().from(s.sites).orderBy(asc(s.sites.key)),
    journal: await db().select().from(s.auditLog),
  });
  // Each call would go through for an administrator (checked below): only the right stops it.
  const calls: [string, () => Promise<unknown>][] = [
    ['updateOrgValue (department)', () => updateOrgValue('department', orgForm('ING', { labelFr: 'Ingénierie' }))],
    ['updateOrgValue (site)', () => updateOrgValue('site', orgForm('lyon', { labelFr: 'Lyon' }))],
    ['deleteOrgValue (department)', () => deleteOrgValue('department', 'LOG')],
    ['deleteOrgValue (site)', () => deleteOrgValue('site', 'le_havre')],
  ];

  it.each(calls)('%s is refused to whoever may not administer, changing and journaling nothing', async (_name, call) => {
    await addSites();
    await db().insert(s.departments).values({ code: 'LOG', labelFr: 'Logistique', labelEn: 'Logistics', sort: 9 });
    const before = await everything();
    for (const who of ['owner', 'researcher', 'auditor'] as const) {
      actAs(who);
      expect(await call(), who).toEqual({ ok: false, error: t.forbidden });
    }
    expect(await everything()).toEqual(before);
    actAs('manager');
    expect(await call()).toMatchObject({ ok: true });
    expect(await db().select().from(s.auditLog)).toHaveLength(1);
  });
});

describe('renaming', () => {
  it('changes the labels of a department, never its code; every screen reads the new label; journaled before → after', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    actAs('manager');
    // A code sent along is not read: the department is the one named `original`, and keeps its code.
    expect(await updateOrgValue('department', orgForm('QUA', { code: 'QAL', labelFr: 'Qualité', labelEn: 'Quality' }))).toEqual({ ok: true, message: t.saved_ok });
    expect(await department('QUA')).toMatchObject({ code: 'QUA', labelFr: 'Qualité', labelEn: 'Quality', active: true });
    expect(await department('QAL')).toBeUndefined();
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ id: 'PRO-QUA-0001', department: 'QUA' });

    const [entry] = await entries('department', 'QUA');
    expect(entry).toMatchObject({ action: 'org_edit', userId: 'manager', docId: null });
    expect(entry.data?.changes).toEqual([{ field: 'labelFr', before: 'QUA', after: 'Qualité' }, { field: 'labelEn', before: 'QUA', after: 'Quality' }]);
    const ctx = await getCtx();
    expect(ctx.label('department', 'QUA')).toBe('Qualité');
    expect(auditTargetL(ctx, 'department', 'QUA')).toBe(`${t.department} · QUA · Qualité`);
    expect(auditDetailL(ctx, entry)).toBe(`${t.label_fr} : QUA → Qualité ; ${t.label_en} : QUA → Quality`);
    // The department's page (lot 5) follows.
    expect(await departmentPage(ctx, 'QUA')).toMatchObject({ code: 'QUA', label: 'Qualité', active: true });
  });

  it('refuses an empty French label, takes the French one for an empty English label, and journals nothing for no change', async () => {
    actAs('manager');
    expect(await updateOrgValue('department', orgForm('ING', { labelFr: ' ' }))).toEqual({ ok: false, error: t.reg_label_required, field: 'labelFr' });
    expect(await updateOrgValue('department', orgForm('ING', { labelFr: 'Ingénierie', labelEn: '' }))).toMatchObject({ ok: true });
    expect(await department('ING')).toMatchObject({ labelFr: 'Ingénierie', labelEn: 'Ingénierie' });
    expect(await updateOrgValue('department', orgForm('ING', { labelFr: 'Ingénierie', labelEn: 'Ingénierie' }))).toMatchObject({ ok: true });
    expect(await entries('department', 'ING')).toHaveLength(1);
    expect(await updateOrgValue('department', orgForm('XXX'))).toEqual({ ok: false, error: t.org_not_found });
  });

  it('gives a site French and English labels, read in the reader’s language; its key stays', async () => {
    await addSites();
    actAs('manager');
    expect(await addOrgValue('site', '', 'Marseille — magasin', 'Marseille — warehouse')).toEqual({ ok: true });
    expect(await site('marseille_magasin')).toMatchObject({ labelFr: 'Marseille — magasin', labelEn: 'Marseille — warehouse', active: true });
    expect(await updateOrgValue('site', orgForm('lyon', { labelFr: 'Lyon — siège et atelier', labelEn: 'Lyon — head office and workshop' }))).toMatchObject({ ok: true });
    expect(await site('lyon')).toMatchObject({ key: 'lyon', labelFr: 'Lyon — siège et atelier' });
    expect((await getCtx()).label('site', 'lyon')).toBe('Lyon — siège et atelier');
    (await cookieStore()).set(COOKIE_LANG, 'en');
    expect((await getCtx()).label('site', 'lyon')).toBe('Lyon — head office and workshop');
    const journal = await entries('site', 'marseille_magasin');
    expect(journal[0]).toMatchObject({ action: 'org_add' });
    expect(journal[0].data?.changes).toEqual([
      { field: 'key', before: null, after: 'marseille_magasin' }, { field: 'labelFr', before: null, after: 'Marseille — magasin' },
      { field: 'labelEn', before: null, after: 'Marseille — warehouse' }, { field: 'active', before: null, after: true },
    ]);
  });
});

describe('the department pages (lot 5)', () => {
  it('and their featured filters follow a rename, of the department as of a site', async () => {
    await addSites();
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().update(s.documents).set({ site: 'lyon' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await db().update(s.departments).set({ featured: ['site'] }).where(eq(s.departments.code, 'QUA'));
    actAs('manager');
    expect(await updateOrgValue('site', orgForm('lyon', { labelFr: 'Lyon — siège et atelier', labelEn: 'Lyon — head office and workshop' }))).toMatchObject({ ok: true });
    expect(await updateOrgValue('department', orgForm('QUA', { labelFr: 'Qualité', labelEn: 'Quality' }))).toMatchObject({ ok: true });
    const page = await departmentPage(await getCtx(), 'QUA');
    expect(page).toMatchObject({ label: 'Qualité', featuredKeys: ['site'] });
    expect(page?.featured).toEqual([{ key: 'site', more: 0, values: [{ value: 'lyon', label: 'Lyon — siège et atelier', count: 1, href: '/recherche?department=QUA&site=lyon' }] }]);
    // Made inactive, the department keeps its page, its setting and its links.
    expect(await updateOrgValue('department', orgForm('QUA', { labelFr: 'Qualité', labelEn: 'Quality', active: 'off' }))).toMatchObject({ ok: true });
    expect(await departmentPage(await getCtx(), 'QUA')).toMatchObject({ active: false, featured: page?.featured });
  });
});

describe('a department made inactive', () => {
  it('is no longer offered to a new document or a shared search, stays where it is set, and comes back', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    actAs('manager');
    expect(await updateOrgValue('department', orgForm('QUA', { labelFr: 'Qualité', labelEn: 'Quality', active: 'off' }))).toMatchObject({ ok: true });
    expect(await department('QUA')).toMatchObject({ active: false });
    const [entry] = await entries('department', 'QUA');
    expect(auditDetailL(await getCtx(), entry)).toBe(`${t.label_fr} : QUA → Qualité ; ${t.label_en} : QUA → Quality ; ${t.active_label} → ${t.inactive}`);

    // A new document: refused in the inactive department, under its field; the user's department is not swapped silently.
    actAs('writer');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', department: 'QUA' }))).toEqual({ ok: false, error: t.department_inactive, field: 'department' });
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO' }))).toEqual({ ok: false, error: t.department_inactive, field: 'department' });
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', department: 'ING' }))).toMatchObject({ ok: true });
    // An existing document keeps it through an edit; another one cannot move to it.
    expect(await updateMeta(form({ docId: 'PRO-QUA-0001', version: (await viewOf(db(), 'PRO-QUA-0001')).version, title: 'Procédure qualité' }))).toMatchObject({ ok: true });
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ title: 'Procédure qualité', department: 'QUA' });
    expect(await updateMeta(form({ docId: 'PRO-ING-0001', version: (await viewOf(db(), 'PRO-ING-0001')).version, department: 'QUA' }))).toEqual({ ok: false, error: t.department_inactive, field: 'department' });

    // Holders: those named stay (a new one may still be named: next test).
    actAs('manager');
    expect(await db().select().from(s.functionHolders).where(eq(s.functionHolders.scopeValue, 'QUA'))).toHaveLength(1);
    // Searches: none newly shared with it.
    expect(await saveSearch('Procédures', { q: '', facets: { type: ['PRO'] } }, 'department', 'QUA')).toEqual({ ok: false, error: t.department_inactive });
    expect(await saveSearch('Procédures', { q: '', facets: { type: ['PRO'] } }, 'department', 'ING')).toMatchObject({ ok: true });

    // Its page stays, marked, with its documents; the migration still imports into it (legacy documents, D-21).
    const page = await departmentPage(await getCtx(), 'QUA');
    expect(page).toMatchObject({ code: 'QUA', label: 'Qualité', active: false });
    expect(await importDocument({ legacyRef: 'GED/Q/1', title: 'Ancienne procédure', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' }, null))
      .toMatchObject({ kind: 'created', id: 'PRO-QUA-0002' });

    // Back again: offered as before.
    expect(await updateOrgValue('department', orgForm('QUA', { labelFr: 'Qualité', labelEn: 'Quality' }))).toMatchObject({ ok: true });
    actAs('writer');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO' }))).toMatchObject({ ok: true });
    expect(await getDoc(db(), 'PRO-QUA-0003')).toMatchObject({ department: 'QUA' });
    expect((await entries('department', 'QUA')).map((e) => e.data?.changes)).toEqual([
      expect.anything(), [{ field: 'active', before: false, after: true }],
    ]);
  });

  it('still takes a head of department: its documents go through circuits', async () => {
    const ID = 'PRO-QUA-0001'; // type PRO: head of department, then quality manager
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    actAs('manager');
    expect(await updateOrgValue('department', orgForm('QUA', { active: 'off' }))).toMatchObject({ ok: true });
    // The head of QUA leaves; nobody heads the departments for the whole group.
    await db().delete(s.functionHolders).where(eq(s.functionHolders.functionKey, 'resp_departement'));
    actAs('owner');
    const refused = await requestValidation(ID, null, await baseOf(db(), ID));
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.error).toContain(t.no_holder);
    // A new head is named for the inactive department, without bringing it back; an unknown department is still refused.
    actAs('manager');
    expect(await addFunctionHolder('resp_departement', 'QUA', 'head')).toEqual({ ok: true });
    expect(await addFunctionHolder('resp_departement', 'XXX', 'head')).toEqual({ ok: false, error: t.holder_scope_invalid });
    expect(await department('QUA')).toMatchObject({ active: false });
    actAs('owner');
    expect(await requestValidation(ID, null, await baseOf(db(), ID))).toMatchObject({ ok: true });
    const [w] = await db().select().from(s.workflows).where(eq(s.workflows.docId, ID));
    const steps = await db().select().from(s.workflowSteps).where(eq(s.workflowSteps.workflowId, w.id)).orderBy(asc(s.workflowSteps.idx));
    expect(steps.map((x) => x.assigneeId)).toEqual(['owner', 'head', 'quality']);
  });

  it('leaves one department active at least: a new document without attachment takes its code', async () => {
    actAs('manager');
    for (const code of ['ING', 'HSE', 'PRJ', 'DIR', 'RDI']) expect(await updateOrgValue('department', orgForm(code, { active: 'off' })), code).toMatchObject({ ok: true });
    expect(await updateOrgValue('department', orgForm('QUA', { active: 'off' }))).toEqual({ ok: false, error: t.org_last_department });
    await db().insert(s.departments).values({ code: 'LOG', labelFr: 'Logistique', labelEn: 'Logistics', active: false, sort: 9 });
    // Deleting an inactive one changes nothing to the active ones; the last active one is not deleted (it is in use here anyway).
    expect(await deleteOrgValue('department', 'LOG')).toMatchObject({ ok: true });
    expect(await department('QUA')).toMatchObject({ active: true });
    // Renaming the last active one, or bringing another back, is free.
    expect(await updateOrgValue('department', orgForm('QUA', { labelFr: 'Qualité' }))).toMatchObject({ ok: true });
    expect(await updateOrgValue('department', orgForm('ING'))).toMatchObject({ ok: true });
    expect(await updateOrgValue('department', orgForm('QUA', { active: 'off' }))).toMatchObject({ ok: true });
  });

  it('does not delete the last active department, even unused', async () => {
    actAs('manager');
    expect(await addOrgValue('department', 'LGO', 'Logistique', 'Logistics')).toEqual({ ok: true });
    await db().update(s.departments).set({ active: false }).where(ne(s.departments.code, 'LGO'));
    expect((await orgUsage()).departments.get('LGO')).toBeUndefined();
    expect(await deleteOrgValue('department', 'LGO')).toEqual({ ok: false, error: t.org_last_department });
    expect(await department('LGO')).toMatchObject({ active: true });
    expect((await entries('department', 'LGO')).map((e) => e.action)).toEqual(['org_add']);
    // With another one active again, the unused one goes.
    expect(await updateOrgValue('department', orgForm('ING'))).toMatchObject({ ok: true });
    expect(await deleteOrgValue('department', 'LGO')).toMatchObject({ ok: true });
  });
});

describe('deleting', () => {
  const addLog = () => db().insert(s.departments).values({ code: 'LOG', labelFr: 'Logistique', labelEn: 'Logistics', sort: 9 });

  // Each makes LOG used: it is then made inactive, never deleted.
  const uses: [string, () => Promise<unknown>][] = [
    ['a document', () => addDoc(db(), { id: 'PRO-LOG-0001', department: 'LOG' })],
    ['a person', () => db().update(s.users).set({ department: 'LOG' }).where(eq(s.users.id, 'writer2'))],
    ['a function holder', () => db().insert(s.functionHolders).values({ functionKey: 'resp_departement', scopeValue: 'LOG', userId: 'head' })],
    ['a search shared with it', () => db().insert(s.savedSearches).values({ label: 'Logistique', q: '', facets: {}, ownerId: 'manager', scope: 'department', department: 'LOG', sort: 0 })],
    // A document created under LOG then reclassified before its first approval: LOG-0001 stays its alias, its counter stays.
    ['an ID given under its code', async () => {
      actAs('writer');
      expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', department: 'LOG' }))).toMatchObject({ ok: true });
      expect(await updateMeta(form({ docId: 'PRO-LOG-0001', version: (await viewOf(db(), 'PRO-LOG-0001')).version, department: 'QUA' }))).toMatchObject({ ok: true });
      expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ aliases: ['PRO-LOG-0001'], department: 'QUA' });
    }],
  ];

  it.each(uses)('a department used by %s is refused, unchanged; made inactive instead', async (_what, use) => {
    await addLog();
    await use();
    actAs('manager');
    expect(await deleteOrgValue('department', 'LOG')).toEqual({ ok: false, error: t.org_department_in_use });
    expect(await department('LOG')).toMatchObject({ labelFr: 'Logistique', active: true });
    expect(await entries('department', 'LOG')).toEqual([]);
    expect(await updateOrgValue('department', orgForm('LOG', { labelFr: 'Logistique', labelEn: 'Logistics', active: 'off' }))).toMatchObject({ ok: true });
  });

  it('an unused department, created by mistake, is deleted, journaled with the values it had', async () => {
    actAs('manager');
    expect(await addOrgValue('department', 'lgo', 'Logistique', 'Logistics')).toEqual({ ok: true });
    expect((await orgUsage()).departments.get('LGO')).toBeUndefined();
    expect(await deleteOrgValue('department', 'LGO')).toEqual({ ok: true, message: t.reg_deleted });
    expect(await department('LGO')).toBeUndefined();
    const journal = await entries('department', 'LGO');
    expect(journal.map((e) => e.action)).toEqual(['org_add', 'org_remove']);
    expect(journal[1].data?.changes).toEqual([
      { field: 'code', before: 'LGO', after: null }, { field: 'labelFr', before: 'Logistique', after: null },
      { field: 'labelEn', before: 'Logistics', after: null }, { field: 'active', before: true, after: null },
    ]);
    expect(await deleteOrgValue('department', 'LGO')).toEqual({ ok: false, error: t.org_not_found });
  });

  it('gives a value added after a deletion a rank of its own: renaming or retiring leaves the order as it was', async () => {
    await addSites();
    actAs('manager');
    for (const code of ['LGO', 'XYZ']) expect(await addOrgValue('department', code, code, '')).toEqual({ ok: true });
    expect(await deleteOrgValue('department', 'LGO')).toMatchObject({ ok: true });
    expect(await addOrgValue('department', 'ABC', 'ABC', '')).toEqual({ ok: true });
    for (const label of ['Marseille', 'Toulon']) expect(await addOrgValue('site', '', label, '')).toEqual({ ok: true });
    expect(await deleteOrgValue('site', 'marseille')).toMatchObject({ ok: true });
    expect(await addOrgValue('site', '', 'Brest', '')).toEqual({ ok: true });
    const ranks = async () => ({
      departments: await db().select({ id: s.departments.code, sort: s.departments.sort }).from(s.departments),
      sites: await db().select({ id: s.sites.key, sort: s.sites.sort }).from(s.sites),
    });
    for (const rows of Object.values(await ranks())) expect(new Set(rows.map((r) => r.sort)).size, JSON.stringify(rows)).toBe(rows.length);
    const order = async () => {
      const ctx = await getCtx();
      return { departments: ctx.departments.map((d) => d.code), sites: ctx.sites.map((x) => x.key) };
    };
    const before = await order();
    expect(before.departments.slice(-2)).toEqual(['XYZ', 'ABC']);
    expect(before.sites.slice(-2)).toEqual(['toulon', 'brest']);
    // Ties of ranks (a base filled by hand, for instance) follow the code or the key, whatever the row last updated.
    await db().update(s.departments).set({ sort: 99 }).where(inArray(s.departments.code, ['XYZ', 'ABC']));
    await db().update(s.sites).set({ sort: 99 }).where(inArray(s.sites.key, ['toulon', 'brest']));
    const tied = await order();
    expect(tied.departments.slice(-2)).toEqual(['ABC', 'XYZ']);
    expect(tied.sites.slice(-2)).toEqual(['brest', 'toulon']);
    expect(await updateOrgValue('department', orgForm('ABC', { labelFr: 'Achats' }))).toMatchObject({ ok: true });
    expect(await updateOrgValue('department', orgForm('XYZ', { active: 'off' }))).toMatchObject({ ok: true });
    expect(await updateOrgValue('site', orgForm('brest', { labelFr: 'Brest — atelier' }))).toMatchObject({ ok: true });
    expect(await order()).toEqual(tied);
  });

  it('counts what uses each department, a project or programme counter aside', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().insert(s.idCounters).values([{ scope: 'doc:PRO-QUA', last: 3 }, { scope: 'doc:PID-HLT-026', last: 1 }, { scope: 'workflow', last: 2 }]);
    const usage = await orgUsage();
    // QUA: one document, six people of the fixtures, one holder (head of department), one counter.
    expect(usage.departments.get('QUA')).toEqual({ documents: 1, people: 6, holders: 1, searches: 0, ids: 1 });
    expect(usage.departments.get('RDI')).toEqual({ documents: 0, people: 1, holders: 0, searches: 0, ids: 0 });
    // System actors belong to no department.
    expect([...usage.departments.values()].reduce((n, u) => n + u.people, 0)).toBe(12);
  });

  it('a site used by documents or people is made inactive, not deleted; an unused one is deleted', async () => {
    await addSites();
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().update(s.documents).set({ site: 'lyon' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await db().update(s.users).set({ site: 'le_havre' }).where(eq(s.users.id, 'pm'));
    actAs('manager');
    expect(await deleteOrgValue('site', 'lyon')).toEqual({ ok: false, error: t.org_site_in_use });
    expect(await deleteOrgValue('site', 'le_havre')).toEqual({ ok: false, error: t.org_site_in_use });
    expect(await addOrgValue('site', '', 'Marseille', '')).toEqual({ ok: true });
    expect(await deleteOrgValue('site', 'marseille')).toEqual({ ok: true, message: t.reg_deleted });
    expect((await entries('site', 'marseille')).map((e) => e.action)).toEqual(['org_add', 'org_remove']);
    expect(await deleteOrgValue('town' as 'site', 'lyon')).toEqual({ ok: false, error: t.error });
  });
});

describe('a site made inactive', () => {
  it('is no longer offered to a new document and stays on those that have it', async () => {
    await addSites();
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    await db().update(s.documents).set({ site: 'lyon' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    actAs('manager');
    expect(await updateOrgValue('site', orgForm('lyon', { labelFr: 'Lyon — siège', labelEn: 'Lyon — head office', active: 'off' }))).toMatchObject({ ok: true });
    expect(auditDetailL(await getCtx(), (await entries('site', 'lyon'))[0])).toBe(`${t.active_label} → ${t.inactive}`);
    actAs('writer');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', site: 'lyon' }))).toEqual({ ok: false, error: t.site_inactive, field: 'site' });
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', site: 'le_havre' }))).toMatchObject({ ok: true });
    expect(await updateMeta(form({ docId: 'PRO-QUA-0001', version: (await viewOf(db(), 'PRO-QUA-0001')).version, title: 'Procédure qualité', site: 'lyon' }))).toMatchObject({ ok: true });
    expect(await getDoc(db(), 'PRO-QUA-0001')).toMatchObject({ title: 'Procédure qualité', site: 'lyon' });
    expect(await updateMeta(form({ docId: 'PRO-QUA-0002', version: (await viewOf(db(), 'PRO-QUA-0002')).version, site: 'lyon' }))).toEqual({ ok: false, error: t.site_inactive, field: 'site' });
  });
});
