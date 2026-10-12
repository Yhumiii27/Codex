import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { deleteSavedSearch, saveSearch } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { savedSearchesSeenBy, seesSavedSearch } from '@/lib/access';
import { DICT } from '@/lib/i18n';
import { listSavedSearches } from '@/lib/queries';
import { parseSearch, type Facets, type SearchInput } from '@/lib/search';
import { addDoc, fixClock, setupDb } from '../support/db';
import { DEPARTMENTS, PEOPLE, type Person } from '../support/fixtures';
import { searchChecked } from '../support/search';
import { actAs } from '../support/session';

// Saved searches of /recherche (point 2 of docs/reste-a-faire.md): whoever may read saves personal searches, seen by
// them only; records managers and administrators share searches with a department (its members) or the whole group,
// and delete shared ones. A saved search keeps criteria only, never documents (D-14).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const t = DICT.fr;
const PRO: Facets = { type: ['PRO'] };

async function save(who: Person, label: string, scope = 'personal', department: string | null = null, q = '', facets: Facets = PRO, more: SearchInput = {}) {
  actAs(who);
  return saveSearch(label, { q, facets, ...more }, scope, department);
}

/** Labels of the saved searches `who` sees in /recherche, in display order. */
async function seen(who: Person) {
  actAs(who);
  return (await listSavedSearches(await getCtx())).map((x) => x.labelL);
}

async function idOf(label: string) {
  const [row] = await db().select().from(s.savedSearches).where(eq(s.savedSearches.label, label));
  return row.id;
}

const count = async () => (await db().select().from(s.savedSearches)).length;

