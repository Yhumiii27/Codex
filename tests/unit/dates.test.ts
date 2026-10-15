import { describe, expect, it } from 'vitest';
import { dateIssues, dateIssueText, effectIssue, inForceEffect, issueFrom, latestEffect, type DateRule, type DocDates } from '@/lib/dates';
import { DICT } from '@/lib/i18n';

// Coherence of a document's dates (docs/audit-deck-epc2i.md §4.6, rule 12: issue ≤ effect ≤ expiry; point 3 of
// docs/reste-a-faire.md): expiry after the issue and after the revision's effective date, review after the issue,
// reception neither in the future nor after the issue (the issue date is the first entry into force, docs/api.md).

const TODAY = '2026-10-10';
const doc = (over: Partial<DocDates> = {}): DocDates => ({
  issuedAt: '2026-03-01', effective: { letter: 'B', at: '2026-06-01' }, reviewDueAt: null, expiresAt: null, receivedAt: null, ...over,
});
const rules = (d: DocDates) => dateIssues(d, TODAY).map((i) => [i.field, i.rule, i.ref]);

describe('dateIssues', () => {
  it('accepts coherent dates, and missing ones', () => {
    expect(rules(doc({ expiresAt: '2027-03-01', reviewDueAt: '2027-01-01', receivedAt: '2026-02-20' }))).toEqual([]);
    expect(rules(doc())).toEqual([]);
    expect(rules({ issuedAt: null, effective: null, reviewDueAt: '2020-01-01', expiresAt: '2020-01-01', receivedAt: '2020-01-01' })).toEqual([]);
  });

  it('wants the expiry after the issue date, the same day being too early', () => {
    expect(rules(doc({ expiresAt: '2026-02-28' }))).toEqual([['expiresAt', 'expires_before_issued', '2026-03-01']]);
    expect(rules(doc({ expiresAt: '2026-03-01' }))).toEqual([['expiresAt', 'expires_before_issued', '2026-03-01']]);
  });

  it('wants the expiry after the effective date of the revision', () => {
    expect(rules(doc({ expiresAt: '2026-05-31' }))).toEqual([['expiresAt', 'expires_before_effective', '2026-06-01']]);
    expect(rules(doc({ expiresAt: '2026-06-01' }))).toEqual([['expiresAt', 'expires_before_effective', '2026-06-01']]);
    expect(dateIssues(doc({ expiresAt: '2026-06-01' }), TODAY)[0].letter).toBe('B');
    // Not yet in force: only the revision's effective date bounds it.
    expect(rules(doc({ issuedAt: null, effective: { letter: 'A', at: '2026-11-02' }, expiresAt: '2026-11-01' }))).toEqual([['expiresAt', 'expires_before_effective', '2026-11-02']]);
    expect(rules(doc({ expiresAt: '2026-06-02' }))).toEqual([]);
  });

  it('wants the review after the issue date', () => {
    expect(rules(doc({ reviewDueAt: '2026-03-01' }))).toEqual([['reviewDueAt', 'review_before_issued', '2026-03-01']]);
    expect(rules(doc({ reviewDueAt: '2026-03-02' }))).toEqual([]);
  });

  it('wants the reception neither in the future nor after the issue date, the same day being right', () => {
    expect(rules(doc({ receivedAt: '2026-10-11' }))).toEqual([['receivedAt', 'received_in_future', TODAY]]);
    expect(rules(doc({ issuedAt: null, effective: null, receivedAt: '2026-10-11' }))).toEqual([['receivedAt', 'received_in_future', TODAY]]);
    expect(rules(doc({ receivedAt: '2026-03-02' }))).toEqual([['receivedAt', 'received_after_issued', '2026-03-01']]);
    expect(rules(doc({ receivedAt: '2026-03-01' }))).toEqual([]);
    expect(rules(doc({ issuedAt: null, receivedAt: TODAY }))).toEqual([]);
  });

  it('wants the revision in force on the issue date at the earliest', () => {
    expect(rules(doc({ effective: { letter: 'C', at: '2026-02-28' } }))).toEqual([['effective', 'effective_before_issued', '2026-03-01']]);
    expect(rules(doc({ effective: { letter: 'A', at: '2026-03-01' } }))).toEqual([]);
  });

  it('holds a document not issued yet to the earliest day it can be, when given', () => {
    const notIssued = (over: Partial<DocDates>) => doc({ issuedAt: null, effective: null, issueFrom: TODAY, ...over });
    expect(rules(notIssued({ expiresAt: TODAY, reviewDueAt: '2026-01-01' }))).toEqual([['expiresAt', 'expires_before_first_issue', TODAY], ['reviewDueAt', 'review_before_first_issue', TODAY]]);
    expect(rules(notIssued({ expiresAt: '2026-10-11', reviewDueAt: '2026-10-11' }))).toEqual([]);
    // The revision that will issue it names the date when it has one.
    expect(rules(notIssued({ issueFrom: '2026-11-02', effective: { letter: 'A', at: '2026-11-02' }, expiresAt: '2026-11-02', reviewDueAt: '2026-11-02' })))
      .toEqual([['expiresAt', 'expires_before_effective', '2026-11-02'], ['reviewDueAt', 'review_before_first_issue', '2026-11-02']]);
    // Once issued, only the issue date counts.
    expect(rules(doc({ issueFrom: '2027-01-01', expiresAt: '2026-12-01', reviewDueAt: '2026-12-01' }))).toEqual([]);
  });

  it('says when the expiry comes before the approval of a revision in review without date', () => {
    expect(dateIssues(doc({ effective: { letter: 'B', at: TODAY, atApproval: true }, expiresAt: '2026-10-05' }), TODAY))
      .toEqual([{ field: 'expiresAt', rule: 'expires_before_approval', ref: TODAY, letter: 'B' }]);
  });

  it('reports every date out of order at once', () => {
    expect(rules(doc({ expiresAt: '2026-01-01', reviewDueAt: '2026-01-01', receivedAt: '2026-12-01' })).map(([, rule]) => rule))
      .toEqual(['expires_before_issued', 'review_before_issued', 'received_in_future']);
  });
});

