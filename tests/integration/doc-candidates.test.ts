import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as candidatesGET } from '@/app/api/documents/[id]/candidates/route';
import { schema as s } from '@/db';
import { mayEditLinks } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { docCandidates, readableBriefs } from '@/lib/queries';
import { resetRateLimits } from '@/lib/ratelimit';
import { addDoc, fixClock, setupDb } from '../support/db';
import { PEOPLE, type Person } from '../support/fixtures';
import { actAs } from '../support/session';

// The documents a record's dialogs offer, searched as the user types (point 47 of docs/reste-a-faire.md, lib/queries.ts
// docCandidates, GET /api/documents/[id]/candidates): the same documents as the lists the record built from every
// readable document before (readableBriefs, kept as the reference), for every person; then the search, the limit and
// the route's answers.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const RECORD = 'PRO-QUA-0001';

beforeEach(async () => {
  resetRateLimits();
  await addDoc(db(), { id: RECORD });
  await addDoc(db(), { id: 'PRO-QUA-0002' });
  await addDoc(db(), { id: 'PRO-QUA-0003', state: 'obsolete' });
  await addDoc(db(), { id: 'PRO-QUA-0004', state: 'archived' });
  await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', ownerId: 'writer2' });
  await addDoc(db(), { id: 'PRO-ING-0002', department: 'ING', ownerId: 'writer2', conf: 'tres_confidentiel' });
  await addDoc(db(), { id: 'PRO-QUA-0005', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
  await addDoc(db(), { id: 'PRO-QUA-0006' });
  await db().insert(s.documentLinks).values({ sourceId: 'PRO-QUA-0006', targetId: RECORD, kind: 'see_also', createdBy: 'owner', createdAt: '2026-10-01' });
});

const C = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('docCandidates against the lists the record built before', () => {
  it('replacement and link candidates, for every person, under every kind of link', async () => {
    let compared = 0;
    for (const who of Object.keys(PEOPLE) as Person[]) {
      actAs(who);
      const ctx = await getCtx();
      const others = (await readableBriefs(ctx)).filter((d) => d.id !== RECORD).sort((a, b) => C(a.id, b.id));
      const all = { limit: 1000 };
      const replacements = others.filter((d) => d.state === 'active').map((d) => d.id);
      expect((await docCandidates(ctx, RECORD, { purpose: 'replacement', ...all })).options.map((o) => o.key), who).toEqual(replacements);
      const linkable = others.filter((d) => ctx.can('edit') && mayEditLinks(ctx, d) && d.id !== 'PRO-QUA-0006');
      for (const rel of [undefined, 'see_also', 'replaces', 'replaced_by'] as const) {
        const ref = linkable.filter((d) => (rel === 'replaces' ? !!d.obsoleteAt : rel === 'replaced_by' ? d.state === 'active' : true));
        const got = (await docCandidates(ctx, RECORD, { purpose: 'link', rel, ...all })).options;
        expect(got, `${who} ${rel}`).toEqual(ref.map((d) => ({ key: d.id, label: `${d.id} · ${d.title}`, withdrawn: !!d.obsoleteAt, active: d.state === 'active' })));
        compared += got.length;
      }
      compared += replacements.length;
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('searches the ID and the title, folded, and says when there are more than it shows', async () => {
    actAs('manager');
    const ctx = await getCtx();
    expect((await docCandidates(ctx, RECORD, { purpose: 'replacement', q: 'ing-0' })).options.map((o) => o.key)).toEqual(['PRO-ING-0001', 'PRO-ING-0002']);
    expect((await docCandidates(ctx, RECORD, { purpose: 'replacement', q: 'nothing like it' })).options).toEqual([]);
    // A search never reads as SQL (a quote, a wildcard).
    expect((await docCandidates(ctx, RECORD, { purpose: 'replacement', q: "%' or 1=1 --" })).options).toEqual([]);
    const few = await docCandidates(ctx, RECORD, { purpose: 'replacement', limit: 2 });
    expect(few.options.length).toBe(2);
    expect(few.more).toBe(true);
    expect((await docCandidates(ctx, RECORD, { purpose: 'replacement', limit: 100 })).more).toBe(false);
  });

  it('offers nothing to link to someone without the right Modifier', async () => {
    actAs('auditor');
    const ctx = await getCtx();
    expect(ctx.can('edit')).toBe(false);
    expect((await docCandidates(ctx, RECORD, { purpose: 'link' })).options).toEqual([]);
  });
});

describe('GET /api/documents/[id]/candidates', () => {
  const get = (id: string, query: string) => candidatesGET(new Request(`http://codex.test/api/documents/${encodeURIComponent(id)}/candidates?${query}`), { params: Promise.resolve({ id }) });

  it('answers the candidates in JSON, without cache', async () => {
    actAs('owner');
    const res = await get(RECORD, 'for=link&rel=replaces');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ options: [{ key: 'PRO-QUA-0003', label: 'PRO-QUA-0003 · PRO-QUA-0003', withdrawn: true, active: false }], more: false });
  });

  it('404 for a document the user may not read, or a purpose it does not know', async () => {
    actAs('owner');
    expect((await get('PRO-ING-0002', 'for=link')).status).toBe(404);
    expect((await get('PRO-XXX-9999', 'for=link')).status).toBe(404);
    expect((await get(RECORD, 'for=anything')).status).toBe(404);
  });

  it('beyond CODEX_RATE_LOOKUPS, 429', async () => {
    vi.stubEnv('CODEX_RATE_LOOKUPS', '1/1m');
    try {
      actAs('owner');
      expect((await get(RECORD, 'for=replacement')).status).toBe(200);
      expect((await get(RECORD, 'for=replacement')).status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
