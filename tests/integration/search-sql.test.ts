import { desc, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/export/search/route';
import { schema as s } from '@/db';
import { engineOf } from '@/db/sql-client';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import type { SimRole } from '@/lib/i18n';
import { listDocs, PAGE_SIZE, searchDocs, wordStartSql } from '@/lib/queries';
import { fold, hit, searchHref, type SearchInput } from '@/lib/search';
import { explorerChecked, type ExplorerFilter } from '../support/explorer';
import { addDoc, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { referenceDocs, searchChecked } from '../support/search';
import { actAs, cookieStore } from '../support/session';
import { random, variedDocuments, variedMetadata } from '../support/varied';

// /recherche and /explorateur filtered, counted, sorted and paged by the database (lib/queries.ts searchDocs,
// explorerDocs; point 50 of docs/reste-a-faire.md), against what they computed in memory until lot 6 (lib/search.ts
// runSearch over listDocs, tests/support/search.ts and explorer.ts): the same documents, read the same, in the same
// order, with the same counts, for every person under every role. Then the pieces it rests on, which another version
// of Node or PGlite could part: the folding of texts (codex_fold), the start of a word (wordStartSql) and the
// order of titles and IDs (collation codex_fr). tests/integration/seed-sql.test.ts does the same on the demo seed.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

/** Varied documents and what the search reads of them; type labels and people's names with accents. */
async function varied(seed: number, n: number) {
  await db().insert(s.sites).values([{ key: 'lyon', labelFr: 'Lyon', labelEn: 'Lyon' }, { key: 'le_havre', labelFr: 'Le Havre', labelEn: 'Le Havre' }]);
  await db().insert(s.functionHolders).values({ functionKey: 'chef_projet', scopeValue: 'HLT-026', userId: 'engineer' });
  await db().execute(sql`update doc_types set label_fr = case code when 'PRO' then 'Procédure' when 'COR' then 'Correspondance' when 'FRM' then 'Formulaire' else label_fr end,
    label_en = case code when 'PRO' then 'Procedure' when 'COR' then 'Letter' else label_en end`);
  await db().execute(sql`update users set name = case id when 'writer' then 'Élodie Levage' when 'owner' then 'Zoé Œuvre' when 'auditor' then 'jean dupont' else name end`);
  const ids = await variedDocuments(db(), seed, n);
  await variedMetadata(db(), seed + 1, ids);
}

/**
 * Who is compared: a records manager, owners and authors, a project team, a department, someone under roles that
 * cannot read or draft, in French and in English. tests/integration/access-sql.test.ts compares the visibility of every
 * person under every role.
 */
const VIEWERS: [Person, SimRole | undefined, 'fr' | 'en'][] = [
  ['manager', undefined, 'fr'], ['owner', undefined, 'fr'], ['writer', undefined, 'en'], ['writer2', undefined, 'fr'], ['auditor', undefined, 'fr'],
  ['pm', undefined, 'fr'], ['engineer', undefined, 'en'], ['researcher', undefined, 'fr'], ['writer', 'auditeur', 'fr'], ['auditor', 'validateur', 'fr'],
];

async function as(who: Person, role: SimRole | undefined, lang: 'fr' | 'en') {
  actAs(who, role);
  (await cookieStore()).set(COOKIE_LANG, lang);
  return getCtx();
}

/** IDs of the rows of a CSV export (RFC 4180, semicolons): its first column, the header left out. */
function csvIds(text: string): string[] {
  const ids: string[] = [];
  let col = 0;
  for (const m of text.replace(/^\ufeff/, '').matchAll(/("(?:[^"]|"")*"|[^";\r\n]*)(;|\r\n)/g)) {
    if (col === 0) ids.push(m[1]);
    col = m[2] === ';' ? col + 1 : 0;
  }
  return ids.slice(1);
}

