import 'server-only';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { schema as s } from '@/db';
import { todayIso } from './format';
import { audit, type Tx } from './lifecycle';
import { cleanTerm, findTerm, termKeys, vocabKey, type VocabKind } from './vocab-rules';

// Controlled vocabularies on the database (point 59 of docs/reste-a-faire.md): source organisations and keywords.
// Documents keep the term's name as text; the rules are in lib/vocab-rules.ts.

export const VOCAB_TABLE = { source_org: s.sourceOrgs, keyword: s.keywordTerms } as const;

export type Term = typeof s.sourceOrgs.$inferSelect;

/** Every term of a vocabulary, by name. */
export async function loadTerms(tx: Tx, kind: VocabKind): Promise<Term[]> {
  const t = VOCAB_TABLE[kind];
  return tx.select().from(t).orderBy(asc(t.name), asc(t.id));
}

/**
 * What values become once read against a vocabulary: each one the name of the term it stands for (findTerm), or, for a
 * value no term stands for, the value cleaned (cleanTerm), listed in `added` (one per key, in order of appearance) unless
 * `confirmed` lacks its key, in which case it is listed in `unconfirmed` and nothing should be written. `confirmed`
 * undefined: every new value is accepted (the import's controlled addition). `offered`: the ids of the terms the user is
 * offered (lib/queries.ts offeredTerms); a value standing for any other term is answered as an unknown one (listed in
 * `unconfirmed` as typed, unless confirmed), so that the answer does not tell that the term exists (D-14), and once
 * confirmed it takes the existing term's name, without being added again.
 */
export function readTerms(terms: readonly Term[], values: readonly string[], confirmed?: ReadonlySet<string>, offered?: ReadonlySet<number>): { values: string[]; added: string[]; unconfirmed: string[] } {
  const out: string[] = [];
  const added: string[] = [];
  const unconfirmed: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const clean = cleanTerm(raw);
    if (!clean) continue;
    const term = findTerm(terms, clean);
    const name = term?.name ?? added.find((x) => vocabKey(x) === vocabKey(clean)) ?? clean;
    const k = vocabKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    const known = term && (!offered || offered.has(term.id));
    if (known) continue;
    if (confirmed && !confirmed.has(vocabKey(clean))) unconfirmed.push(clean);
    else if (term) continue;
    else added.push(clean);
  }
  return { values: out, added, unconfirmed };
}

/**
 * Adds terms to a vocabulary, each journaled ('vocab_add', target the term, by `actorId`, `detail`: where it came from,
 * such as a document or a legacy reference). A term another transaction added meanwhile is left as it is.
 */
export async function addTerms(tx: Tx, kind: VocabKind, names: readonly string[], actorId: string, detail = ''): Promise<void> {
  const t = VOCAB_TABLE[kind];
  for (const name of names) {
    const [row] = await tx.insert(t).values({ name, key: vocabKey(name), createdAt: todayIso() }).onConflictDoNothing({ target: t.key }).returning();
    if (row) await audit(tx, actorId, 'vocab_add', { kind, id: name }, detail, null, { changes: [{ field: 'term', before: null, after: name }] });
  }
}

/**
 * Values of every document for a vocabulary, with how many documents carry each, and whether the viewer may read one
 * of them (`readable`, an SQL condition on documents: lib/access.ts readableSql). Grouped by value as written.
 */
export async function documentValues(tx: Tx, kind: VocabKind, readable: ReturnType<typeof sql> = sql`true`): Promise<{ value: string; n: number; readable: boolean }[]> {
  const D = s.documents;
  const { rows } = kind === 'source_org'
    ? await tx.execute<{ value: string; n: number; readable: boolean }>(sql`select ${D.sourceOrg} as value, count(*)::int as n, bool_or(${readable}) as readable
        from ${D} where ${D.sourceOrg} is not null and ${D.sourceOrg} <> '' group by ${D.sourceOrg}`)
    : await tx.execute<{ value: string; n: number; readable: boolean }>(sql`select e.v as value, count(distinct ${D.id})::int as n, bool_or(${readable}) as readable
        from ${D} cross join lateral jsonb_array_elements_text(${D.keywords}) as e(v) group by e.v`);
  return rows.map((r) => ({ value: String(r.value), n: Number(r.n), readable: !!r.readable }));
}

