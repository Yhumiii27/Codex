import type { TermField } from '@/db/schema';
import { parseIsoDay } from './format';
import type { TKey } from './i18n';
import type { DocView } from './queries';

/**
 * Facets of /recherche, in the order of its filter column; each one is a URL parameter, repeated for each value chosen.
 * `owner` holds user IDs, `author` a user ID or the free-text author, `keywords` several values per document,
 * `overdue` the dates past due (OVERDUE_KEYS).
 */
export const FACET_KEYS = [
  'project', 'family', 'type', 'subtype', 'origin', 'attachment', 'department', 'site', 'owner', 'author', 'status', 'overdue', 'conf',
  'lang', 'keywords', 'source', 'phase', 'lot', 'discipline', 'theme',
] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export type Facets = Partial<Record<FacetKey, string[]>>;

/**
 * Facets whose values are codes or IDs of the reference data, never holding a comma: a single parameter may list them
 * separated by commas (`?type=PRO,NCR`, the form of the URLs before values were repeated). The values of the other
 * facets are free text, read whole.
 */
const CODED: ReadonlySet<FacetKey> = new Set(['project', 'family', 'type', 'origin', 'attachment', 'department', 'site', 'owner', 'status', 'overdue', 'conf']);

/**
 * Values of the `overdue` facet: the indicators of the record (lib/review.ts, docView), « Expiré » and « Revue en
 * retard ». A document may have both, or neither.
 */
export const OVERDUE_KEYS = ['expired', 'review'] as const;

/** Label of each facet (filter column, saved search criteria, journal of the exports). */
export const FACET_LABEL: Record<FacetKey, TKey> = {
  project: 'project_program', family: 'family', type: 'doc_type', subtype: 'subtype', origin: 'origin', attachment: 'attachment',
  department: 'department', site: 'site_label', owner: 'owner', author: 'author_label', status: 'status', overdue: 'facet_overdue', conf: 'conf',
  lang: 'language', keywords: 'keywords', source: 'source_org', phase: 'project_phase', lot: 'work_package', discipline: 'discipline',
  theme: 'research_theme',
};

/** Dates a period can bear on (URL `date`); the modification date is the default. */
export const DATE_FIELDS = ['modified', 'issued', 'effective', 'review', 'expiry'] as const;
export type DateField = (typeof DATE_FIELDS)[number];
export const DATE_LABEL: Record<DateField, TKey> = { modified: 'date_modified', issued: 'issued_at', effective: 'effective_at', review: 'review_due_at', expiry: 'expires_at' };

/** A period on one date of the documents (URL `date`, `from`, `to`), bounds included; one bound may be open. */
export type Period = { field: DateField; from: string | null; to: string | null };