describe('saving a search', () => {
  it('keeps the criteria under a label, as a personal search of whoever saves it', async () => {
    expect(await save('writer', 'Mes procédures', 'personal', null, ' pompe ', { type: ['PRO'], department: ['QUA'] })).toEqual({ ok: true, message: t.search_saved_ok });
    const [row] = await db().select().from(s.savedSearches);
    expect(row).toMatchObject({ label: 'Mes procédures', q: 'pompe', facets: { type: ['PRO'], department: ['QUA'] }, period: null, orderBy: null, ownerId: 'writer', scope: 'personal', department: null });
  });

  it('keeps the period and the order of the results, and opens the search screen with them (point 12)', async () => {
    const more: SearchInput = { period: { field: 'issued', from: '2026-01-01', to: '2026-06-30' }, sort: 'title' };
    expect(await save('writer', 'Émises au 1er semestre', 'personal', null, '', { site: ['lyon'], keywords: ['ATEX'] }, more)).toMatchObject({ ok: true });
    const [row] = await db().select().from(s.savedSearches);
    expect(row).toMatchObject({ facets: { site: ['lyon'], keywords: ['ATEX'] }, period: { field: 'issued', from: '2026-01-01', to: '2026-06-30' }, orderBy: 'title' });
    actAs('writer');
    const [x] = await listSavedSearches(await getCtx());
    expect(x.href).toBe('/recherche?site=lyon&keywords=ATEX&date=issued&from=2026-01-01&to=2026-06-30&sort=title');
    expect(parseSearch(new URL(x.href, 'http://codex').searchParams)).toEqual({ q: '', facets: { site: ['lyon'], keywords: ['ATEX'] }, ...more });
  });

  it('keeps a long free-text value, or one with a comma, and reopens the very search shown (point 12)', async () => {
    const dreal = 'Direction régionale de l’environnement de l’aménagement et du logement';
    expect(dreal.length).toBeGreaterThan(64);
    const shown = { q: '', facets: { type: ['PRO'], source: [dreal], author: ['Préfecture du Rhône, DDPP'] }, period: null, sort: null };
    expect(await save('writer', 'DREAL', 'personal', null, '', shown.facets)).toMatchObject({ ok: true });
    expect(await save('writer', 'DREAL seule', 'personal', null, '', { source: [dreal] })).toMatchObject({ ok: true });
    actAs('writer');
    const [x, y] = await listSavedSearches(await getCtx());
    expect(parseSearch(new URL(x.href, 'http://codex').searchParams)).toEqual(shown);
    expect(parseSearch(new URL(y.href, 'http://codex').searchParams).facets).toEqual({ source: [dreal] });
  });

  it('refuses, with its own message, what a saved search could not keep whole', async () => {
    expect(await save('writer', 'Trop long', 'personal', null, '', { type: ['PRO'], source: ['x'.repeat(301)] })).toEqual({ ok: false, error: t.search_too_long });
    expect(await save('writer', 'Trop de valeurs', 'personal', null, '', { keywords: [...Array(51).keys()].map((i) => `k${i}`) })).toEqual({ ok: false, error: t.search_too_long });
    expect(await save('writer', 'Texte trop long', 'personal', null, 'x'.repeat(201))).toEqual({ ok: false, error: t.search_too_long });
    expect(await count()).toBe(0);
  });

  it('saves a period alone, but not an order alone, and drops an invalid period or order', async () => {
    expect(await save('writer', 'Tri seul', 'personal', null, '', {}, { sort: 'title' })).toEqual({ ok: false, error: t.search_no_criteria });
    expect(await save('writer', 'Période', 'personal', null, '', {}, { period: { field: 'expiry', from: null, to: '2026-12-31' } })).toMatchObject({ ok: true });
    expect(await save('writer', 'Bizarre', 'personal', null, 'pompe', {}, { period: { field: 'issued', from: 'hier', to: null }, sort: 'size' } as unknown as SearchInput)).toMatchObject({ ok: true });
    const rows = await db().select().from(s.savedSearches).orderBy(s.savedSearches.id);
    expect(rows.map((r) => [r.label, r.period, r.orderBy])).toEqual([['Période', { field: 'expiry', from: null, to: '2026-12-31' }, null], ['Bizarre', null, null]]);
  });

  it('refuses an unknown order in the database itself', async () => {
    await expect(db().insert(s.savedSearches).values({ label: 'x', facets: PRO, ownerId: 'writer', orderBy: 'size' as 'title' })).rejects.toThrow();
  });

  it('is open to anyone who may read, an auditor included', async () => {
    expect(await save('auditor', 'Audit')).toMatchObject({ ok: true });
    expect(await seen('auditor')).toEqual(['Audit']);
  });

  it('is refused without the read permission', async () => {
    await db().update(s.rolePermissions).set({ granted: false }).where(and(eq(s.rolePermissions.role, 'contributeur'), eq(s.rolePermissions.perm, 'read')));
    expect(await save('writer', 'Rien')).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_read}` });
    expect(await count()).toBe(0);
  });

  it('refuses a missing or too long label, and a search without criteria', async () => {
    expect(await save('writer', '   ')).toEqual({ ok: false, error: t.search_label_invalid });
    expect(await save('writer', 'x'.repeat(81))).toEqual({ ok: false, error: t.search_label_invalid });
    expect(await save('writer', 'Vide', 'personal', null, '  ', {})).toEqual({ ok: false, error: t.search_no_criteria });
    // Unknown facets are not criteria.
    expect(await save('writer', 'Inconnue', 'personal', null, '', { colour: ['red'] } as Facets)).toEqual({ ok: false, error: t.search_no_criteria });
    expect(await count()).toBe(0);
  });

  it('refuses an unknown scope', async () => {
    expect(await save('manager', 'Tous', 'everyone')).toEqual({ ok: false, error: t.error });
    expect(await count()).toBe(0);
  });
});

describe('sharing a search', () => {
  it('is reserved to records managers and administrators', async () => {
    for (const who of ['writer', 'head', 'auditor'] as const) {
      expect(await save(who, `${who} groupe`, 'group'), who).toEqual({ ok: false, error: t.not_allowed });
      expect(await save(who, `${who} QUA`, 'department', 'QUA'), who).toEqual({ ok: false, error: t.not_allowed });
    }
    expect(await count()).toBe(0);
    expect(await save('manager', 'Groupe', 'group')).toMatchObject({ ok: true });
    // An approver whose row holds the admin permission.
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    expect(await save('head', 'Partagée par un administrateur', 'group')).toMatchObject({ ok: true });
    expect(await count()).toBe(2);
  });

  it('with a department needs a known department', async () => {
    expect(await save('manager', 'Sans département', 'department', null)).toEqual({ ok: false, error: t.error });
    expect(await save('manager', 'Inconnu', 'department', 'XYZ')).toEqual({ ok: false, error: t.error });
    expect(await save('manager', 'Qualité', 'department', 'QUA')).toMatchObject({ ok: true });
    const [row] = await db().select().from(s.savedSearches);
    expect(row).toMatchObject({ scope: 'department', department: 'QUA', ownerId: 'manager' });
  });

  it('with the group or personally names no department', async () => {
    await save('manager', 'Groupe', 'group', 'QUA');
    await save('manager', 'Perso', 'personal', 'QUA');
    expect((await db().select().from(s.savedSearches)).map((x) => x.department)).toEqual([null, null]);
  });
});

describe('who sees a saved search', () => {
  it('shows the group searches to everyone, a department search to its members, a personal search to its owner only', async () => {
    await save('manager', 'Groupe', 'group');
    await save('manager', 'Qualité', 'department', 'QUA');
    await save('manager', 'Ingénierie', 'department', 'ING');
    await save('writer', 'Perso writer');
    await save('writer2', 'Perso writer2');
    await save('manager', 'Perso manager');
    // Group, then department, then personal.
    expect(await seen('writer')).toEqual(['Groupe', 'Qualité', 'Perso writer']);
    expect(await seen('owner')).toEqual(['Groupe', 'Qualité']);
    expect(await seen('writer2')).toEqual(['Groupe', 'Ingénierie', 'Perso writer2']);
    expect(await seen('director')).toEqual(['Groupe']);
    // The records manager sees every shared search, to manage them, and none of the others' personal searches.
    expect(await seen('manager')).toEqual(['Groupe', 'Qualité', 'Ingénierie', 'Perso manager']);
  });

  it("offers deletion of one's own personal searches, and of shared ones to those who share", async () => {
    await save('manager', 'Groupe', 'group');
    await save('writer', 'Perso writer');
    actAs('writer');
    expect((await listSavedSearches(await getCtx())).map((x) => [x.labelL, x.mayDelete])).toEqual([['Groupe', false], ['Perso writer', true]]);
    actAs('manager');
    expect((await listSavedSearches(await getCtx())).map((x) => [x.labelL, x.mayDelete])).toEqual([['Groupe', true]]);
  });

  it('never reveals a document the reader may not see: it opens the search screen on criteria only', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' }); // in force, interne: everyone reads it
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft' }] }); // never in force: the drafting circle only
    await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', conf: 'confidentiel', ownerId: 'writer2' }); // the ING department only
    await save('manager', 'Procédures', 'group');
    actAs('auditor');
    const ctx = await getCtx();
    const [x] = await listSavedSearches(ctx);
    expect(Object.keys(x).sort()).toEqual(['department', 'facets', 'href', 'id', 'labelL', 'mayDelete', 'q', 'scope', 'title']);
    expect(x.href).toBe('/recherche?type=PRO');
    expect((await searchChecked(ctx, parseSearch(new URL(x.href, 'http://codex').searchParams))).results.map((d) => d.id)).toEqual(['PRO-QUA-0001']);
  });
});

describe('the listing query', () => {
  it('loads only the saved searches seesSavedSearch shows: never the others\' personal searches', async () => {
    const owners = Object.keys(PEOPLE) as Person[];
    await db().insert(s.savedSearches).values([
      ...owners.map((o) => ({ label: `perso ${o}`, facets: PRO, ownerId: o, scope: 'personal' as const })),
      ...DEPARTMENTS.map((d) => ({ label: `dept ${d}`, facets: PRO, ownerId: 'manager', scope: 'department' as const, department: d })),
      { label: 'groupe', facets: PRO, ownerId: 'manager', scope: 'group' as const },
    ]);
    // Someone without a department sees no department search.
    await db().update(s.users).set({ department: null }).where(eq(s.users.id, 'researcher'));
    expect(await seen('researcher')).toEqual(['groupe', 'perso researcher']);
    const all = await db().select().from(s.savedSearches);
    const ids = (rows: { id: number }[]) => rows.map((x) => x.id).sort((a, b) => a - b);
    const check = async (who: Person, role?: 'gestionnaire') => {
      actAs(who, role);
      const ctx = await getCtx();
      const loaded = await db().select().from(s.savedSearches).where(savedSearchesSeenBy(ctx));
      expect(ids(loaded), `${who} ${role ?? ''}`).toEqual(ids(all.filter((x) => seesSavedSearch(ctx, x))));
      expect(loaded.filter((x) => x.scope === 'personal').map((x) => x.ownerId), who).toEqual([who]);
    };
    for (const who of owners) await check(who);
    await check('writer', 'gestionnaire');
    // Approvers who hold the admin permission share, so they see every department search.
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    for (const who of owners) await check(who);
    expect(await seen('researcher')).toEqual(['groupe', ...DEPARTMENTS.map((d) => `dept ${d}`), 'perso researcher']);
  });
});

describe('deleting a saved search', () => {
  it('lets the owner delete their personal search', async () => {
    await save('writer', 'Perso writer');
    actAs('writer');
    expect(await deleteSavedSearch(await idOf('Perso writer'))).toEqual({ ok: true, message: t.search_deleted_ok });
    expect(await count()).toBe(0);
  });

  it("treats someone else's personal search as missing, records managers included", async () => {
    await save('writer', 'Perso writer');
    const id = await idOf('Perso writer');
    for (const who of ['writer2', 'owner', 'manager'] as const) {
      actAs(who);
      expect(await deleteSavedSearch(id), who).toEqual({ ok: false, error: t.search_not_found });
    }
    expect(await count()).toBe(1);
  });

  it('refuses a shared search to those who may not share, and lets records managers and administrators delete it', async () => {
    await save('manager', 'Groupe', 'group');
    await save('manager', 'Qualité', 'department', 'QUA');
    for (const label of ['Groupe', 'Qualité']) {
      for (const who of ['writer', 'head'] as const) {
        actAs(who);
        expect(await deleteSavedSearch(await idOf(label)), `${who} ${label}`).toEqual({ ok: false, error: t.not_allowed });
      }
    }
    // Outside the department, the department search does not exist.
    actAs('writer2');
    expect(await deleteSavedSearch(await idOf('Qualité'))).toEqual({ ok: false, error: t.search_not_found });
    expect(await count()).toBe(2);
    actAs('manager');
    expect(await deleteSavedSearch(await idOf('Groupe'))).toMatchObject({ ok: true });
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    actAs('engineer');
    expect(await deleteSavedSearch(await idOf('Qualité'))).toMatchObject({ ok: true });
    expect(await count()).toBe(0);
  });

  it('answers a deleted or malformed search as missing', async () => {
    await save('writer', 'Perso writer');
    const id = await idOf('Perso writer');
    actAs('writer');
    expect(await deleteSavedSearch(id)).toMatchObject({ ok: true });
    expect(await deleteSavedSearch(id)).toEqual({ ok: false, error: t.search_not_found });
    expect(await deleteSavedSearch('1' as unknown as number)).toEqual({ ok: false, error: t.search_not_found });
  });
});