/**
 * documentValues for both vocabularies in one pass over the documents (the forms' suggestions, on every page: measured at
 * about half the time of two passes on 10 000 documents).
 */
export async function bothDocumentValues(tx: Tx, readable: ReturnType<typeof sql>): Promise<Record<VocabKind, { value: string; readable: boolean }[]>> {
  const D = s.documents;
  const { rows } = await tx.execute<{ kind: VocabKind; value: string; readable: boolean }>(sql`with v as (
      select ${D.sourceOrg} as org, ${D.keywords} as kw, ${readable} as r from ${D}
      where (${D.sourceOrg} is not null and ${D.sourceOrg} <> '') or jsonb_array_length(${D.keywords}) > 0
    )
    select 'source_org' as kind, org as value, bool_or(r) as readable from v where org is not null and org <> '' group by org
    union all select 'keyword', e.v, bool_or(r) from v cross join lateral jsonb_array_elements_text(v.kw) as e(v) group by e.v`);
  const out: Record<VocabKind, { value: string; readable: boolean }[]> = { source_org: [], keyword: [] };
  for (const r of rows) out[r.kind].push({ value: String(r.value), readable: !!r.readable });
  return out;
}

/**
 * Terms for every value documents carry that no term stands for yet (a database filled by the seed, or by a tool that
 * writes documents directly): added under the cleaned value, without journal entry, as the migration took up the
 * existing ones (drizzle/0003_vocabulaires.sql). Returns how many were added.
 */
export async function syncVocabularies(tx: Tx): Promise<number> {
  let n = 0;
  for (const kind of ['source_org', 'keyword'] as const) {
    const terms = await loadTerms(tx, kind);
    const { added } = readTerms(terms, (await documentValues(tx, kind)).map((x) => x.value));
    const t = VOCAB_TABLE[kind];
    for (const name of added) {
      const [row] = await tx.insert(t).values({ name, key: vocabKey(name), createdAt: todayIso() }).onConflictDoNothing({ target: t.key }).returning();
      if (row) n++;
    }
  }
  return n;
}

/**
 * The documents whose value for a vocabulary is one of `keys` (vocabKey), with their row, locked in the order of their
 * IDs (as lib/lifecycle.ts lockDocs) until the end of the transaction: the caller rewrites the value from what it reads
 * here, and an edit committed meanwhile (a keyword added, a hold put) must be waited for and read, not overwritten
 * (READ COMMITTED; revue du lot 9). The candidates are found first without lock, then only they are locked and read
 * again.
 */
export async function documentsWith(tx: Tx, kind: VocabKind, keys: ReadonlySet<string>) {
  const D = s.documents;
  const pick = (rows: (typeof D.$inferSelect)[]) => rows.filter((d) => (kind === 'source_org' ? keys.has(vocabKey(d.sourceOrg ?? '')) : d.keywords.some((k) => keys.has(vocabKey(k)))));
  const seen = kind === 'source_org'
    ? await tx.select().from(D).where(sql`${D.sourceOrg} is not null`).orderBy(asc(D.id))
    : await tx.select().from(D).where(sql`jsonb_array_length(${D.keywords}) > 0`).orderBy(asc(D.id));
  const ids = pick(seen).map((d) => d.id);
  if (!ids.length) return [];
  const rows = await tx.select().from(D).where(inArray(D.id, ids)).orderBy(asc(D.id)).for('update');
  return pick(rows);
}

/** A term by its id, locked for the change about to be made. */
export async function termById(tx: Tx, kind: VocabKind, id: number): Promise<Term | undefined> {
  const t = VOCAB_TABLE[kind];
  const [row] = await tx.select().from(t).where(eq(t.id, id)).for('update');
  return row;
}

export { termKeys };
