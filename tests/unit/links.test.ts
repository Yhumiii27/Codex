import { describe, expect, it } from 'vitest';
import { DICT } from '@/lib/i18n';
import { inverseRel, isLinkRel, LINK_RELS, linkIssue, otherEnd, relOf, replacementIssue, replacementOutcome, storedLink } from '@/lib/links';

// Links between documents (point 16 of docs/reste-a-faire.md, docs/modele-cible.md §4): one oriented record per pair,
// « remplacé par » read from the target of a « remplace » link; only a document Vigie withdrew is replaced (D-17).

const OLD = 'PRO-QUA-0001', NEW = 'PRO-QUA-0002';
const withdrawn = (id: string, state = 'obsolete') => ({ id, state, obsoleteAt: '2026-10-01' });
const active = (id: string) => ({ id, state: 'active', obsoleteAt: null });

describe('storedLink and relOf', () => {
  it('stores « remplacé par » as a « remplace » link from the replacement: one record whichever record it is added from', () => {
    expect(storedLink(OLD, 'replaced_by', NEW)).toEqual({ sourceId: NEW, targetId: OLD, kind: 'replaces' });
    expect(storedLink(NEW, 'replaces', OLD)).toEqual({ sourceId: NEW, targetId: OLD, kind: 'replaces' });
    expect(storedLink(OLD, 'see_also', NEW)).toEqual({ sourceId: OLD, targetId: NEW, kind: 'see_also' });
  });

  it('reads the same record from each end', () => {
    const link = storedLink(OLD, 'replaced_by', NEW);
    expect(relOf(link, OLD)).toBe('replaced_by');
    expect(relOf(link, NEW)).toBe('replaces');
    expect(otherEnd(link, OLD)).toBe(NEW);
    expect(otherEnd(link, NEW)).toBe(OLD);
    const see = storedLink(OLD, 'see_also', NEW);
    expect([relOf(see, OLD), relOf(see, NEW)]).toEqual(['see_also', 'see_also']);
  });

  it('round-trips every kind: what one end stores, the other reads as its inverse', () => {
    for (const rel of LINK_RELS) {
      const link = storedLink(OLD, rel, NEW);
      expect(relOf(link, OLD), rel).toBe(rel);
      expect(relOf(link, NEW), rel).toBe(inverseRel(rel));
      expect(inverseRel(inverseRel(rel)), rel).toBe(rel);
    }
  });

  it('accepts only the three kinds', () => {
    expect(LINK_RELS.every(isLinkRel)).toBe(true);
    for (const x of ['', 'replace', 'annexe', null, 3]) expect(isLinkRel(x), String(x)).toBe(false);
  });
});

describe('linkIssue', () => {
  it('refuses a link of a document to itself, and a second link between two documents', () => {
    expect(linkIssue('see_also', active(OLD), active(OLD), false)).toBe('link_self');
    expect(linkIssue('see_also', active(OLD), active(NEW), true)).toBe('link_exists');
    expect(linkIssue('replaces', active(NEW), withdrawn(OLD), true)).toBe('link_exists');
  });

  it('only replaces a document Vigie withdrew (D-17): a document in force is replaced through a withdrawal request', () => {
    expect(linkIssue('replaces', active(NEW), active(OLD), false)).toBe('link_not_withdrawn');
    expect(linkIssue('replaced_by', active(OLD), active(NEW), false)).toBe('link_not_withdrawn');
    expect(linkIssue('replaces', active(NEW), withdrawn(OLD), false)).toBeNull();
    expect(linkIssue('replaced_by', withdrawn(OLD), active(NEW), false)).toBeNull();
    // Archived since its withdrawal, it still is « remplacé ».
    expect(linkIssue('replaced_by', withdrawn(OLD, 'archived'), active(NEW), false)).toBeNull();
    // « Voir aussi » has no such rule.
    expect(linkIssue('see_also', active(OLD), withdrawn(NEW), false)).toBeNull();
    expect(linkIssue('see_also', withdrawn(OLD), withdrawn(NEW), false)).toBeNull();
  });

  it('only lets an active document replace another, as a withdrawal request does: an obsolete or archived one replaces nothing', () => {
    expect(linkIssue('replaced_by', withdrawn(OLD), withdrawn(NEW), false)).toBe('link_replacer_inactive');
    expect(linkIssue('replaced_by', withdrawn(OLD), withdrawn(NEW, 'archived'), false)).toBe('link_replacer_inactive');
    expect(linkIssue('replaces', withdrawn(NEW), withdrawn(OLD), false)).toBe('link_replacer_inactive');
    // An archived document never withdrawn (no obsoleteAt) is neither replaced nor replaces.
    const archived = { id: NEW, state: 'archived', obsoleteAt: null };
    expect(linkIssue('replaces', archived, withdrawn(OLD), false)).toBe('link_replacer_inactive');
    expect(linkIssue('replaced_by', archived, active(OLD), false)).toBe('link_not_withdrawn');
  });
});

