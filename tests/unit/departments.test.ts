import { describe, expect, it } from 'vitest';
import { cleanFeatured, DEFAULT_FEATURED, defaultDepartment, FEATURABLE, featuredFilters, featuredOf, MAX_FEATURED, VALUES_SHOWN } from '@/lib/departments';
import type { DocView } from '@/lib/queries';
import { FACET_KEYS, parseSearch, type FacetKey } from '@/lib/search';

// Department pages (G12, FON-06): the facets a department page puts forward and the links they give to /recherche.

/** The fields the featured filters read; a DocView has many more. */
type Read = Pick<DocView, 'id' | 'department' | 'typeCode' | 'status' | 'projectCode' | 'programCode' | 'keywords' | 'ownerId'>;
const view = (over: Partial<Read> = {}): DocView =>
  ({ id: 'PRO-QUA-0001', department: 'QUA', typeCode: 'PRO', status: 'in_force', projectCode: null, programCode: null, keywords: [], ownerId: 'gcomte', ...over }) as DocView;
const label = (k: FacetKey, v: string) => `${k}:${v}`;

describe('featured facets of a department', () => {
  it('are the default ones until the department has its own', () => {
    expect(featuredOf({ featured: null })).toEqual(['type', 'status', 'project']);
    expect(featuredOf({ featured: ['keywords', 'owner'] })).toEqual(['keywords', 'owner']);
    expect(featuredOf({ featured: [] })).toEqual([]);
  });

  it('never put the department itself forward, nor an unknown facet', () => {
    expect(FEATURABLE).not.toContain('department');
    expect(FEATURABLE).toEqual(FACET_KEYS.filter((k) => k !== 'department'));
    expect(DEFAULT_FEATURED.every((k) => FEATURABLE.includes(k))).toBe(true);
    expect(featuredOf({ featured: ['department', 'type', 'nope'] })).toEqual(['type']);
  });
});

describe('cleanFeatured (setting from Administration)', () => {
  it('keeps known facets in the order given, or null to follow the default ones again', () => {
    expect(cleanFeatured(['owner', 'type', 'keywords'])).toEqual(['owner', 'type', 'keywords']);
    expect(cleanFeatured([])).toEqual([]);
    expect(cleanFeatured(null)).toBeNull();
    expect(cleanFeatured(FEATURABLE.slice(0, MAX_FEATURED))).toHaveLength(MAX_FEATURED);
  });

  it('refuses rather than cuts down anything else', () => {
    expect(cleanFeatured(FEATURABLE.slice(0, MAX_FEATURED + 1))).toBeUndefined();
    expect(cleanFeatured(['type', 'type'])).toBeUndefined();
    expect(cleanFeatured(['type', 'department'])).toBeUndefined();
    expect(cleanFeatured(['type', 'unknown'])).toBeUndefined();
    expect(cleanFeatured(['type', 3])).toBeUndefined();
    expect(cleanFeatured('type')).toBeUndefined();
    expect(cleanFeatured(undefined)).toBeUndefined();
    expect(cleanFeatured({ 0: 'type' })).toBeUndefined();
  });
});

describe('defaultDepartment (/departements)', () => {
  const departments = [{ code: 'DIR' }, { code: 'ING' }, { code: 'HSE' }];
  it('opens the user’s department, else the first one', () => {
    expect(defaultDepartment('HSE', departments)).toBe('HSE');
    expect(defaultDepartment(null, departments)).toBe('DIR');
    expect(defaultDepartment('XXX', departments)).toBe('DIR');
    expect(defaultDepartment('HSE', [])).toBeNull();
  });
});

describe('featuredFilters', () => {
  const docs = [
    view({ id: 'a', typeCode: 'PRO', projectCode: 'HLT-026', keywords: ['ATEX', 'levage'] }),
    view({ id: 'b', typeCode: 'NCR', projectCode: 'HLT-026', keywords: ['ATEX'] }),
    view({ id: 'c', typeCode: 'NCR', status: 'draft' }),
    view({ id: 'd', typeCode: 'NCR' }),
    // Another department's documents are never counted.
    view({ id: 'e', department: 'ING', typeCode: 'PRO', projectCode: 'NDC-031', keywords: ['ATEX'] }),
  ];

  it('count the values in the department’s documents only, the most frequent first', () => {
    const [type, status, project] = featuredFilters(docs, 'QUA', ['type', 'status', 'project'], label);
    expect(type.values.map((v) => [v.value, v.count])).toEqual([['NCR', 3], ['PRO', 1]]);
    expect(status.values.map((v) => [v.value, v.count])).toEqual([['in_force', 3], ['draft', 1]]);
    expect(project.values.map((v) => [v.value, v.count])).toEqual([['HLT-026', 2]]);
    expect(type.values[0].label).toBe('type:NCR');
  });

  it('count each keyword of a document', () => {
    const [kw] = featuredFilters(docs, 'QUA', ['keywords'], label);
    expect(kw.values.map((v) => [v.value, v.count])).toEqual([['ATEX', 2], ['levage', 1]]);
  });

  it('link each value to /recherche filtered on the department and that value', () => {
    const [type] = featuredFilters(docs, 'QUA', ['type'], label);
    expect(type.values[0].href).toBe('/recherche?type=NCR&department=QUA');
    expect(parseSearch(new URL(type.values[0].href, 'http://codex').searchParams).facets).toEqual({ type: ['NCR'], department: ['QUA'] });
  });

  it('keep the order of the facets set, and leave out a facet without value there', () => {
    expect(featuredFilters(docs, 'QUA', ['project', 'source', 'type'], label).map((f) => f.key)).toEqual(['project', 'type']);
    expect(featuredFilters(docs, 'HSE', ['type'], label)).toEqual([]);
    expect(featuredFilters(docs, 'QUA', [], label)).toEqual([]);
  });

  it('show VALUES_SHOWN values at most and count the others', () => {
    const many = Array.from({ length: VALUES_SHOWN + 2 }, (_, i) => view({ id: `k${i}`, keywords: [`kw${i}`] }));
    const [kw] = featuredFilters(many, 'QUA', ['keywords'], label);
    expect(kw.values).toHaveLength(VALUES_SHOWN);
    expect(kw.more).toBe(2);
  });
});
