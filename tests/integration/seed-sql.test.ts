import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/db';
import { seed } from '@/db/seed';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import type { SimRole } from '@/lib/i18n';
import { listDocs } from '@/lib/queries';
import type { SearchInput } from '@/lib/search';
import { fixClock, useDb } from '../support/db';
import { explorerChecked, type ExplorerFilter } from '../support/explorer';
import type { Person } from '../support/fixtures';
import { referenceDocs, searchChecked } from '../support/search';
import { actAs, cookieStore } from '../support/session';
import { compareAccess } from '../support/varied';

// The demo seed (src/db/seed*.ts), as the application starts with it: for every person under every simulated role, the
// visibility rules in SQL (access.ts readableSql, draftingCircleSql) select the documents canRead selects; for the
// people of the browser checks, /recherche and /explorateur run by the database (lib/queries.ts searchDocs,
// explorerDocs) give what they computed in memory (tests/support/search.ts, explorer.ts).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

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
// The day of the browser checks.
fixClock('2026-10-12T08:00:00Z');

const SEARCHES: SearchInput[] = [
  {}, { sort: 'title' }, { sort: 'id' }, { sort: 'issued' }, { sort: 'due' }, { q: 'procedure' }, { q: 'PROCÉDURE', sort: 'title' }, { q: 'levage' }, { q: 'a' },
  { q: 'hlt' }, { q: 'hlt-026', facets: { type: ['BOM'] } }, { q: 'claire' }, { q: 'wagner' }, { q: 'nordvolt', sort: 'id' }, { q: 'elingage' }, { q: 'béton' },
  { facets: { type: ['PRO'] }, sort: 'title' }, { facets: { status: ['in_force'] }, sort: 'issued' }, { facets: { keywords: ['levage', 'A1410'] } },
  { facets: { department: ['ING', 'QUA'], conf: ['confidentiel', 'restreint', 'interne'] } }, { facets: { overdue: ['expired', 'review'] } },
  { facets: { status: ['draft', 'in_review'] } }, { period: { field: 'modified', from: '2026-09-01', to: null }, sort: 'due' },
  { period: { field: 'effective', from: '2026-01-01', to: '2026-08-31' }, sort: 'title' },
];
const FILTERS: ExplorerFilter[] = [
  { axis: 'family', status: 'all' }, { axis: 'department', status: 'all', node: 'ING' }, { axis: 'project', status: 'all', node: 'HLT-026', sub: 'BOM' },
  { axis: 'project', status: 'all', node: 'none' }, { axis: 'family', status: 'in_review' }, { axis: 'family', status: 'all', due: 'expired' },
  { axis: 'type', status: 'in_force' }, { axis: 'origin', status: 'draft', due: 'review_late' }, { axis: 'family', status: 'all', sel: 'HSE-HLT-026-001' },
];

describe('on the demo seed', () => {
  it('readableSql and draftingCircleSql select what canRead and inDraftingCircle select, for every person under every role', { timeout: 60_000 }, async () => {
    expect(await compareAccess(db)).toBeGreaterThan(40);
  });

  it('/recherche and /explorateur give what they computed in memory', { timeout: 60_000 }, async () => {
    const viewers: [string, SimRole | undefined, 'fr' | 'en'][] = [
      ['cbardet', 'gestionnaire', 'fr'], ['jwagner', 'collaborateur', 'fr'], ['lfabre', 'validateur', 'fr'], ['jholt', 'auditeur', 'en'],
      ['gcomte', 'validateur', 'fr'], ['lmarchand', 'collaborateur', 'en'], ['jwagner', 'auditeur', 'fr'],
    ];
    for (const [who, role, lang] of viewers) {
      actAs(who as Person, role);
      (await cookieStore()).set(COOKIE_LANG, lang);
      const ctx = await getCtx();
      expect(ctx.user.id).toBe(who);
      const docs = await referenceDocs(ctx);
      for (const search of SEARCHES) await searchChecked(ctx, search, docs);
      const all = await listDocs(ctx);
      for (const f of FILTERS) await explorerChecked(ctx, f, all);
    }
  });
});
