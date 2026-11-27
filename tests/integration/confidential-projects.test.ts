import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as exportSearch } from '@/app/api/export/search/route';
import { schema as s } from '@/db';
import { buildAccessIndex, canRead, readableSql } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { explorerDocs, getDoc, listAudit, listDocs, recentDocs, searchDocs, typeCounts, validationsPage } from '@/lib/queries';
import { searchHref } from '@/lib/search';
import { syncKeystoneConfidentiality } from '@/server/integrations/keystone/confidentiality';
import { addDoc, addWorkflow, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { compareAccess } from '../support/varied';
import { actAs } from '../support/session';

// Decision of the owner of 27 November 2026 (docs/decisions.md D-33): Keystone gives the confidentiality of its projects,
// also for the documents in Codex; a confidential project is accessible only to the people of its team, and never
// appears for anyone else. Keystone publishes `confidentialite` at the end of keystone.pub_projets and the teams in
// keystone.pub_equipes_projets; Codex mirrors them (projects.confidentiality, project_team) and lib/access.ts filters.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const CLAVIS_WRITER = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/**
 * HLT-026 (manager pm) confidential, its team: engineer (by personnel number) and writer (by Clavis person id). Owner,
 * manager (records manager), director and the others are not on it. One document of the project in force (interne), one
 * draft of its owner, one confidential document whose named reader is outside the team, a document of no project.
 */
async function confidentialProject() {
  await db().update(s.users).set({ matricule: 'EMP-0101' }).where(eq(s.users.id, 'engineer'));
  await db().update(s.users).set({ clavisPersonId: CLAVIS_WRITER }).where(eq(s.users.id, 'writer'));
  await db().update(s.projects).set({ confidentiality: 'confidentiel' }).where(eq(s.projects.code, 'HLT-026'));
  await db().insert(s.projectTeam).values([
    { projectCode: 'HLT-026', matricule: 'EMP-0101', name: 'Engineer', origin: 'affectation', syncedAt: '2026-10-01T08:00:00Z' },
    { projectCode: 'HLT-026', clavisPersonId: CLAVIS_WRITER.toUpperCase(), name: 'Writer', origin: 'equipe', syncedAt: '2026-10-01T08:00:00Z' },
  ]);
  await addDoc(db(), { id: 'PID-HLT-026-001', typeCode: 'PID', projectCode: 'HLT-026', ownerId: 'owner' });
  await addDoc(db(), { id: 'PID-HLT-026-002', typeCode: 'PID', projectCode: 'HLT-026', ownerId: 'engineer', revisions: [{ letter: 'A', status: 'draft', versions: ['engineer'] }] });
  await addDoc(db(), { id: 'COR-HLT-026-001', typeCode: 'COR', projectCode: 'HLT-026', ownerId: 'pm', conf: 'confidentiel', department: 'PRJ' });
  await db().insert(s.documentReaders).values({ docId: 'COR-HLT-026-001', userId: 'director' });
  await addDoc(db(), { id: 'PRO-QUA-0001' });
}

const PROJECT_DOCS = ['COR-HLT-026-001', 'PID-HLT-026-001', 'PID-HLT-026-002'];
const projectDocsOf = (ids: string[]) => ids.filter((id) => id.includes('HLT-026')).sort();

describe('documents of a confidential Keystone project (D-33)', () => {
  beforeEach(confidentialProject);

  it('are absent for whoever is not on the team, records managers, owner and named readers included', async () => {
    for (const who of ['manager', 'owner', 'director', 'auditor', 'quality'] as Person[]) {
      actAs(who);
      const ctx = await getCtx();
      expect(projectDocsOf((await listDocs(ctx)).map((d) => d.id)), who).toEqual([]);
      expect(projectDocsOf((await searchDocs(ctx, { q: 'HLT' })).results.map((d) => d.id)), who).toEqual([]);
      expect(projectDocsOf((await recentDocs(ctx, 50)).map((d) => d.id)), who).toEqual([]);
      expect((await typeCounts(ctx)).get('PID'), who).toBeUndefined();
      // Its pages answer « introuvable », not « accès refusé ».
      for (const id of PROJECT_DOCS) expect(await getDoc(ctx, id), `${who} ${id}`).toBeNull();
      // The project itself never appears in their lists.
      expect(ctx.projects.map((p) => p.code), who).not.toContain('HLT-026');
      // Nor the documents in the CSV export of a search.
      const csv = await (await exportSearch(new Request(`http://codex${searchHref({ q: 'HLT' }, '/api/export/search')}`))).text();
      expect(csv, who).not.toContain('HLT-026');
      // Nor the journal entries about them.
      expect((await listAudit(ctx)).filter((a) => a.docId?.includes('HLT-026')), who).toEqual([]);
    }
    // The document of no project stays where it was.
    actAs('manager');
    expect((await listDocs(await getCtx())).map((d) => d.id)).toContain('PRO-QUA-0001');
  });

  it('are seen by the team, Codex’s own rules on top (the stricter wins)', async () => {
    const seen = async (who: Person) => { actAs(who); return projectDocsOf((await listDocs(await getCtx())).map((d) => d.id)); };
    // The manager of the project: every document, the confidential one through the project team, the draft? not his.
    expect(await seen('pm')).toEqual(['COR-HLT-026-001', 'PID-HLT-026-001']);
    // engineer (personnel number): the document in force and his own draft; not the confidential one (not in PRJ, not named).
    expect(await seen('engineer')).toEqual(['PID-HLT-026-001', 'PID-HLT-026-002']);
    // writer (Clavis person id, matched whatever its case): the document in force only.
    expect(await seen('writer')).toEqual(['PID-HLT-026-001']);
    actAs('engineer');
    const ctx = await getCtx();
    expect(ctx.projects.map((p) => p.code)).toContain('HLT-026');
    expect(await getDoc(ctx, 'COR-HLT-026-001')).toBe('hidden');
    expect(await getDoc(ctx, 'PID-HLT-026-001')).toMatchObject({ doc: { id: 'PID-HLT-026-001' } });
  });

  it('a records manager added to the team sees them as a records manager', async () => {
    await db().update(s.users).set({ matricule: 'EMP-0102' }).where(eq(s.users.id, 'manager'));
    await db().insert(s.projectTeam).values({ projectCode: 'HLT-026', matricule: 'EMP-0102', name: 'Manager', origin: 'partie_prenante', syncedAt: '2026-10-01T08:00:00Z' });
    actAs('manager');
    expect(projectDocsOf((await listDocs(await getCtx())).map((d) => d.id))).toEqual(PROJECT_DOCS);
  });

  it('keeps circuits and the explorer to the team', async () => {
    await addWorkflow(db(), { id: 'WF-1', docId: 'PID-HLT-026-002', letter: 'A', requesterId: 'engineer', author: 'engineer', approvers: ['quality'] });
    actAs('manager');
    const page = await validationsPage(await getCtx(), { filter: 'active' });
    expect(page.list.map((w) => w.docId)).not.toContain('PID-HLT-026-002');
    const explorer = await explorerDocs(await getCtx(), { axis: 'project', status: 'all' });
    expect(projectDocsOf(explorer.rows.map((d) => d.id))).toEqual([]);
    expect(explorer.nodes.get('HLT-026')).toBeUndefined();
    actAs('engineer');
    expect((await validationsPage(await getCtx(), { filter: 'active' })).list.map((w) => w.docId)).toContain('PID-HLT-026-002');
  });

  it('canRead and readableSql agree for every person and role', async () => {
    await compareAccess(db());
    const ix = await buildAccessIndex(db());
    const [d] = await db().select().from(s.documents).where(eq(s.documents.id, 'PID-HLT-026-001'));
    const v = { user: (await db().select().from(s.users).where(eq(s.users.id, 'manager')))[0], seesAll: true, can: () => true };
    expect(canRead(v, d, ix)).toBe(false);
    expect(await db().select({ id: s.documents.id }).from(s.documents).where(readableSql(v))).toEqual([{ id: 'PRO-QUA-0001' }]);
  });
});

describe('the confidentiality and teams read from Keystone', () => {
  it('waits while keystone.pub_projets cannot be read, and changes nothing', async () => {
    expect(await syncKeystoneConfidentiality(db())).toEqual({ status: 'skipped', reason: 'no_source' });
    expect((await db().select().from(s.projects))[0].confidentiality).toBe('normal');
  });

  // On PGlite only: under npm run test:pg the role has no CREATE on the database (as codex_app on the shared server), so
  // it cannot make the stand-in schema keystone; the case above (view not readable) runs on both.
  it.skipIf(!!process.env.CODEX_TEST_DATABASE_URL?.trim())('follows confidentialite and the team; absent column or view: not confidential, team kept', async () => {
    await db().$client.exec(`create schema keystone;
      create table keystone.pub_projets (code text, nom text, categorie text, confidentialite text);
      insert into keystone.pub_projets values ('HLT-026', 'Harbor Line', 'rd', 'confidentiel'), ('XYZ-001', 'Autre', 'industriel', 'normal');
      create table keystone.pub_equipes_projets (projet_code text, matricule text, personne_nom text, email text, origine text, activite text, personne_clavis_id text, role text, maj_le timestamptz);
      insert into keystone.pub_equipes_projets values
        ('HLT-026', 'EMP-0101', 'Engineer', 'engineer@atrium.example', 'equipe', null, null, 'member', now()),
        ('HLT-026', null, 'Writer', null, 'affectation', 'Calcul', '${CLAVIS_WRITER.toUpperCase()}', null, now()),
        ('HLT-026', null, 'Sans identifiant', 'x@atrium.example', 'partie_prenante', null, null, null, now()),
        ('XYZ-001', 'EMP-0909', 'Ailleurs', null, 'equipe', null, null, null, now());`);
    try {
      expect(await syncKeystoneConfidentiality(db(), new Date('2026-11-27T09:00:00Z'))).toEqual({ status: 'ok', projects: 2, changed: 1, team: 'ok', members: 2 });
      expect((await db().select().from(s.projects))[0].confidentiality).toBe('confidentiel');
      const team = await db().select().from(s.projectTeam).orderBy(s.projectTeam.name);
      expect(team.map((m) => [m.projectCode, m.matricule, m.clavisPersonId, m.name, m.origin])).toEqual([
        ['HLT-026', 'EMP-0101', null, 'Engineer', 'equipe'],
        ['HLT-026', null, CLAVIS_WRITER, 'Writer', 'affectation'],
      ]);
      // The team view disappears: the team stays the last one read.
      await db().$client.exec('drop table keystone.pub_equipes_projets');
      expect(await syncKeystoneConfidentiality(db())).toMatchObject({ status: 'ok', changed: 0, team: 'no_source' });
      expect(await db().select().from(s.projectTeam)).toHaveLength(2);
      // pub_projets without the column: not confidential.
      await db().$client.exec('alter table keystone.pub_projets drop column confidentialite');
      expect(await syncKeystoneConfidentiality(db())).toMatchObject({ status: 'ok', changed: 1 });
      expect((await db().select().from(s.projects))[0].confidentiality).toBe('normal');
    } finally {
      await db().$client.exec('drop schema keystone cascade');
    }
  });
});