/** Orders of the results (URL `sort`); without one, sortOf() applies the default. */
export const SORT_KEYS = ['relevance', 'modified', 'issued', 'due', 'id', 'title'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_LABEL: Record<SortKey, TKey> = { relevance: 'sort_relevance', modified: 'date_modified', issued: 'issued_at', due: 'sort_due', id: 'sort_id', title: 'title_label' };

/** What /recherche reads from its URL and a saved search keeps. `sort` is null when none was chosen. */
export type Search = { q: string; facets: Facets; period: Period | null; sort: SortKey | null };
export type SearchInput = { q?: string; facets?: Facets; period?: Period | null; sort?: SortKey | null };

/** A document as /recherche searches it: with the date its revision in force took effect (lib/queries.ts listSearchDocs). */
export type SearchDoc = DocView & { effectiveAt: string | null };

const isIn = <K extends string>(keys: readonly K[], v: unknown): v is K => typeof v === 'string' && (keys as readonly string[]).includes(v);

/** A period from untrusted values: valid days only, bounds put back in order, unknown dates read as the modification date. */
export function cleanPeriod(field: unknown, from: unknown, to: unknown): Period | null {
  const day = (v: unknown) => (typeof v === 'string' ? parseIsoDay(v.trim()) : null);
  let a = day(from), b = day(to);
  if (!a && !b) return null;
  if (a && b && a > b) [a, b] = [b, a];
  return { field: isIn(DATE_FIELDS, field) ? field : 'modified', from: a, to: b };
}

/**
 * Reads `?q=…&type=PRO&type=NCR&source=Bureau Veritas, Lyon&date=issued&from=…&to=…&sort=title` into a search, from
 * the page's parameters or a URL's (repeated parameters kept); coded facets also accept `type=PRO,NCR`.
 */
export function parseSearch(sp: Record<string, string | string[] | undefined> | URLSearchParams): Search {
  const all = (k: string): string[] => (sp instanceof URLSearchParams ? sp.getAll(k) : [sp[k] ?? []].flat());
  const one = (k: string) => all(k)[0] ?? '';
  const facets: Facets = {};
  for (const k of FACET_KEYS) {
    const vals = (CODED.has(k) ? all(k).flatMap((x) => x.split(',')) : all(k)).map((x) => x.trim()).filter(Boolean);
    if (vals.length) facets[k] = [...new Set(vals)];
  }
  const sort = one('sort').trim();
  return { q: one('q').trim(), facets, period: cleanPeriod(one('date').trim(), one('from'), one('to')), sort: isIn(SORT_KEYS, sort) ? sort : null };
}

/** Parameters of a page's URL, one value each: a repeated parameter keeps its first value. */
export function oneEach(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

/** Page of a list read from its URL (`page`): a whole number from 1, else 1. */
export function pageOf(v: string | string[] | null | undefined): number {
  const raw = (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  return /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/** URL of a search: one parameter per facet value, so that a value may hold a comma; `page` from the second one. */
export function searchHref(s: SearchInput, base = '/recherche', page = 1): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  for (const k of FACET_KEYS) for (const v of s.facets?.[k] ?? []) p.append(k, v);
  if (s.period && (s.period.from || s.period.to)) {
    p.set('date', s.period.field);
    if (s.period.from) p.set('from', s.period.from);
    if (s.period.to) p.set('to', s.period.to);
  }
  if (s.sort) p.set('sort', s.sort);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

/**
 * URL of /recherche from the query string of the current one (`current`), with some parameters replaced (`set`; null
 * or empty removes one) and the others kept, but the page: another text, other criteria or another order start again
 * from the first page. Used by the search fields (header and screen) and the order of the results.
 */
export function searchUrlWith(current: string, set: Record<string, string | null>): string {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(set)) if (v) p.set(k, v); else p.delete(k);
  p.delete('page');
  const qs = p.toString();
  return `/recherche${qs ? `?${qs}` : ''}`;
}

/**
 * Longest query, facet value and number of values per facet a saved search keeps. A value may be as long as the
 * longest free text the import accepts (source organisation, lib/importer.ts).
 */
const MAX_Q = 200, MAX_VALUE = 300, MAX_VALUES = 50;

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Distinct non-empty text values of a facet, trimmed; a value with a comma is no code, and leaves a coded facet. */
const facetInput = (k: FacetKey, v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && !(CODED.has(k) && x.includes(','))))];

/**
 * Criteria as a saved search keeps them, from untrusted input (a Server Action argument): the query trimmed, known
 * facets only, distinct non-empty text values, within bounds (see beyondBounds); a valid period (cleanPeriod) and a
 * known order.
 */
export function cleanCriteria(input: unknown): Search {
  const src = record(input), raw = record(src.facets), period = record(src.period);
  const facets: Facets = {};
  for (const k of FACET_KEYS) {
    const vals = facetInput(k, raw[k]).filter((v) => v.length <= MAX_VALUE);
    if (vals.length) facets[k] = vals.slice(0, MAX_VALUES);
  }
  return {
    q: typeof src.q === 'string' ? src.q.trim().slice(0, MAX_Q) : '',
    facets,
    period: cleanPeriod(period.field, period.from, period.to),
    sort: isIn(SORT_KEYS, src.sort) ? src.sort : null,
  };
}

/**
 * Whether untrusted criteria hold more than a saved search keeps (a longer query, a longer facet value, more values in
 * a facet): saveSearch then refuses them, rather than keep a search other than the one shown.
 */
export function beyondBounds(input: unknown): boolean {
  const src = record(input), raw = record(src.facets);
  if (typeof src.q === 'string' && src.q.trim().length > MAX_Q) return true;
  return FACET_KEYS.some((k) => {
    const vals = facetInput(k, raw[k]);
    return vals.length > MAX_VALUES || vals.some((v) => v.length > MAX_VALUE);
  });
}

/** A query, a facet value or a period: an order alone selects nothing. */
export function hasCriteria(s: SearchInput): boolean {
  return !!s.q || FACET_KEYS.some((k) => !!s.facets?.[k]?.length) || !!(s.period && (s.period.from || s.period.to));
}

/** A text with its accents and case set aside, as the search compares texts (the database folds as codex_fold does). */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const WORD = /[\p{L}\p{N}]/u;

/** How a field holds the folded query: 3 the whole field, 2 at the start of a word, 1 inside a word, 0 not at all. */
export function hit(field: string | null | undefined, n: string): number {
  if (!field) return 0;
  const f = fold(field);
  if (f === n) return 3;
  let i = f.indexOf(n), found = 0;
  while (i >= 0) {
    if (i === 0 || !WORD.test(f[i - 1])) return 2;
    found = 1;
    i = f.indexOf(n, i + 1);
  }
  return found;
}
const best = (fields: (string | null | undefined)[], n: string) => fields.reduce((m, f) => Math.max(m, hit(f, n)), 0);

/**
 * Weight of each group of values in score(), which the database search applies too (lib/queries.ts searchDocs; groups
 * of document_terms): the ID and former IDs weigh most, then the title, the keywords, the external reference and study
 * ID, then type, subtype, source organisation, owner and author.
 */
export const SCORE_WEIGHT: Record<TermField, number> = { id: 8, title: 4, keyword: 3, ref: 2, other: 1 };

/**
 * Relevance of a document for a query, accent- and case-insensitive; 0 when no field holds it (see SCORE_WEIGHT).
 */
export function score(d: DocView, q: string): number {
  const n = fold(q.trim());
  if (!n) return 0;
  const w = SCORE_WEIGHT;
  return w.id * best([d.id, ...d.aliases], n) + w.title * best([d.title], n) + w.keyword * best(d.keywords, n)
    + w.ref * best([d.externalRef, d.studyId], n) + w.other * best([d.typeLabel, d.subtype, d.sourceOrg, d.owner, d.author], n);
}

let wordClass: string | undefined;
/**
 * The characters hit() takes for a word's own: letters and digits of the basic plane, as a bracket expression of
 * PostgreSQL. hit() reads the character before a match one UTF-16 unit at a time, so a character beyond the basic
 * plane (a surrogate pair) never counts as one: it is left out. Drawn from this JavaScript engine's own Unicode tables
 * rather than from the database's classes ([[:alnum:]] counts other characters, ² or combining marks among them).
 */
function wordChars(): string {
  if (wordClass) return wordClass;
  const hex = (c: number) => `\\u${c.toString(16).padStart(4, '0')}`;
  let out = '', start = -1;
  for (let c = 0; c <= 0x10000; c++) {
    const w = c < 0x10000 && WORD.test(String.fromCharCode(c));
    if (w && start < 0) start = c;
    if (!w && start >= 0) {
      out += start === c - 1 ? hex(start) : `${hex(start)}-${hex(c - 1)}`;
      start = -1;
    }
  }
  return (wordClass = out);
}

/**
 * Start of a regular expression of PostgreSQL that finds a folded query at the start of a word of a folded value, as
 * hit() scores 2: not right after a letter or digit. The database appends the query it has folded, its ASCII
 * punctuation escaped (lib/queries.ts wordStartSql).
 */
export function wordStartPrefix(): string {
  return `(?<![${wordChars()}])`;
}

/** Full-text match (see score); an empty query matches everything. */
export function matches(d: DocView, q: string): boolean {
  return !q.trim() || score(d, q) > 0;
}

/** Values of a document for a facet: none, one, or several (keywords). */
export function facetValues(d: DocView, k: FacetKey): string[] {
  const one = (v: string | null | undefined) => (v ? [v] : []);
  switch (k) {
    case 'project': return one(d.projectCode ?? d.programCode);
    case 'family': return [d.family];
    case 'type': return [d.typeCode];
    case 'subtype': return one(d.subtype);
    case 'origin': return [d.origin];
    case 'attachment': return [d.attachment];
    case 'department': return [d.department];
    case 'site': return one(d.site);
    case 'owner': return [d.ownerId];
    // As the record shows it: the free-text author, else the author user, else the owner.
    case 'author': return one(d.authorText || d.authorId || d.ownerId);
    case 'status': return [d.status];
    case 'overdue': return [...(d.expired ? ['expired'] : []), ...(d.reviewOverdue ? ['review'] : [])];
    case 'conf': return [d.conf];
    case 'lang': return one(d.lang);
    case 'keywords': return [...new Set(d.keywords)];
    case 'source': return one(d.sourceOrg);
    case 'phase': return one(d.projectPhase);
    case 'lot': return one(d.workPackage);
    case 'discipline': return one(d.discipline);
    case 'theme': return one(d.researchTheme);
  }
}

/** Every facet filter except `skip` (used to count the options of `skip` itself): a document passes with any value chosen. */
export function passes(d: DocView, facets: Facets, skip?: FacetKey): boolean {
  return FACET_KEYS.every((k) => k === skip || !facets[k]?.length || facetValues(d, k).some((v) => facets[k]!.includes(v)));
}

export function dateOf(d: SearchDoc, field: DateField): string | null {
  switch (field) {
    case 'modified': return d.modifiedAt;
    case 'issued': return d.issuedAt;
    case 'effective': return d.effectiveAt;
    case 'review': return d.reviewDueAt;
    case 'expiry': return d.expiresAt;
  }
}

/** A document without the date never falls within a period. */
export function inPeriod(d: SearchDoc, p: Period | null | undefined): boolean {
  if (!p || (!p.from && !p.to)) return true;
  const v = dateOf(d, p.field)?.slice(0, 10);
  return !!v && (!p.from || v >= p.from) && (!p.to || v <= p.to);
}

/** Next due date: review or expiry, whichever comes first. */
export function dueOf(d: Pick<DocView, 'reviewDueAt' | 'expiresAt'>): string | null {
  const ds = [d.reviewDueAt, d.expiresAt].filter((x): x is string => !!x).sort();
  return ds[0] ?? null;
}

/** The order applied: the one chosen, else relevance when there is a query, else the most recently modified first. */
export function sortOf(s: SearchInput): SortKey {
  return s.sort ?? (s.q?.trim() ? 'relevance' : 'modified');
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
/** Missing values last, in both directions. */
const newest = (a: string | null, b: string | null) => (a === b ? 0 : !a ? 1 : !b ? -1 : a < b ? 1 : -1);
const soonest = (a: string | null, b: string | null) => (a === b ? 0 : !a ? 1 : !b ? -1 : a < b ? -1 : 1);

type Hit = { d: SearchDoc; score: number };
const COMPARE: Record<SortKey, (a: Hit, b: Hit) => number> = {
  relevance: (a, b) => b.score - a.score || newest(a.d.modifiedAt, b.d.modifiedAt),
  modified: (a, b) => newest(a.d.modifiedAt, b.d.modifiedAt),
  issued: (a, b) => newest(a.d.issuedAt, b.d.issuedAt),
  due: (a, b) => soonest(dueOf(a.d), dueOf(b.d)),
  id: (a, b) => collator.compare(a.d.id, b.d.id),
  title: (a, b) => collator.compare(a.d.title, b.d.title) || collator.compare(a.d.id, b.d.id),
};

/**
 * Results of a search over the documents the user may see, in the order of sortOf() (ties keep the order of `docs`,
 * most recently modified first); `tally(k)` counts the documents per value of facet `k` under every other criterion.
 * In memory: the reference of lib/queries.ts searchDocs, which the database runs (tests/support/search.ts compares
 * them).
 */
export function runSearch(docs: SearchDoc[], s: SearchInput) {
  const q = s.q?.trim() ?? '', facets = s.facets ?? {};
  const hits: Hit[] = [];
  for (const d of docs) {
    const sc = q ? score(d, q) : 0;
    if ((!q || sc > 0) && inPeriod(d, s.period)) hits.push({ d, score: sc });
  }
  const results = hits.filter((h) => passes(h.d, facets)).sort(COMPARE[sortOf(s)]).map((h) => h.d);
  const tallies = new Map<FacetKey, Map<string, number>>();
  const tally = (k: FacetKey): Map<string, number> => {
    let m = tallies.get(k);
    if (!m) {
      m = new Map();
      for (const h of hits) if (passes(h.d, facets, k)) for (const v of facetValues(h.d, k)) m.set(v, (m.get(v) ?? 0) + 1);
      tallies.set(k, m);
    }
    return m;
  };
  const count = (k: FacetKey, v: string) => tally(k).get(v) ?? 0;
  return { results, tally, count };
}
