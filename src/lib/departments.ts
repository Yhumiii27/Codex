import { FACET_KEYS, facetValues, searchHref, type FacetKey } from './search';
import type { DocView } from './queries';

// Department pages (/departements/[code], G12, FON-06): what the page of a department puts forward. Departments are
// provisional until the organisation chart (O-04); the facets each one puts forward await the survey of each
// department's needs (deck, slide 9), not made yet: until then, every department follows DEFAULT_FEATURED unless
// Administration › Organisation sets its own.

/** Facets a department page may put forward: every facet of /recherche but the department itself. */
export const FEATURABLE: readonly FacetKey[] = FACET_KEYS.filter((k) => k !== 'department');

/** Facets put forward by a department that has none set (departments.featured null). */
export const DEFAULT_FEATURED: readonly FacetKey[] = ['type', 'status', 'project'];

/** Most facets a department page puts forward. */
export const MAX_FEATURED = 6;

/** Values shown per featured facet, the most frequent first; /recherche lists them all. */
export const VALUES_SHOWN = 6;

const featurable = (k: unknown): k is FacetKey => typeof k === 'string' && (FEATURABLE as readonly string[]).includes(k);

/** The facets a department's page puts forward, in order: its own, else the default ones. */
export function featuredOf(d: { featured: string[] | null }): FacetKey[] {
  return d.featured == null ? [...DEFAULT_FEATURED] : d.featured.filter(featurable);
}

/**
 * Featured facets from untrusted input (a Server Action argument): null to follow the default ones again, or a list
 * of featurable facets, distinct, at most MAX_FEATURED, kept in the order given (an empty list puts none forward).
 * Anything else is refused (undefined) rather than cut down.
 */
export function cleanFeatured(input: unknown): FacetKey[] | null | undefined {
  if (input === null) return null;
  if (!Array.isArray(input) || input.length > MAX_FEATURED || !input.every(featurable)) return undefined;
  return new Set(input).size === input.length ? [...input] : undefined;
}

/** The department a page opens on when none is named (/departements): the user's own, else the first one. */
export function defaultDepartment(userDepartment: string | null, departments: readonly { code: string }[]): string | null {
  return departments.find((d) => d.code === userDepartment)?.code ?? departments[0]?.code ?? null;
}

export type FeaturedValue = { value: string; label: string; count: number; href: string };
export type FeaturedFilter = { key: FacetKey; values: FeaturedValue[]; more: number };

/**
 * The featured filters of a department's page, over `docs` (the documents the user may read): for each facet, its
 * values in the department's documents with their counts, the most frequent first (then by label), VALUES_SHOWN at
 * most (`more`: how many others). Each value links to /recherche filtered on the department and that value, whose
 * results are the very documents counted. A facet without any value there is left out, as in /recherche.
 */
export function featuredFilters(
  docs: readonly DocView[], department: string, keys: readonly FacetKey[], label: (k: FacetKey, v: string) => string, lang = 'fr',
): FeaturedFilter[] {
  const own = docs.filter((d) => d.department === department);
  return keys.flatMap((k) => {
    const counts = new Map<string, number>();
    for (const d of own) for (const v of facetValues(d, k)) counts.set(v, (counts.get(v) ?? 0) + 1);
    const values = [...counts]
      .map(([value, count]) => ({ value, label: label(k, value), count, href: searchHref({ facets: { department: [department], [k]: [value] } }) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, lang));
    return values.length ? [{ key: k, values: values.slice(0, VALUES_SHOWN), more: Math.max(0, values.length - VALUES_SHOWN) }] : [];
  });
}
