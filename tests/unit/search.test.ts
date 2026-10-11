import { describe, expect, it } from 'vitest';
import { beyondBounds, cleanCriteria, cleanPeriod, dueOf, facetValues, hasCriteria, inPeriod, matches, parseSearch, runSearch, score, searchHref, sortOf, type Search, type SearchDoc } from '@/lib/search';

// Search screen: query, facets, period and order in the URL, accent-insensitive full-text match ranked by relevance.

/** The fields search reads; a SearchDoc has many more, which search never touches. */
type Searched = Pick<SearchDoc, 'id' | 'aliases' | 'title' | 'keywords' | 'typeLabel' | 'sourceOrg' | 'externalRef' | 'subtype'
  | 'projectCode' | 'programCode' | 'typeCode' | 'family' | 'origin' | 'attachment' | 'department' | 'status' | 'conf'
  | 'site' | 'ownerId' | 'owner' | 'authorId' | 'authorText' | 'author' | 'lang' | 'studyId' | 'projectPhase' | 'workPackage'
  | 'discipline' | 'researchTheme' | 'modifiedAt' | 'issuedAt' | 'effectiveAt' | 'reviewDueAt' | 'expiresAt'>;

const view = (over: Partial<Searched> = {}): SearchDoc => {
  const d: Searched = {
    id: 'PRO-QUA-0003', aliases: [], title: 'Maîtrise des documents', keywords: ['GED'], typeLabel: 'Procédure',
    sourceOrg: null, externalRef: null, subtype: null, projectCode: null, programCode: null, typeCode: 'PRO',
    family: 'qualite_qhse', origin: 'interne', attachment: 'none', department: 'QUA', status: 'in_force', conf: 'interne',
    site: null, ownerId: 'gcomte', owner: 'Gabriel Comte', authorId: 'gcomte', authorText: null, author: 'Gabriel Comte', lang: 'fr',
    studyId: null, projectPhase: null, workPackage: null, discipline: null, researchTheme: null,
    modifiedAt: '2026-09-01', issuedAt: '2026-01-15', effectiveAt: '2026-01-15', reviewDueAt: null, expiresAt: null,
    ...over,
  };
  return d as SearchDoc;
};

const none = { period: null, sort: null };
const ids = (docs: SearchDoc[]) => docs.map((d) => d.id);

