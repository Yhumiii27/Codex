import { describe, expect, it } from 'vitest';
import { canonicalSubtype, cleanTerm, docLang, findTerm, similarTerms, termKeys, termNameIssue, vocabKey } from '@/lib/vocab-rules';

// Controlled vocabularies (point 59 of docs/reste-a-faire.md, MET-07, G32, G40): what two spellings of one term share,
// which term a value stands for, the terms a new value may duplicate, the names a term may take; the sub-type list stays
// open (MET-17, O-05 point 9); the language is fr, en or none.

const terms = [
  { id: 1, name: 'Siemens', aliases: ['SIEMENS SAS'] },
  { id: 2, name: 'Bureau Veritas', aliases: [] },
  { id: 3, name: 'Électricité de France', aliases: [] },
];

describe('cleanTerm and vocabKey', () => {
  it('collapses blanks, trims, and sets case, accents and blanks aside for the key', () => {
    expect(cleanTerm('  Bureau   Veritas\t')).toBe('Bureau Veritas');
    expect(vocabKey(' ÉLECTRICITÉ  de   france ')).toBe('electricite de france');
    expect(vocabKey('Siemens')).toBe(vocabKey('SIEMENS'));
    expect(vocabKey('Siemens')).not.toBe(vocabKey('Siemens SAS'));
    expect(vocabKey('   ')).toBe('');
  });
});

describe('findTerm and termKeys', () => {
  it('finds the term of a spelling of its name or of an alias', () => {
    expect(findTerm(terms, 'siemens')?.id).toBe(1);
    expect(findTerm(terms, 'Siemens  sas')?.id).toBe(1);
    expect(findTerm(terms, 'electricite de France')?.id).toBe(3);
    expect(findTerm(terms, 'Siemens AG')).toBeUndefined();
    expect(findTerm(terms, '')).toBeUndefined();
    expect(termKeys(terms[0])).toEqual(['siemens', 'siemens sas']);
  });
});

describe('similarTerms', () => {
  it('offers the terms a new value may be another spelling of', () => {
    expect(similarTerms(terms, 'Siemens AG').map((x) => x.id)).toEqual([1]);
    expect(similarTerms(terms, 'BUREAU VERITAS FRANCE').map((x) => x.id)).toEqual([2]);
    expect(similarTerms(terms, 'Veritas').map((x) => x.id)).toEqual([2]);
    expect(similarTerms(terms, 'Nordvolt')).toEqual([]);
    expect(similarTerms(terms, '')).toEqual([]);
  });

  it('leaves out short pieces inside a word', () => {
    expect(similarTerms([{ name: 'EDF' }], 'Fedora')).toEqual([]);
  });
});

describe('termNameIssue', () => {
  it('refuses an empty name, a name too long and another term’s spelling', () => {
    expect(termNameIssue('source_org', terms, '  ')).toBe('vocab_name_required');
    expect(termNameIssue('keyword', terms, 'x'.repeat(101))).toBe('vocab_name_too_long');
    expect(termNameIssue('source_org', terms, 'BUREAU veritas')).toBe('vocab_name_taken');
    expect(termNameIssue('source_org', terms, 'siemens sas')).toBe('vocab_name_taken');
    expect(termNameIssue('source_org', terms, 'Nordvolt')).toBeNull();
  });

  it('lets a term take back one of its own spellings', () => {
    expect(termNameIssue('source_org', terms, 'SIEMENS SAS', 1)).toBeNull();
    expect(termNameIssue('source_org', terms, 'Bureau Veritas', 1)).toBe('vocab_name_taken');
  });
});

describe('canonicalSubtype', () => {
  const subtypes = [{ fr: 'Procédure opérationnelle', en: 'Operating procedure' }];
  it('takes the type’s spelling, in French or English, and keeps any other value (the list stays open)', () => {
    expect(canonicalSubtype(subtypes, 'PROCEDURE  operationnelle')).toEqual({ value: 'Procédure opérationnelle', listed: true });
    expect(canonicalSubtype(subtypes, 'operating procedure')).toEqual({ value: 'Operating procedure', listed: true });
    expect(canonicalSubtype(subtypes, ' Mode  opératoire ')).toEqual({ value: 'Mode opératoire', listed: false });
    expect(canonicalSubtype(subtypes, '  ')).toEqual({ value: null, listed: true });
    expect(canonicalSubtype(subtypes, null)).toEqual({ value: null, listed: true });
  });
});

describe('docLang', () => {
  it('reads fr, en or none, and nothing else', () => {
    expect(docLang('fr')).toBe('fr');
    expect(docLang(' EN ')).toBe('en');
    expect(docLang('')).toBeNull();
    expect(docLang(null)).toBeNull();
    expect(docLang('de')).toBeUndefined();
    expect(docLang('français')).toBeUndefined();
  });
});