const SEARCHES: SearchInput[] = [
  {}, { sort: 'title' }, { sort: 'id' }, { sort: 'issued' }, { sort: 'due' }, { sort: 'modified' }, { sort: 'relevance' },
  { q: 'levage' }, { q: 'LEVAGE', sort: 'title' }, { q: 'é' }, { q: 'e', sort: 'id' }, { q: 'pro' }, { q: 'qua-00' }, { q: 'procedure' }, { q: 'Procédure' },
  { q: 'letter' }, { q: 'élodie' }, { q: 'zoe' }, { q: 'jean dupont' }, { q: 'apave' }, { q: "d'é" }, { q: 'rapport 1' }, { q: '50%' }, { q: 'a_b' },
  { q: 'c:\\' }, { q: '(note' }, { q: 'x.y' }, { q: 'ας' }, { q: 'strasse' }, { q: 'fi' }, { q: 'old' }, { q: 'ext' }, { q: 'st-12' }, { q: ' ' }, { q: '\0' },
  { q: '´' }, { q: 'r2601' },
  { facets: { keywords: ['ATEX', 'levage'] } }, { facets: { keywords: [''] } }, { facets: { overdue: ['expired'] } }, { facets: { overdue: ['review', 'expired'] }, sort: 'due' },
  { facets: { author: ['Jean Dupont', 'writer', 'owner'] } }, { facets: { source: ['APAVE'] } }, { facets: { status: ['in_force'], conf: ['confidentiel', 'interne'] } },
  { facets: { project: ['HLT-026', 'R2601'] } }, { facets: { lang: ['fr'], site: ['lyon'] } }, { facets: { type: ['PRO\0', 'COR'] } }, { facets: { subtype: ['Instruction'], phase: ['Études'] } },
  { period: { field: 'modified', from: '2026-10-01', to: null } }, { period: { field: 'effective', from: '2026-09-01', to: '2026-09-30' }, sort: 'title' },
  { period: { field: 'issued', from: null, to: '2026-09-15' }, sort: 'issued' }, { period: { field: 'review', from: '2026-10-01', to: '2026-10-10' } },
  { period: { field: 'expiry', from: '2026-10-10', to: null }, sort: 'due' },
  { q: 'levage', facets: { keywords: ['ATEX', 'levage'] }, sort: 'due' },
  { q: 'a', facets: { type: ['PRO', 'COR'], department: ['QUA', 'ING'] }, period: { field: 'modified', from: '2026-09-01', to: '2026-10-09' } },
  { q: 'b', facets: { origin: ['externe'], family: ['qualite', 'recherche'] }, sort: 'title' },
];