describe('latestEffect, inForceEffect', () => {
  const rev = (letter: string, status: string, effectiveAt: string | null, inForceAt: string | null = null) => ({ letter, status, effectiveAt, inForceAt });

  it('dates a revision in force from its effective date, or from its entry into force when that came later', () => {
    expect(inForceEffect({ effectiveAt: null, inForceAt: '2026-06-01' })).toBe('2026-06-01');
    expect(inForceEffect({ effectiveAt: '2026-05-20', inForceAt: '2026-06-01' })).toBe('2026-06-01');
    expect(inForceEffect({ effectiveAt: '2026-06-01', inForceAt: '2026-06-01' })).toBe('2026-06-01');
  });

  it('takes the latest effective date of the revision in force and of one approved or in review', () => {
    expect(latestEffect([rev('A', 'superseded', null, '2026-01-01'), rev('B', 'in_force', null, '2026-06-01')])).toEqual({ letter: 'B', at: '2026-06-01' });
    expect(latestEffect([rev('B', 'in_force', null, '2026-06-01'), rev('C', 'approved', '2026-11-15')])).toEqual({ letter: 'C', at: '2026-11-15' });
    expect(latestEffect([rev('B', 'in_force', null, '2026-06-01'), rev('C', 'in_review', '2026-12-01')])).toEqual({ letter: 'C', at: '2026-12-01' });
  });

  it('leaves out a draft (an effective date left by a rejected circuit), a revision without date, superseded or cancelled', () => {
    expect(latestEffect([rev('B', 'in_force', null, '2026-06-01'), rev('C', 'draft', '2026-12-01'), rev('D', 'cancelled', '2027-01-01')])).toEqual({ letter: 'B', at: '2026-06-01' });
    expect(latestEffect([rev('A', 'in_review', null), rev('Z', 'superseded', '2027-01-01', '2027-01-01')])).toBeNull();
    expect(latestEffect([])).toBeNull();
  });

  it('with today, dates a revision in review from its approval, today at the earliest, unless its effective date is still to come', () => {
    expect(latestEffect([rev('A', 'in_force', null, '2026-06-01'), rev('B', 'in_review', null)], TODAY)).toEqual({ letter: 'B', at: TODAY, atApproval: true });
    expect(latestEffect([rev('B', 'in_review', '2026-10-01')], TODAY)).toEqual({ letter: 'B', at: TODAY, atApproval: true });
    expect(latestEffect([rev('B', 'in_review', '2026-12-01')], TODAY)).toEqual({ letter: 'B', at: '2026-12-01' });
    expect(latestEffect([rev('B', 'draft', '2026-12-01')], TODAY)).toBeNull();
  });
});

