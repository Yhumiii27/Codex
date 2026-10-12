import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { getDb, schema as s } from '@/db';
import type { Ctx } from '@/lib/context';
import { inForceEffect } from '@/lib/dates';
import { listDocs, searchDocs } from '@/lib/queries';
import { FACET_KEYS, runSearch, type SearchDoc, type SearchInput } from '@/lib/search';

// The search /recherche ran in memory until lot 6, kept as the reference of searchDocs (lib/queries.ts), which the
// database runs: every document the user may see (listDocs, canRead in JavaScript), with the date its revision in
// force took effect, searched by runSearch (lib/search.ts). A test file using these mocks getDb() (tests/support/db.ts).

/** Documents of the in-memory search: listDocs, each with the date its revision in force took effect (inForceEffect). */
export async function referenceDocs(ctx: Ctx): Promise<SearchDoc[]> {
  const db = await getDb();
  const [docs, revs] = await Promise.all([
    listDocs(ctx),
    db.select({ docId: s.revisions.docId, effectiveAt: s.revisions.effectiveAt, inForceAt: s.revisions.inForceAt }).from(s.revisions).where(eq(s.revisions.status, 'in_force')),
  ]);
  const eff = new Map(revs.flatMap((r) => {
    const at = inForceEffect(r);
    return at ? [[r.docId, at] as const] : [];
  }));
  return docs.map((d) => ({ ...d, effectiveAt: eff.get(d.id) ?? null }));
}

/**
 * The search as the database runs it (searchDocs, every page), checked against the in-memory one: the same documents,
 * read the same, in the same order, and for every facet the same counts, met in the same order. `docs`: referenceDocs
 * for the user, if read already. Returns it.
 */
export async function searchChecked(ctx: Ctx, search: SearchInput, docs?: SearchDoc[]) {
  const [got, ref] = await Promise.all([searchDocs(ctx, search, { all: true, counts: true }), (docs ? Promise.resolve(docs) : referenceDocs(ctx)).then((all) => runSearch(all, search))]);
  const what = `${ctx.user.id} (${ctx.role}, ${ctx.lang}) ${JSON.stringify(search)}`;
  expect(got.results.map((d) => d.id), what).toEqual(ref.results.map((d) => d.id));
  expect(got.results, what).toEqual(ref.results);
  expect(got.total, what).toBe(ref.results.length);
  for (const k of FACET_KEYS) expect([...got.tally(k)], `${what} ${k}`).toEqual([...ref.tally(k)]);
  return got;
}