describe('parseSearch', () => {
  it('reads the query and the facets of the URL', () => {
    expect(parseSearch({ q: '  ligne de vie ', type: 'PRO,NCR', department: 'QUA' })).toEqual({ q: 'ligne de vie', facets: { type: ['PRO', 'NCR'], department: ['QUA'] }, ...none });
  });

  it('joins repeated parameters, trims values and drops empty ones', () => {
    expect(parseSearch({ type: ['PRO', 'NCR,INS'], status: ' in_force , ,draft ', conf: '' })).toEqual({ q: '', facets: { type: ['PRO', 'NCR', 'INS'], status: ['in_force', 'draft'] }, ...none });
  });

  it('ignores parameters that are not facets', () => {
    expect(parseSearch({ sel: 'PRO-QUA-0003', tab: 'journal' })).toEqual({ q: '', facets: {}, ...none });
  });

  it('reads the new facets: site, owner, author, language, keywords, source organisation, context fields', () => {
    const sp = { site: 'lyon', owner: 'gcomte,cbardet', author: 'Nordvolt', lang: 'en', keywords: ['ATEX', 'zone 1'], source: 'AFNOR', subtype: 'Mode opératoire', phase: 'Etudes', lot: 'WP2', discipline: 'Procédé', theme: 'Matériaux' };
    expect(parseSearch(sp).facets).toEqual({
      site: ['lyon'], owner: ['gcomte', 'cbardet'], author: ['Nordvolt'], lang: ['en'], keywords: ['ATEX', 'zone 1'], source: ['AFNOR'],
      subtype: ['Mode opératoire'], phase: ['Etudes'], lot: ['WP2'], discipline: ['Procédé'], theme: ['Matériaux'],
    });
  });

  it('reads a free-text value whole, commas included; only coded facets split a parameter on commas', () => {
    expect(parseSearch({ source: 'Préfecture du Rhône, DDPP', author: ['Bureau Veritas, Lyon', 'INERIS'], keywords: 'ATEX, zone 1' }).facets)
      .toEqual({ source: ['Préfecture du Rhône, DDPP'], author: ['Bureau Veritas, Lyon', 'INERIS'], keywords: ['ATEX, zone 1'] });
    expect(parseSearch({ department: 'QUA,HSE', site: ['lyon', 'le_havre,paris'] }).facets).toEqual({ department: ['QUA', 'HSE'], site: ['lyon', 'le_havre', 'paris'] });
  });

  it('reads the parameters of a URL, repeated ones included', () => {
    const p = new URLSearchParams('q=pompe&source=A%2C+B&source=C&type=PRO&type=NCR&sort=id&q=autre');
    expect(parseSearch(p)).toEqual({ q: 'pompe', facets: { type: ['PRO', 'NCR'], source: ['A, B', 'C'] }, period: null, sort: 'id' });
  });

  it('reads the period: valid days only, bounds in order, the modification date by default', () => {
    expect(parseSearch({ date: 'issued', from: '2026-01-01', to: '2026-06-30' }).period).toEqual({ field: 'issued', from: '2026-01-01', to: '2026-06-30' });
    expect(parseSearch({ date: 'expiry', to: '2026-12-31' }).period).toEqual({ field: 'expiry', from: null, to: '2026-12-31' });
    expect(parseSearch({ from: '2026-06-30', to: '2026-01-01' }).period).toEqual({ field: 'modified', from: '2026-01-01', to: '2026-06-30' });
    expect(parseSearch({ date: 'birthday', from: '2026-02-03' }).period).toEqual({ field: 'modified', from: '2026-02-03', to: null });
    // A date without bounds, or bounds that are not days, select nothing.
    expect(parseSearch({ date: 'issued' }).period).toBeNull();
    expect(parseSearch({ date: 'issued', from: '2026-02-30', to: 'demain' }).period).toBeNull();
  });

  it('reads a known order only', () => {
    expect(parseSearch({ sort: 'title' }).sort).toBe('title');
    expect(parseSearch({ sort: 'size' }).sort).toBeNull();
  });

  it('round-trips through searchHref', () => {
    const s: Search = {
      q: 'échafaudage', facets: { project: ['HLT-026'], type: ['PRO', 'NCR'], conf: ['interne'], keywords: ['ATEX', 'zone 1'], owner: ['gcomte'] },
      period: { field: 'review', from: '2026-10-01', to: null }, sort: 'due',
    };
    const href = searchHref(s);
    expect(href.startsWith('/recherche?')).toBe(true);
    expect(parseSearch(new URLSearchParams(href.split('?')[1]))).toEqual(s);
    expect(searchHref({})).toBe('/recherche');
    expect(searchHref({}, '/explorateur')).toBe('/explorateur');
    expect(searchHref({ sort: 'id' })).toBe('/recherche?sort=id');
    // A period without bounds is not written.
    expect(searchHref({ period: { field: 'issued', from: null, to: null } })).toBe('/recherche');
  });

  it('writes one parameter per value, so that a value with a comma comes back whole', () => {
    const s: Search = { q: '', facets: { type: ['PRO', 'NCR'], source: ['Préfecture du Rhône, DDPP'], author: ['Bureau Veritas, agence de Lyon', 'INERIS'] }, period: null, sort: null };
    const href = searchHref(s);
    expect(href).toBe('/recherche?type=PRO&type=NCR&author=Bureau+Veritas%2C+agence+de+Lyon&author=INERIS&source=Pr%C3%A9fecture+du+Rh%C3%B4ne%2C+DDPP');
    expect(parseSearch(new URL(href, 'http://x').searchParams)).toEqual(s);
    // As the page receives them: one value as a string, several as a list.
    const page: Record<string, string | string[]> = {};
    for (const [k, v] of new URL(href, 'http://x').searchParams) page[k] = k in page ? [page[k]].flat().concat(v) : v;
    expect(parseSearch(page)).toEqual(s);
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

  it('searches the owner, the author and the study ID', () => {
    const d = view({ owner: 'Hélène Costa', author: 'Préfecture du Rhône', studyId: 'E-26-01' });
    for (const q of ['helene', 'costa', 'prefecture', 'e-26-01']) expect(matches(d, q), q).toBe(true);
  });

  it('does not match what no field contains', () => {
    expect(matches(view(), 'HLT-026')).toBe(false);
    expect(matches(view({ sourceOrg: null, externalRef: null, subtype: null }), 'null')).toBe(false);
  });
});

describe('score (relevance)', () => {
  it('is 0 without a match, and grows with how well a field holds the query', () => {
    expect(score(view(), 'ATEX')).toBe(0);
    const whole = score(view({ title: 'ATEX' }), 'atex');
    const word = score(view({ title: 'Procédure ATEX' }), 'atex');
    const inside = score(view({ title: 'Procédures antiATEX' }), 'atex');
    expect(whole).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it('weighs the ID over the title, the title over keywords, keywords over the other fields', () => {
    const q = 'atex';
    const byId = score(view({ id: 'ATEX', title: 'x', keywords: [] }), q);
    const byTitle = score(view({ title: 'ATEX', keywords: [] }), q);
    const byKeyword = score(view({ title: 'x', keywords: ['ATEX'] }), q);
    const byOwner = score(view({ title: 'x', keywords: [], owner: 'ATEX' }), q);
    expect(byId).toBeGreaterThan(byTitle);
    expect(byTitle).toBeGreaterThan(byKeyword);
    expect(byKeyword).toBeGreaterThan(byOwner);
    expect(byOwner).toBeGreaterThan(0);
  });

  it('adds up the fields that hold the query', () => {
    expect(score(view({ title: 'ATEX', keywords: ['ATEX'] }), 'atex')).toBeGreaterThan(score(view({ title: 'ATEX', keywords: [] }), 'atex'));
  });
});

describe('facets', () => {
  const docs = [
    view({ id: 'PID-HLT-026-001', typeCode: 'PID', attachment: 'project', projectCode: 'HLT-026', department: 'ING', title: 'Schéma de procédé', typeLabel: 'Schéma P&ID', keywords: ['A1410', 'LT-101'], projectPhase: 'Etudes', site: 'le_havre' }),
    view({ id: 'PRT-R2601-004', typeCode: 'PRT', attachment: 'research', programCode: 'R2601', department: 'RDI', title: 'Essai de procédure', typeLabel: 'Protocole', keywords: ['A1410'], researchTheme: 'Matériaux', lang: 'en' }),
    view({ id: 'PRO-QUA-0003' }),
    view({ id: 'PRO-HSE-0001', department: 'HSE', status: 'draft', conf: 'confidentiel', title: 'Procédure ATEX', site: 'lyon', ownerId: 'cbardet', owner: 'Claire Bardet', authorId: null, authorText: 'INERIS' }),
  ];

  it('reads the project facet from the project or the research programme', () => {
    expect(facetValues(docs[0], 'project')).toEqual(['HLT-026']);
    expect(facetValues(docs[1], 'project')).toEqual(['R2601']);
    expect(facetValues(docs[2], 'project')).toEqual([]);
  });

  it('reads several keywords, no value for an empty field, the author as the record shows it', () => {
    expect(facetValues(docs[0], 'keywords')).toEqual(['A1410', 'LT-101']);
    expect(facetValues(view({ keywords: ['A', 'A'] }), 'keywords')).toEqual(['A']);
    expect(facetValues(docs[2], 'site')).toEqual([]);
    expect(facetValues(docs[0], 'phase')).toEqual(['Etudes']);
    expect(facetValues(docs[1], 'theme')).toEqual(['Matériaux']);
    expect(facetValues(docs[3], 'author')).toEqual(['INERIS']);
    expect(facetValues(docs[2], 'author')).toEqual(['gcomte']);
    expect(facetValues(view({ authorId: null }), 'author')).toEqual(['gcomte']);
  });

  it('combines the query with every facet, and counts each option without its own facet', () => {
    const { results, count } = runSearch(docs, { q: 'procedure', facets: { type: ['PRO'], department: ['QUA'] } });
    expect(ids(results)).toEqual(['PRO-QUA-0003']);
    expect(count('department', 'HSE')).toBe(1);
    expect(count('department', 'QUA')).toBe(1);
    expect(count('type', 'PRO')).toBe(1);
    expect(count('type', 'PID')).toBe(0);
  });

  it('counts only the documents that match the query', () => {
    const { results, count } = runSearch(docs, { q: 'procedure', facets: {} });
    expect(ids(results).sort()).toEqual(['PRO-HSE-0001', 'PRO-QUA-0003', 'PRT-R2601-004']);
    expect(count('type', 'PRO')).toBe(2);
    expect(count('type', 'PID')).toBe(0);
    expect(count('project', 'R2601')).toBe(1);
  });

  it('keeps a document with any of the keywords chosen, and counts it under each of its keywords', () => {
    const { results, tally } = runSearch(docs, { facets: { keywords: ['LT-101', 'ATEX'] } });
    expect(ids(results)).toEqual(['PID-HLT-026-001']);
    expect(Object.fromEntries(tally('keywords'))).toEqual({ A1410: 2, 'LT-101': 1, GED: 2 });
    // Other facets are counted on the documents with the keywords chosen.
    expect(Object.fromEntries(tally('site'))).toEqual({ le_havre: 1 });
  });

  it('combines two new facets with the others', () => {
    const { results, tally } = runSearch(docs, { facets: { site: ['lyon', 'le_havre'], owner: ['gcomte'] } });
    expect(ids(results)).toEqual(['PID-HLT-026-001']);
    expect(Object.fromEntries(tally('owner'))).toEqual({ gcomte: 1, cbardet: 1 });
    expect(Object.fromEntries(tally('lang'))).toEqual({ fr: 1 });
  });

  it('applies the period to the results and to every count', () => {
    const dated = [
      view({ id: 'A', issuedAt: '2026-01-10', site: 'lyon' }),
      view({ id: 'B', issuedAt: '2026-03-01', site: 'lyon' }),
      view({ id: 'C', issuedAt: null, site: 'lyon' }),
    ];
    const { results, count } = runSearch(dated, { facets: {}, period: { field: 'issued', from: '2026-01-01', to: '2026-01-31' } });
    expect(ids(results)).toEqual(['A']);
    expect(count('site', 'lyon')).toBe(1);
  });
});

describe('period', () => {
  const d = view({ modifiedAt: '2026-09-01', issuedAt: '2026-01-15', effectiveAt: '2026-02-01', reviewDueAt: '2027-01-15', expiresAt: null });

  it('bears on the date chosen, bounds included, one of them possibly open', () => {
    expect(inPeriod(d, { field: 'issued', from: '2026-01-15', to: '2026-01-15' })).toBe(true);
    expect(inPeriod(d, { field: 'issued', from: '2026-01-16', to: null })).toBe(false);
    expect(inPeriod(d, { field: 'effective', from: null, to: '2026-02-01' })).toBe(true);
    expect(inPeriod(d, { field: 'review', from: '2027-01-01', to: '2027-01-31' })).toBe(true);
    expect(inPeriod(d, { field: 'modified', from: '2026-10-01', to: null })).toBe(false);
  });

  it('never keeps a document without the date', () => {
    expect(inPeriod(d, { field: 'expiry', from: null, to: '2099-12-31' })).toBe(false);
  });

  it('keeps everything without a period', () => {
    expect(inPeriod(d, null)).toBe(true);
    expect(inPeriod(d, { field: 'expiry', from: null, to: null })).toBe(true);
  });

  it('is cleaned from untrusted values', () => {
    expect(cleanPeriod('issued', '2026-05-01', '2026-04-01')).toEqual({ field: 'issued', from: '2026-04-01', to: '2026-05-01' });
    expect(cleanPeriod(3, '2026-05-01', null)).toEqual({ field: 'modified', from: '2026-05-01', to: null });
    expect(cleanPeriod('issued', '', 7)).toBeNull();
  });
});

describe('sort', () => {
  const docs = [
    view({ id: 'PRO-QUA-0010', title: 'beta', modifiedAt: '2026-09-20', issuedAt: '2025-01-01', reviewDueAt: null, expiresAt: null }),
    view({ id: 'PRO-QUA-0002', title: 'Alpha', modifiedAt: '2026-09-10', issuedAt: null, reviewDueAt: '2026-12-01', expiresAt: '2026-11-01' }),
    view({ id: 'PRO-QUA-0003', title: 'Étude', modifiedAt: '2026-09-15', issuedAt: '2026-06-01', reviewDueAt: '2026-10-20', expiresAt: null }),
  ];
  const sorted = (sort: Search['sort'], q = '') => ids(runSearch(docs, { q, facets: {}, sort }).results);

  it('defaults to relevance with a query, to the most recently modified first without', () => {
    expect(sortOf({ q: 'pompe' })).toBe('relevance');
    expect(sortOf({ q: '' })).toBe('modified');
    expect(sortOf({ q: 'pompe', sort: 'title' })).toBe('title');
    expect(sorted(null)).toEqual(['PRO-QUA-0010', 'PRO-QUA-0003', 'PRO-QUA-0002']);
  });

  it('orders by issue date, newest first, documents without one last', () => {
    expect(sorted('issued')).toEqual(['PRO-QUA-0003', 'PRO-QUA-0010', 'PRO-QUA-0002']);
  });

  it('orders by next due date (review or expiry), soonest first, documents without one last', () => {
    expect(dueOf(docs[1])).toBe('2026-11-01');
    expect(sorted('due')).toEqual(['PRO-QUA-0003', 'PRO-QUA-0002', 'PRO-QUA-0010']);
  });

  it('orders by ID (numbers in order) and by title (accents and case ignored)', () => {
    expect(sorted('id')).toEqual(['PRO-QUA-0002', 'PRO-QUA-0003', 'PRO-QUA-0010']);
    expect(sorted('title')).toEqual(['PRO-QUA-0002', 'PRO-QUA-0010', 'PRO-QUA-0003']);
  });

  it('orders by relevance, then the most recently modified first', () => {
    const hits = [
      view({ id: 'X-1', title: 'Pompe doseuse', keywords: [], modifiedAt: '2026-09-01' }),
      view({ id: 'X-2', title: 'Plan', keywords: ['pompe'], modifiedAt: '2026-09-30' }),
      view({ id: 'X-3', title: 'Pompe', keywords: [], modifiedAt: '2026-08-01' }),
      view({ id: 'X-4', title: 'Pompe à chaleur', keywords: [], modifiedAt: '2026-09-15' }),
    ];
    // The whole title, then the whole keyword, then a word of the title: X-4 and X-1 tie, the more recent first.
    expect(ids(runSearch(hits, { q: 'pompe', facets: {} }).results)).toEqual(['X-3', 'X-2', 'X-4', 'X-1']);
    // Chosen explicitly, another order replaces relevance.
    expect(ids(runSearch(hits, { q: 'pompe', facets: {}, sort: 'modified' }).results)).toEqual(['X-2', 'X-4', 'X-1', 'X-3']);
  });
});

describe('cleanCriteria (saved searches)', () => {
  it('keeps the query, the facets, the period and the order of the URL', () => {
    expect(cleanCriteria({ q: ' ligne de vie ', facets: { type: ['PRO', 'NCR'], status: ['in_force'], keywords: ['ATEX'] }, period: { field: 'issued', from: '2026-01-01', to: null }, sort: 'title' }))
      .toEqual({ q: 'ligne de vie', facets: { type: ['PRO', 'NCR'], status: ['in_force'], keywords: ['ATEX'] }, period: { field: 'issued', from: '2026-01-01', to: null }, sort: 'title' });
  });

  it('drops unknown facets, non-text and empty values, duplicates and a comma in a code', () => {
    expect(cleanCriteria({ q: '', facets: { type: ['PRO', ' PRO ', '', 3, 'A,B'], colour: ['red'], status: 'in_force', conf: [] } })).toEqual({ q: '', facets: { type: ['PRO'] }, ...none });
  });

  it('keeps a free-text value with a comma, and as long as the import accepts', () => {
    const long = `Direction régionale de l’environnement, de l’aménagement et du logement ${'x'.repeat(200)}`.slice(0, 300);
    const c = cleanCriteria({ q: '', facets: { source: [long], author: ['Préfecture du Rhône, DDPP'] } });
    expect(c.facets).toEqual({ source: [long], author: ['Préfecture du Rhône, DDPP'] });
    expect(hasCriteria(c)).toBe(true);
    expect(parseSearch(new URL(searchHref(c), 'http://x').searchParams)).toEqual(c);
  });

  it('drops an unknown order and an invalid period', () => {
    expect(cleanCriteria({ q: 'x', facets: {}, period: { field: 'issued', from: 'hier', to: 12 }, sort: 'size' })).toEqual({ q: 'x', facets: {}, ...none });
    expect(cleanCriteria({ q: 'x', period: 'issued', sort: 3 })).toEqual({ q: 'x', facets: {}, ...none });
  });

  it('reads anything else as no criterion, and bounds the lengths', () => {
    expect(cleanCriteria(42)).toEqual({ q: '', facets: {}, ...none });
    expect(cleanCriteria(null)).toEqual({ q: '', facets: {}, ...none });
    expect(cleanCriteria({ q: 3, facets: ['PRO'] })).toEqual({ q: '', facets: {}, ...none });
    const long = cleanCriteria({ q: 'x'.repeat(500), facets: { type: [...Array(80).keys()].map((i) => `T${i}`), status: ['y'.repeat(301)], source: ['z'.repeat(300)] } });
    expect(long.q).toHaveLength(200);
    expect(long.facets.type).toHaveLength(50);
    expect(long.facets.status).toBeUndefined();
    expect(long.facets.source).toEqual(['z'.repeat(300)]);
  });

  it('round-trips through the URL of the search screen', () => {
    const c = cleanCriteria({ q: 'pompe', facets: { department: ['QUA'], origin: ['externe'], site: ['lyon'] }, period: { field: 'expiry', from: null, to: '2026-12-31' }, sort: 'due' });
    const back = parseSearch(new URL(searchHref(c), 'http://x').searchParams);
    expect(back).toEqual(c);
  });
});

describe('beyondBounds (saved searches)', () => {
  it('flags what a saved search would cut: a longer query, a longer value, too many values in a facet', () => {
    expect(beyondBounds({ q: 'x'.repeat(200), facets: { source: ['y'.repeat(300)], type: [...Array(50).keys()].map((i) => `T${i}`) } })).toBe(false);
    expect(beyondBounds({ q: ` ${'x'.repeat(200)} `, facets: {} })).toBe(false);
    expect(beyondBounds({ q: 'x'.repeat(201), facets: {} })).toBe(true);
    expect(beyondBounds({ q: '', facets: { source: ['y'.repeat(301)] } })).toBe(true);
    expect(beyondBounds({ q: '', facets: { type: [...Array(51).keys()].map((i) => `T${i}`) } })).toBe(true);
  });

  it('ignores what cleanCriteria drops anyway: unknown facets, duplicates, non-text values', () => {
    expect(beyondBounds({ q: '', facets: { colour: ['y'.repeat(400)], type: [...Array(60).fill('PRO'), 3] } })).toBe(false);
    expect(beyondBounds(null)).toBe(false);
  });
});

describe('hasCriteria', () => {
  it('needs a query, a facet value or a period; an order alone is no criterion', () => {
    expect(hasCriteria({ q: '', facets: {} })).toBe(false);
    expect(hasCriteria({ q: '', facets: { type: [] } })).toBe(false);
    expect(hasCriteria({ q: '', facets: {}, sort: 'title' })).toBe(false);
    expect(hasCriteria({ q: '', facets: {}, period: { field: 'issued', from: null, to: null } })).toBe(false);
    expect(hasCriteria({ q: 'pompe', facets: {} })).toBe(true);
    expect(hasCriteria({ q: '', facets: { type: ['PRO'] } })).toBe(true);
    expect(hasCriteria({ q: '', facets: {}, period: { field: 'issued', from: '2026-01-01', to: null } })).toBe(true);
  });
});
