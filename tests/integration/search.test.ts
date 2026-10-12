import { desc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { GET } from '@/app/api/export/search/route';
import { getCtx } from '@/lib/context';
import { auditDetailL, listDocs, searchDocs } from '@/lib/queries';
import { parseSearch, searchHref, type SearchInput } from '@/lib/search';
import { addDoc, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { referenceDocs, searchChecked } from '../support/search';
import { actAs } from '../support/session';

// /recherche (point 12 of docs/reste-a-faire.md): new facets, a period on a date and a chosen order, over the documents
// the user may read. Counts, periods and orders never show a draft outside its drafting circle (D-14); the CSV export
// follows the screen's criteria and order.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

type Meta = Partial<typeof s.documents.$inferInsert>;
async function doc(id: string, meta: Meta, spec: Omit<Parameters<typeof addDoc>[1], 'id'> = {}) {
  await addDoc(db(), { id, ...spec });
  if (Object.keys(meta).length) await db().update(s.documents).set(meta).where(eq(s.documents.id, id));
}

/** The search as `who` runs it on /recherche, every page, checked against the in-memory search (tests/support/search.ts). */
async function run(who: Person, search: SearchInput) {
  actAs(who);
  return searchChecked(await getCtx(), search);
}
const ids = (r: { results: { id: string }[] }) => r.results.map((d) => d.id);

describe('facets and counts (D-14)', () => {
  it('never count nor find a draft outside its drafting circle', async () => {
    await db().insert(s.sites).values([{ key: 'lyon', label: 'Lyon' }]);
    await doc('PRO-QUA-0001', { keywords: ['ATEX', 'levage'], site: 'lyon', lang: 'fr' });
    // Never in force: only its owner (and records managers) see it.
    await doc('PRO-QUA-0002', { keywords: ['ATEX', 'secret'], site: 'lyon', lang: 'en', sourceOrg: 'INERIS' }, { ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft' }] });

    const outside = await run('auditor', { facets: {} });
    expect(Object.fromEntries(outside.tally('keywords'))).toEqual({ ATEX: 1, levage: 1 });
    expect(Object.fromEntries(outside.tally('site'))).toEqual({ lyon: 1 });
    expect(Object.fromEntries(outside.tally('lang'))).toEqual({ fr: 1 });
    expect(outside.tally('source').size).toBe(0);
    expect(ids(await run('auditor', { q: 'secret', facets: {} }))).toEqual([]);
    expect(ids(await run('auditor', { facets: { keywords: ['secret'] } }))).toEqual([]);

    for (const who of ['writer', 'manager'] as const) {
      const inside = await run(who, { facets: { keywords: ['ATEX'] } });
      expect(ids(inside).sort(), who).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002']);
      expect(Object.fromEntries(inside.tally('lang')), who).toEqual({ fr: 1, en: 1 });
      expect(Object.fromEntries(inside.tally('source')), who).toEqual({ INERIS: 1 });
    }
  });

  it('combine two new facets: site and owner', async () => {
    await db().insert(s.sites).values([{ key: 'lyon', label: 'Lyon' }, { key: 'le_havre', label: 'Le Havre' }]);
    await doc('PRO-QUA-0001', { site: 'lyon' }, { ownerId: 'owner' });
    await doc('PRO-QUA-0002', { site: 'le_havre' }, { ownerId: 'owner' });
    await doc('PRO-QUA-0003', { site: 'lyon' }, { ownerId: 'writer' });
    const r = await run('auditor', { facets: { site: ['lyon'], owner: ['owner'] } });
    expect(ids(r)).toEqual(['PRO-QUA-0001']);
    expect(Object.fromEntries(r.tally('site'))).toEqual({ lyon: 1, le_havre: 1 });
    expect(Object.fromEntries(r.tally('owner'))).toEqual({ owner: 1, writer: 1 });
  });
});

describe('period and order (D-14)', () => {
  it('date a document outside its drafting circle by its last visible change', async () => {
    // In force since 10 September, a revision B being drafted moved modified_at on 5 October.
    await doc('PRO-QUA-0001', { modifiedAt: '2026-10-05' }, { ownerId: 'owner', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    await doc('PRO-QUA-0002', { modifiedAt: '2026-09-20' });
    const october = { facets: {}, period: { field: 'modified' as const, from: '2026-10-01', to: null } };
    expect(ids(await run('owner', october))).toEqual(['PRO-QUA-0001']);
    expect(ids(await run('auditor', october))).toEqual([]);
    // The most recently modified first: the draft's date counts in the circle only.
    expect(ids(await run('owner', { facets: {}, sort: 'modified' }))).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002']);
    expect(ids(await run('auditor', { facets: {}, sort: 'modified' }))).toEqual(['PRO-QUA-0002', 'PRO-QUA-0001']);
  });

  it('take the effective date of the revision in force, never the planned date of the next one', async () => {
    await doc('PRO-QUA-0001', {}, { revisions: [{ letter: 'A', status: 'in_force', effectiveAt: '2026-09-12' }] });
    // Revision B approved, to take effect on 1 November: A, in force since 10 September, still bears the date.
    await doc('PRO-QUA-0002', {}, { revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-11-01' }] });
    for (const who of ['auditor', 'owner', 'manager'] as const) {
      actAs(who);
      const ctx = await getCtx();
      const want = { 'PRO-QUA-0001': '2026-09-12', 'PRO-QUA-0002': '2026-09-10' };
      expect(Object.fromEntries((await searchDocs(ctx, {})).results.map((d) => [d.id, d.effectiveAt])), who).toEqual(want);
      expect(Object.fromEntries((await referenceDocs(ctx)).map((d) => [d.id, d.effectiveAt])), who).toEqual(want);
      expect(ids(await run(who, { facets: {}, period: { field: 'effective', from: '2026-11-01', to: null } })), who).toEqual([]);
    }
  });

  it('read the effective date for the search only: the list every screen shares does not carry it', async () => {
    await doc('PRO-QUA-0001', {}, { revisions: [{ letter: 'A', status: 'in_force', effectiveAt: '2026-09-12' }] });
    actAs('auditor');
    const ctx = await getCtx();
    const { results: [searched] } = await searchDocs(ctx, {});
    const [shared] = await listDocs(ctx);
    expect(searched.effectiveAt).toBe('2026-09-12');
    expect('effectiveAt' in shared).toBe(false);
  });
});

describe('CSV export', () => {
  async function exportAs(who: Person, search: SearchInput) {
    actAs(who);
    const res = await GET(new Request(`http://codex${searchHref(search, '/api/export/search')}`));
    const lines = (await res.text()).replace(/^﻿/, '').split('\r\n').filter(Boolean);
    return lines.slice(1).map((l) => l.split(';')[0]);
  }

  it('follows the criteria and the order of the screen, and journals them', async () => {
    await doc('PRO-QUA-0001', { title: 'Zinc', keywords: ['ATEX'], issuedAt: '2026-03-01' });
    await doc('PRO-QUA-0002', { title: 'Acier', keywords: ['ATEX'], issuedAt: '2026-02-01' });
    await doc('PRO-QUA-0003', { title: 'Béton', keywords: ['ATEX'], issuedAt: '2025-12-01' });
    await doc('PRO-QUA-0004', { title: 'Brique', keywords: ['levage'], issuedAt: '2026-02-15' });
    await doc('PRO-QUA-0005', { title: 'Argile', keywords: ['ATEX', 'secret'] }, { ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft' }] });
    const search: SearchInput = { facets: { keywords: ['ATEX'] }, period: { field: 'issued', from: '2026-01-01', to: null }, sort: 'title' };
    expect(await exportAs('auditor', search)).toEqual(['PRO-QUA-0002', 'PRO-QUA-0001']);
    // Same criteria on the screen, same order.
    expect(ids(await run('auditor', parseSearch(new URL(searchHref(search), 'http://codex').searchParams)))).toEqual(['PRO-QUA-0002', 'PRO-QUA-0001']);
    expect(await exportAs('auditor', { ...search, sort: 'issued' })).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002']);

    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'export')).orderBy(desc(s.auditLog.id)).limit(1);
    expect(entry.data?.export).toEqual({ q: '', facets: { keywords: ['ATEX'] }, period: { field: 'issued', from: '2026-01-01', to: null }, sort: 'issued', rows: 2 });
    actAs('manager');
    expect(auditDetailL(await getCtx(), entry)).toBe('Mots-clés : ATEX · Date d’émission : depuis le 01/01/2026 · Tri : Date d’émission · 2 lignes');
    // The draft, never in force, is exported in its drafting circle only (D-14), whatever the criteria.
    expect(await exportAs('writer', { facets: { keywords: ['ATEX'] }, sort: 'title' })).toEqual(['PRO-QUA-0002', 'PRO-QUA-0005', 'PRO-QUA-0003', 'PRO-QUA-0001']);
    expect(await exportAs('auditor', { facets: { keywords: ['ATEX'] }, sort: 'title' })).toEqual(['PRO-QUA-0002', 'PRO-QUA-0003', 'PRO-QUA-0001']);
    expect(await exportAs('auditor', { facets: { keywords: ['secret'] } })).toEqual([]);
    expect(await exportAs('auditor', { q: 'argile', facets: {} })).toEqual([]);
    expect(await exportAs('auditor', { facets: {}, sort: 'id' })).toEqual(['PRO-QUA-0001', 'PRO-QUA-0002', 'PRO-QUA-0003', 'PRO-QUA-0004']);
  });

  it('carries a free-text value with a comma, from the URL to the rows', async () => {
    const received = (sourceOrg: string) => ({ origin: 'externe' as const, sourceOrg });
    await doc('COR-QUA-0001', received('Bureau Veritas, agence de Lyon'), { typeCode: 'COR' });
    await doc('COR-QUA-0002', received('Bureau Veritas'), { typeCode: 'COR' });
    await doc('COR-QUA-0003', received('agence de Lyon'), { typeCode: 'COR' });
    expect(Object.fromEntries((await run('auditor', { facets: {} })).tally('source'))).toEqual({ 'Bureau Veritas, agence de Lyon': 1, 'Bureau Veritas': 1, 'agence de Lyon': 1 });
    expect(await exportAs('auditor', { facets: { source: ['Bureau Veritas, agence de Lyon'] } })).toEqual(['COR-QUA-0001']);
    expect(await exportAs('auditor', { facets: { source: ['Bureau Veritas, agence de Lyon', 'Bureau Veritas'] }, sort: 'id' })).toEqual(['COR-QUA-0001', 'COR-QUA-0002']);
  });
});