describe('replacementOutcome', () => {
  const free = { legalHold: false };
  const live = { state: 'active', legalHold: false };
  const replaces = (sourceId: string) => ({ sourceId, kind: 'replaces' as const });

  it('links an active replacement, a « voir aussi » between the two giving way to it', () => {
    expect(replacementOutcome(OLD, free, live, null)).toBe('link');
    expect(replacementOutcome(OLD, free, live, { sourceId: OLD, kind: 'see_also' })).toBe('link');
  });

  it('leaves a « remplacé par » already there as it is, whatever has become of the replacement since', () => {
    expect(replacementOutcome(OLD, free, live, replaces(NEW))).toBe('present');
    expect(replacementOutcome(OLD, free, { state: 'obsolete', legalHold: true }, replaces(NEW))).toBe('present');
  });

  it('skips a replacement no longer active or gone: it replaces nothing (checked again when the withdrawal applies)', () => {
    expect(replacementOutcome(OLD, free, { state: 'obsolete', legalHold: false }, null)).toBe('inactive');
    expect(replacementOutcome(OLD, free, { state: 'archived', legalHold: false }, null)).toBe('inactive');
    expect(replacementOutcome(OLD, free, null, null)).toBe('inactive');
    expect(replacementOutcome(OLD, free, { state: 'obsolete', legalHold: false }, replaces(OLD))).toBe('inactive');
  });

  it('touches no link while a legal hold freezes either document', () => {
    expect(replacementOutcome(OLD, free, { state: 'active', legalHold: true }, null)).toBe('hold');
    expect(replacementOutcome(OLD, free, { state: 'active', legalHold: true }, { sourceId: NEW, kind: 'see_also' })).toBe('hold');
    expect(replacementOutcome(OLD, { legalHold: true }, live, null)).toBe('hold');
  });

  it('never reverses a « remplace » link running the other way', () => {
    expect(replacementOutcome(OLD, free, live, replaces(OLD))).toBe('linked');
  });
});

describe('replacementIssue', () => {
  it('proposes an active document the requester may read, other than the one withdrawn', () => {
    expect(replacementIssue(OLD, { id: NEW, state: 'active' })).toBeNull();
    expect(replacementIssue(OLD, { id: OLD, state: 'active' })).toBe('link_self');
    expect(replacementIssue(OLD, { id: NEW, state: 'obsolete' })).toBe('replacement_inactive');
    expect(replacementIssue(OLD, { id: NEW, state: 'archived' })).toBe('replacement_inactive');
  });

  it('answers a document the requester may not read as one that does not exist', () => {
    expect(replacementIssue(OLD, null)).toBe('replacement_not_found');
  });
});

describe('wording', () => {
  it('names every kind in both languages, and the journal actions', () => {
    for (const lang of ['fr', 'en'] as const) {
      const t = DICT[lang];
      for (const rel of LINK_RELS) expect(t[`link_${rel}`], `${lang} ${rel}`).toBeTruthy();
      expect(t.act_link && t.act_unlink && t.act_link_skipped, lang).toBeTruthy();
      for (const why of ['inactive', 'hold', 'linked'] as const) expect(t[`link_skip_${why}`], `${lang} ${why}`).toBeTruthy();
    }
    expect(DICT.fr.link_replaced_by).toBe('Remplacé par');
  });
});
