import { describe, expect, it } from 'vitest';
import type { DocView } from '@/lib/queries';
import { facetValue, matches, parseSearch, runSearch, searchHref } from '@/lib/search';

// Search screen: query and facets in the URL, accent-insensitive full-text match.

/** The fields search reads; a DocView has many more, which search never touches. */
type Searched = Pick<DocView, 'id' | 'aliases' | 'title' | 'keywords' | 'typeLabel' | 'sourceOrg' | 'externalRef' | 'subtype'
  | 'projectCode' | 'programCode' | 'typeCode' | 'family' | 'origin' | 'attachment' | 'department' | 'status' | 'conf'>;

const view = (over: Partial<Searched> = {}): DocView => {
  const d: Searched = {
    id: 'PRO-QUA-0003', aliases: [], title: 'Maîtrise des documents', keywords: ['GED'], typeLabel: 'Procédure',
    sourceOrg: null, externalRef: null, subtype: null, projectCode: null, programCode: null, typeCode: 'PRO',
    family: 'qualite_qhse', origin: 'interne', attachment: 'none', department: 'QUA', status: 'in_force', conf: 'interne',
    ...over,
  };
  return d as DocView;
};

describe('parseSearch', () => {
  it('reads the query and the facets of the URL', () => {
    expect(parseSearch({ q: '  ligne de vie ', type: 'PRO,NCR', department: 'QUA' })).toEqual({ q: 'ligne de vie', facets: { type: ['PRO', 'NCR'], department: ['QUA'] } });
  });

  it('joins repeated parameters, trims values and drops empty ones', () => {
    expect(parseSearch({ type: ['PRO', 'NCR,INS'], status: ' in_force , ,draft ', conf: '' })).toEqual({ q: '', facets: { type: ['PRO', 'NCR', 'INS'], status: ['in_force', 'draft'] } });
  });

  it('ignores parameters that are not facets', () => {
    expect(parseSearch({ sel: 'PRO-QUA-0003', tab: 'journal' })).toEqual({ q: '', facets: {} });
  });

  it('round-trips through searchHref', () => {
    const facets = { project: ['HLT-026'], type: ['PRO', 'NCR'], conf: ['interne'] };
    const href = searchHref('échafaudage', facets);
    expect(href.startsWith('/recherche?')).toBe(true);
    expect(parseSearch(Object.fromEntries(new URLSearchParams(href.split('?')[1])))).toEqual({ q: 'échafaudage', facets });
    expect(searchHref('', {})).toBe('/recherche');
    expect(searchHref('', {}, '/explorateur')).toBe('/explorateur');
  });
});

describe('matches', () => {
  it('matches everything for an empty query', () => {
    expect(matches(view(), '')).toBe(true);
  });

  it('ignores case and accents, on both sides', () => {
    expect(matches(view(), 'maitrise')).toBe(true);
    expect(matches(view(), 'MAÎTRISE DES')).toBe(true);
    expect(matches(view({ title: 'Plan de prevention' }), 'prévention')).toBe(true);
  });

  it('searches the ID and the former IDs kept as aliases (reclassification, D-10)', () => {
    const d = view({ id: 'PRO-HSE-0003', aliases: ['PRO-QUA-0003'] });
    expect(matches(d, 'pro-hse-0003')).toBe(true);
    expect(matches(d, 'PRO-QUA-0003')).toBe(true);
  });

  it('searches keywords, type, source organisation, external reference and subtype', () => {
    const d = view({ keywords: ['ATEX', 'zone 1'], sourceOrg: 'AFNOR', externalRef: 'NF EN 60079', subtype: 'Mode opératoire' });
    for (const q of ['atex', 'Zone 1', 'procedure', 'afnor', '60079', 'mode operatoire']) expect(matches(d, q), q).toBe(true);
  });

  it('does not match what no field contains', () => {
    expect(matches(view(), 'HLT-026')).toBe(false);
    expect(matches(view({ sourceOrg: null, externalRef: null, subtype: null }), 'null')).toBe(false);
  });
});

describe('facets', () => {
  const docs = [
    view({ id: 'PID-HLT-026-001', typeCode: 'PID', attachment: 'project', projectCode: 'HLT-026', department: 'ING', title: 'Schéma de procédé', typeLabel: 'Schéma P&ID' }),
    view({ id: 'PRT-R2601-004', typeCode: 'PRT', attachment: 'research', programCode: 'R2601', department: 'RDI', title: 'Essai de procédure', typeLabel: 'Protocole' }),
    view({ id: 'PRO-QUA-0003' }),
    view({ id: 'PRO-HSE-0001', department: 'HSE', status: 'draft', conf: 'confidentiel', title: 'Procédure ATEX' }),
  ];

  it('reads the project facet from the project or the research programme', () => {
    expect(facetValue(docs[0], 'project')).toBe('HLT-026');
    expect(facetValue(docs[1], 'project')).toBe('R2601');
    expect(facetValue(docs[2], 'project')).toBe('');
  });

  it('combines the query with every facet, and counts each option without its own facet', () => {
    const { results, count } = runSearch(docs, 'procedure', { type: ['PRO'], department: ['QUA'] });
    expect(results.map((d) => d.id)).toEqual(['PRO-QUA-0003']);
    expect(count('department', 'HSE')).toBe(1);
    expect(count('department', 'QUA')).toBe(1);
    expect(count('type', 'PRO')).toBe(1);
    expect(count('type', 'PID')).toBe(0);
  });

  it('counts only the documents that match the query', () => {
    const { results, count } = runSearch(docs, 'procedure', {});
    expect(results.map((d) => d.id)).toEqual(['PRT-R2601-004', 'PRO-QUA-0003', 'PRO-HSE-0001']);
    expect(count('type', 'PRO')).toBe(2);
    expect(count('type', 'PID')).toBe(0);
    expect(count('project', 'R2601')).toBe(1);
  });
});