describe('searchDocs finds, counts and orders as the in-memory search did', () => {
  it('on varied documents, for every kind of reader, in both languages', { timeout: 60_000 }, async () => {
    await varied(2026, 70);
    let found = 0;
    for (const [who, role, lang] of VIEWERS) {
      const ctx = await as(who, role, lang);
      const docs = await referenceDocs(ctx);
      for (const search of SEARCHES) found += (await searchChecked(ctx, search, docs)).total;
    }
    // Searches that tell documents apart: neither all nor none.
    expect(found).toBeGreaterThan(0);
  });

  it('page after page: the pages of the screen, put end to end, are the results of the export', async () => {
    await varied(7, 130);
    for (const [who, role] of [['manager', undefined], ['writer', 'collaborateur'], ['auditor', undefined]] as const) {
      const ctx = await as(who, role, 'fr');
      for (const search of [{}, { sort: 'title' }, { q: 'e', sort: 'relevance' }, { facets: { keywords: ['ATEX'] }, sort: 'due' }] as SearchInput[]) {
        const all = await searchChecked(ctx, search);
        const first = await searchDocs(ctx, search, { page: 1 });
        expect(first.pages).toBe(Math.max(1, Math.ceil(all.total / PAGE_SIZE)));
        const paged = [...first.results];
        for (let page = 2; page <= first.pages; page++) paged.push(...(await searchDocs(ctx, search, { page })).results);
        expect(paged.map((d) => d.id), `${who} ${JSON.stringify(search)}`).toEqual(all.results.map((d) => d.id));
        // A page beyond the last shows the last one; the counts are those of the whole search.
        const beyond = await searchDocs(ctx, search, { page: first.pages + 3 });
        expect(beyond.page).toBe(first.pages);
        expect([...beyond.tally('type')]).toEqual([...all.tally('type')]);
      }
      if (who === 'manager') expect((await searchDocs(ctx, {})).pages).toBeGreaterThan(2);
    }
  });

  it('the CSV export gives every result, all pages, in the order of the screen, and journals their number', async () => {
    await varied(11, 130);
    const ctx = await as('manager', undefined, 'fr');
    for (const search of [{}, { sort: 'title' }, { q: 'e', sort: 'relevance' }, { facets: { conf: ['interne', 'restreint', 'public'] }, sort: 'due' }] as SearchInput[]) {
      const all = await searchChecked(ctx, search);
      expect(all.total, JSON.stringify(search)).toBeGreaterThan(PAGE_SIZE);
      // The URL of the screen's second page: the export leaves the page aside.
      const res = await GET(new Request(`http://codex${searchHref(search, '/api/export/search', 2)}`));
      expect(csvIds(await res.text()), JSON.stringify(search)).toEqual(all.results.map((d) => d.id));
      const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'export')).orderBy(desc(s.auditLog.id)).limit(1);
      expect(entry.data?.export?.rows).toBe(all.total);
    }
  });
});

describe('explorerDocs lists and counts as the explorer did', () => {
  it('on varied documents, for every kind of reader: each axis, node, type, status and due date', { timeout: 60_000 }, async () => {
    await varied(2027, 120);
    for (const [who, role, lang] of VIEWERS) {
      const ctx = await as(who, role, lang);
      const all = await listDocs(ctx);
      const ids = all.map((d) => d.id);
      const filters: ExplorerFilter[] = [
        { axis: 'family', status: 'all' }, { axis: 'department', status: 'in_force', node: 'QUA' }, { axis: 'project', status: 'all', node: 'HLT-026', sub: 'PID' },
        { axis: 'project', status: 'in_review', node: 'none' }, { axis: 'project', status: 'all', node: 'R2601' }, { axis: 'type', status: 'draft', node: 'PRO' },
        { axis: 'origin', status: 'all', due: 'expired' }, { axis: 'family', status: 'obsolete', due: 'review_late' }, { axis: 'department', status: 'archived', node: 'ING' },
        { axis: 'family', status: 'all', node: 'unknown\0', sub: 'X\0', sel: 'Y\0' },
        { axis: 'family', status: 'all', sel: ids[0] }, { axis: 'family', status: 'all', sel: ids[ids.length - 1] }, { axis: 'family', status: 'all', sel: 'PRO-QUA-9999' },
      ];
      for (const f of filters) await explorerChecked(ctx, f, all);
    }
  });
});

