import type { DocView } from './queries';

export const FACET_KEYS = ['project', 'family', 'type', 'origin', 'attachment', 'department', 'status', 'conf'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export type Facets = Partial<Record<FacetKey, string[]>>;

/** Reads `?q=…&type=PRO,NCR&department=QUA…` into a query and facet selection. */
export function parseSearch(sp: Record<string, string | string[] | undefined>): { q: string; facets: Facets } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(',') : v ?? '');
  const facets: Facets = {};
  for (const k of FACET_KEYS) {
    const vals = one(sp[k]).split(',').map((x) => x.trim()).filter(Boolean);
    if (vals.length) facets[k] = vals;
  }
  return { q: one(sp.q).trim(), facets };
}

export function searchHref(q: string, facets: Facets, base = '/recherche'): string {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  for (const k of FACET_KEYS) if (facets[k]?.length) p.set(k, facets[k]!.join(','));
  const qs = p.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

/** Longest query, facet value and number of values per facet a saved search keeps. */
const MAX_Q = 200, MAX_VALUE = 64, MAX_VALUES = 50;

/**
 * Criteria as a saved search keeps them, from untrusted input (a Server Action argument): the query trimmed, known
 * facets only, distinct non-empty text values without commas (the URL joins them with commas), within bounds.
 */
export function cleanCriteria(q: unknown, facets: unknown): { q: string; facets: Facets } {
  const src = facets && typeof facets === 'object' && !Array.isArray(facets) ? (facets as Record<string, unknown>) : {};
  const out: Facets = {};
  for (const k of FACET_KEYS) {
    const raw = Array.isArray(src[k]) ? (src[k] as unknown[]) : [];
    const vals = [...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v && !v.includes(',') && v.length <= MAX_VALUE))];
    if (vals.length) out[k] = vals.slice(0, MAX_VALUES);
  }
  return { q: typeof q === 'string' ? q.trim().slice(0, MAX_Q) : '', facets: out };
}

/** A query or at least one facet value. */
export function hasCriteria(q: string, facets: Facets): boolean {
  return !!q || FACET_KEYS.some((k) => !!facets[k]?.length);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Full-text match on title, ID (and former IDs), keywords, type, source organisation and external reference — accent-insensitive. */
export function matches(d: DocView, q: string): boolean {
  if (!q) return true;
  const n = fold(q);
  const fields = [d.title, d.id, ...d.aliases, ...d.keywords, d.typeLabel, d.sourceOrg ?? '', d.externalRef ?? '', d.subtype ?? ''];
  return fields.some((f) => fold(f).includes(n));
}

export function facetValue(d: DocView, k: FacetKey): string {
  switch (k) {
    case 'project': return d.projectCode ?? d.programCode ?? '';
    case 'type': return d.typeCode;
    case 'family': return d.family;
    case 'origin': return d.origin;
    case 'attachment': return d.attachment;
    case 'department': return d.department;
    case 'status': return d.status;
    case 'conf': return d.conf;
  }
}

/** Every facet filter except `skip` (used to count the options of `skip` itself). */
export function passes(d: DocView, facets: Facets, skip?: FacetKey): boolean {
  return FACET_KEYS.every((k) => k === skip || !facets[k]?.length || facets[k]!.includes(facetValue(d, k)));
}

export function runSearch(docs: DocView[], q: string, facets: Facets) {
  const results = docs.filter((d) => matches(d, q) && passes(d, facets));
  const count = (k: FacetKey, v: string) => docs.filter((d) => matches(d, q) && passes(d, facets, k) && facetValue(d, k) === v).length;
  return { results, count };
}