describe('issueFrom', () => {
  it('is today, or the effect of the revision that will issue the document when later; nothing once issued', () => {
    expect(issueFrom(null, null, TODAY)).toBe(TODAY);
    expect(issueFrom(null, { letter: 'A', at: TODAY, atApproval: true }, TODAY)).toBe(TODAY);
    expect(issueFrom(null, { letter: 'A', at: '2026-11-02' }, TODAY)).toBe('2026-11-02');
    expect(issueFrom('2026-03-01', { letter: 'B', at: '2026-11-02' }, TODAY)).toBeNull();
  });
});

describe('effectIssue (request for approval)', () => {
  const issued = (expiresAt: string | null, reviewDueAt: string | null = null) => ({ issuedAt: '2026-03-01', expiresAt, reviewDueAt });
  const notIssued = (expiresAt: string | null, reviewDueAt: string | null = null) => ({ issuedAt: null, expiresAt, reviewDueAt });

  it('wants the effective date before the expiry', () => {
    expect(effectIssue(issued('2026-12-01'), '2026-11-30', TODAY)).toBeNull();
    expect(effectIssue(issued('2026-12-01'), '2026-12-01', TODAY)).toEqual({ field: 'effective', rule: 'effective_after_expiry', ref: '2026-12-01' });
    expect(effectIssue(issued('2026-12-01'), '2027-01-15', TODAY)).toEqual({ field: 'effective', rule: 'effective_after_expiry', ref: '2026-12-01' });
    expect(effectIssue(notIssued('2026-12-01'), '2027-01-15', TODAY)).toEqual({ field: 'effective', rule: 'effective_after_expiry', ref: '2026-12-01' });
    expect(effectIssue(issued(null), '2027-01-15', TODAY)).toBeNull();
  });

  it('without an effective date, accepts a document issued and already expired: it is renewed', () => {
    expect(effectIssue(issued(TODAY), null, TODAY)).toBeNull();
    expect(effectIssue(issued('2026-09-30', '2026-09-30'), null, TODAY)).toBeNull();
  });

  it('wants a document not issued yet to expire, and to be reviewed, after the revision issues it', () => {
    expect(effectIssue(notIssued('2026-10-11', '2026-10-11'), null, TODAY)).toBeNull();
    expect(effectIssue(notIssued(TODAY), null, TODAY)).toEqual({ field: 'effective', rule: 'approval_after_expiry', ref: TODAY });
    expect(effectIssue(notIssued(null, '2026-09-30'), null, TODAY)).toEqual({ field: 'effective', rule: 'approval_after_review', ref: '2026-09-30' });
    expect(effectIssue(notIssued(null, '2026-12-01'), '2026-12-01', TODAY)).toEqual({ field: 'effective', rule: 'effective_after_review', ref: '2026-12-01' });
    expect(effectIssue(notIssued('2027-01-01', '2026-12-02'), '2026-12-01', TODAY)).toBeNull();
  });
});

describe('dateIssueText', () => {
  const ALL: DateRule[] = [
    'expires_before_issued', 'expires_before_effective', 'expires_before_approval', 'expires_before_first_issue', 'effective_before_issued', 'review_before_issued',
    'review_before_first_issue', 'received_in_future', 'received_after_issued', 'effective_after_expiry', 'approval_after_expiry', 'effective_after_review', 'approval_after_review',
  ];

  it('says, in each language, which date it conflicts with', () => {
    expect(dateIssueText(DICT.fr, 'fr', { field: 'expiresAt', rule: 'expires_before_effective', ref: '2026-06-01', letter: 'B' }))
      .toBe('La date d’expiration doit être postérieure à la date d’effet de la révision B (01/06/2026) : choisissez une date plus tardive.');
    expect(dateIssueText(DICT.en, 'en', { field: 'expiresAt', rule: 'expires_before_issued', ref: '2026-03-01' }))
      .toBe('The expiry date must be after the document’s issue date (1 Mar 2026): choose a later date.');
  });

  it('has a message of its own for each rule, in French and in English, with every placeholder filled', () => {
    for (const lang of ['fr', 'en'] as const) {
      const texts = ALL.map((rule) => dateIssueText(DICT[lang], lang, { field: 'expiresAt', rule, ref: '2026-03-01', letter: 'B' }));
      expect(new Set(texts).size).toBe(ALL.length);
      for (const text of texts) expect(text).not.toMatch(/[{}]/);
      // Every rule but the reception in the future names the date to compare with.
      ALL.forEach((rule, i) => expect(texts[i].includes(lang === 'fr' ? '01/03/2026' : '1 Mar 2026'), rule).toBe(rule !== 'received_in_future'));
    }
  });
});