describe('what the database search rests on', () => {
  it('codex_fold folds every code point as fold() does, among those both versions of Unicode assign', async () => {
    // Node and PGlite each carry their own version of Unicode (Node 22: 16.0, as PGlite 0.5; Node 26: 17.0). A code
    // point only the newer one assigns may fold differently (U+A7CE, lower case in 17.0 only): the database search
    // stays consistent, since it folds the query and the values alike (lib/queries.ts textSearch), but may part from
    // the in-memory reference on such a code point. Every code point both assign is compared.
    // PostgreSQL 16 (the shared EPC2I server, npm run test:pg) has neither unicode_assigned() nor unicode_version()
    // (PostgreSQL 17), and folds with ICU (src/db/index.ts foldCollation): there, a code point is left out only when
    // the server's ICU does not know it (no class of character: unassigned) and codex_fold leaves it as it is. With
    // the ICU of Debian or Ubuntu (Unicode 15.0 or 15.1) and Node 22 (16.0), that leaves out 47 code points that
    // fold() changes, all new in Unicode 16.0 (docs/postgres.md, « Version »).
    const { rows: [pg] } = await db().$client.query<{ n: number }>(`select current_setting('server_version_num')::int as n`);
    const { rows: [u] } = await db().$client.query<{ v: string }>(pg.n >= 170000 ? `select 'Unicode ' || unicode_version() || ' in the database' as v`
      : `select 'ICU collation ' || collversion || ' on PostgreSQL ' || current_setting('server_version') as v from pg_collation where collname = 'und-x-icu'`);
    const versions = `Unicode ${process.versions.unicode} in Node, ${u.v}`;
    const known = pg.n >= 170000 ? 'unicode_assigned(x)'
      : `(x collate "und-x-icu" ~ '[[:graph:][:space:][:cntrl:]]' or codex_fold(x) <> regexp_replace(normalize(x, nfd), '[\u0300-\u036f]', '', 'g'))`;
    const unassigned = /\p{Cn}/u;
    const cps: number[] = [];
    for (let c = 1; c <= 0x10ffff; c++) if ((c < 0xd800 || c > 0xdfff) && !unassigned.test(String.fromCodePoint(c))) cps.push(c);
    const differ: string[] = [];
    let compared = 0;
    for (let i = 0; i < cps.length; i += 100_000) {
      const xs = cps.slice(i, i + 100_000).map((c) => String.fromCodePoint(c));
      // Compared in the database: PGlite would drop a byte order mark from a text it hands back.
      const { rows: [r] } = await db().$client.query<{ n: number; differ: string[] }>(
        `select count(*)::int as n, coalesce(array_agg(x) filter (where codex_fold(x) is distinct from want), '{}') as differ
         from unnest($1::text[], $2::text[]) as u(x, want) where ${known}`, [xs, xs.map(fold)]);
      compared += r.n;
      differ.push(...r.differ.map((x) => `U+${x.codePointAt(0)!.toString(16)}`));
    }
    expect(differ, versions).toEqual([]);
    // Nearly every assigned code point: about 300 000 in Unicode 16.0, private use areas included.
    expect(compared, versions).toBeGreaterThan(280_000);
  });

  it('the two collations codex_fold lowers with fold alike: pg_unicode_fast (PostgreSQL 18, PGlite) and ICU (PostgreSQL 16)', async (ctx) => {
    // src/db/index.ts foldCollation: a server before PostgreSQL 18 (the shared EPC2I server is a 16) has no
    // pg_unicode_fast and folds with ICU's root locale. Where both are, with the same version of Unicode (PGlite 0.5:
    // 16.0 for both), they must fold every code point and every context of a final sigma alike: the terms a server
    // indexed under 16 stay right once it is upgraded to 18, and the 16 folds as PGlite does.
    const { rows: [has] } = await db().$client.query<{ fast: boolean; n: number }>(`select exists (select from pg_collation where collname = 'pg_unicode_fast') as fast,
      current_setting('server_version_num')::int as n`);
    if (!has.fast) ctx.skip('no pg_unicode_fast before PostgreSQL 18: codex_fold folds with ICU there, compared with fold() above');
    const { rows: [v] } = await db().$client.query<{ u: string; i: string }>('select unicode_version() as u, icu_unicode_version() as i');
    if (v.u !== v.i) ctx.skip(`Unicode ${v.u} in the database, ${v.i} in its ICU: they may part on what only the newer one knows`);
    const folded = (collation: string) => `(lower(regexp_replace(normalize(x, nfd), '[\\u0300-\\u036f]', '', 'g') collate ${collation}) collate "C")`;
    const cps: number[] = [];
    for (let c = 1; c <= 0x10ffff; c++) if (c < 0xd800 || c > 0xdfff) cps.push(c);
    const texts = ['ΑΣ', 'ΑΣ Α', 'ΑΣ.', 'aΣ', '1Σ', 'ΑΣΑ', 'Σ', 'ΑΣ\u0301', 'ΑΣ\u0345Α', 'ΑΣ\u00ad', 'Α\u00adΣ', 'ΑΣ\u200b Α', "Α'Σ", 'Α.Σ', 'ΟΔΥΣΣΕΥΣ', 'İstanbul', 'Straße ẞ', 'ǅemal'];
    const differ: string[] = [];
    let compared = 0;
    for (const xs of [texts, ...Array.from({ length: Math.ceil(cps.length / 100_000) }, (_, i) => cps.slice(i * 100_000, (i + 1) * 100_000).map((c) => String.fromCodePoint(c)))]) {
      const { rows: [r] } = await db().$client.query<{ n: number; differ: string[] }>(
        `select count(*)::int as n, coalesce(array_agg(x) filter (where ${folded('pg_unicode_fast')} is distinct from ${folded('"und-x-icu"')}), '{}') as differ
         from unnest($1::text[]) as u(x) where unicode_assigned(x)`, [xs]);
      compared += r.n;
      differ.push(...r.differ);
    }
    expect(differ).toEqual([]);
    expect(compared).toBeGreaterThan(280_000);
  });

  it('a query finds the text it copies, even with characters only the newer version of Unicode knows', async () => {
    // U+A7D2 and U+A7D3, U+16EA0 and U+16EB8: a capital and its small letter in Unicode 17.0, unknown to 16.0. Node 26
    // would fold the capital to the small letter, PGlite leaves it: the database folds the query as it folded the title.
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().update(s.documents).set({ title: 'Relevé \ua7d2 \u{16ea0} fin' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    const ctx = await as('manager', undefined, 'fr');
    for (const q of ['\ua7d2', '\u{16ea0}', 'releve \ua7d2', '\ua7d2 \u{16ea0} FIN']) expect((await searchDocs(ctx, { q })).total, q).toBe(1);
  });

  it('codex_fold folds texts as fold() does: final sigma, combining sequences, other scripts', async () => {
    const r = random(5);
    const alphabet = [...'aAeEéÉèÈœŒæÆßẞçÇıİΣσςΑΒΓ ΩΆΈ.-’\'1²ǅǄÅÅǱ̧̨̛̣̀́̂', 'e\u0301\u0327', 'Σ\u0301', '\u0345', 'ﬁ', 'ꞵ', '𝐀', '😀', '\ufeff', 'Ⓐ', 'ꟊ'];
    const texts = ['ΑΣ', 'ΑΣ Α', 'ΑΣ.', 'aΣ', '1Σ', 'ΑΣΑ', 'Σ', 'ΑΣ\u0301', 'ΑΣ\u0345Α', 'Ὀδυσσεύς ΟΔΥΣΣΕΥΣ', 'İstanbul', 'ǅemal', ...Array.from({ length: 3000 }, () => Array.from({ length: 1 + Math.floor(r.next() * 8) }, () => r.pick(alphabet)).join(''))];
    const { rows } = await db().$client.query<{ x: string }>(`select x from unnest($1::text[], $2::text[]) as u(x, want) where codex_fold(x) is distinct from want`, [texts, texts.map(fold)]);
    expect(rows.map((x) => [...x.x].map((c) => c.codePointAt(0)!.toString(16)).join(' '))).toEqual([]);
  });

  it('wordStartSql finds the query at the start of a word where hit() scores 2 or 3', async () => {
    const r = random(9);
    const alphabet = [...'abcéèœ0129²ΣΩжא٣ -.\'’()[]{}*+?|^$\\/%_', '𝐀', '😀', 'ͅ', 'ʰ'];
    const word = (max: number) => Array.from({ length: 1 + Math.floor(r.next() * max) }, () => r.pick(alphabet)).join('');
    const pairs: [string, string][] = [];
    while (pairs.length < 4000) {
      const f = fold(word(12));
      // A piece of the value, cut between code points (a query never holds half of a surrogate pair), or another word.
      const cps = [...f];
      const from = Math.floor(r.next() * cps.length);
      const n = r.next() < 0.6 ? cps.slice(from, from + 1 + Math.floor(r.next() * 4)).join('') : fold(word(3));
      if (n && fold(f) === f && f.includes(n)) pairs.push([f, n]);
    }
    // The query as the search hands it to the database, which folds it again (a folded text folds to itself).
    const { rows } = await db().execute<{ i: number; m: boolean }>(sql`select (n - 1)::int as i, f ~ ${wordStartSql(sql`codex_fold(p)`)} as m
      from unnest(${sql.param(pairs.map((p) => p[0]))}::text[], ${sql.param(pairs.map((p) => p[1]))}::text[]) with ordinality as u(f, p, n)`);
    const wrong = rows.filter((x) => x.m !== hit(pairs[x.i][0], pairs[x.i][1]) >= 2).map((x) => pairs[x.i]);
    expect(wrong).toEqual([]);
    expect(rows.filter((x) => x.m).length).toBeGreaterThan(500);
    expect(rows.filter((x) => !x.m).length).toBeGreaterThan(500);
  });

  it('codex_fr orders titles and IDs as the search sorted them (Intl.Collator, French, numeric, base sensitivity)', async (ctx) => {
    // The order is ICU's. A PostgreSQL server (npm run test:pg, docs/postgres.md) built with an ICU older than PGlite's
    // may order a few characters otherwise: ICU 60 (Unicode 10.0) tells ' from ’, which the ICU of PGlite 0.5 and of
    // Node 22 (Unicode 16.0) find equal. Skipped on such a server only, said in the report; PGlite is always checked.
    // PostgreSQL 16 has no icu_unicode_version() (PostgreSQL 17): there, the server is skipped only when it tells the
    // two apostrophes apart, as ICU 60 does; the ICU of Debian bookworm (72) and Ubuntu 24.04 (74) find them equal.
    const { rows: [pg] } = await db().$client.query<{ n: number }>(`select current_setting('server_version_num')::int as n`);
    if (engineOf(db().$client) === 'postgres') {
      if (pg.n >= 170000) {
        const { rows: [icu] } = await db().$client.query<{ v: string }>('select icu_unicode_version() as v');
        if (Number.parseFloat(icu.v) < 16) ctx.skip(`ICU of the server on Unicode ${icu.v}, older than PGlite's (16.0)`);
      } else {
        const { rows: [ap] } = await db().$client.query<{ same: boolean }>(`select '''' = '’' collate codex_fr as same`);
        if (!ap.same) ctx.skip('ICU of the server older than PGlite\'s: it tells \' from ’');
      }
    }
    const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
    const r = random(3);
    const alphabet = [...'aAbBeEéÉèêzZœŒæÆçÇ0123456789 -_.,\'’()/«»:ñßøØ', '\ufeff'];
    const texts = [
      'PRO-QUA-0002', 'PRO-QUA-10', 'PRO-QUA-0010', 'FRM-QMS-001', 'FRM-QMS-0001', 'Étude', 'etude', 'Ecole', 'École', 'Œuvre', 'Oeuvre', 'côte', 'cote', 'coté', 'côté',
      ...Array.from({ length: 3000 }, () => Array.from({ length: 1 + Math.floor(r.next() * 14) }, () => r.pick(alphabet)).join('')),
    ];
    // A stable sort: equal texts keep their place, as the other keys of the order keep theirs.
    const want = texts.map((x, i) => ({ x, i })).sort((a, b) => collator.compare(a.x, b.x) || a.i - b.i).map((e) => e.i);
    const { rows } = await db().$client.query<{ i: number }>(`select (n - 1)::int as i from unnest($1::text[]) with ordinality as u(x, n) order by x collate codex_fr, n`, [texts]);
    expect(rows.map((x) => x.i)).toEqual(want);
  });
});
