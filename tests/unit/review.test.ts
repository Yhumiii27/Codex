import { describe, expect, it } from 'vitest';
import { addMonths } from '@/lib/format';
import { DICT } from '@/lib/i18n';
import { circuitDaysLate, isCircuitLate, isExpired, isReviewOverdue, nextReviewDate, parseReviewMonths, REVIEW_MONTHS_MAX, reviewAfter, reviewDueHint } from '@/lib/review';

// Expiry and periodic review (point 13 of docs/reste-a-faire.md, G36, G37): indicators without a new status (D-17),
// the next review date of « Revue effectuée » and the periodicity of a type.

const TODAY = '2026-10-10';
const doc = (over: Partial<{ state: string; revInForce: string | null; expiresAt: string | null; reviewDueAt: string | null }> = {}) =>
  ({ state: 'active', revInForce: 'A', expiresAt: null, reviewDueAt: null, ...over });

describe('isExpired', () => {
  it('once the expiry date has passed: the expiry day itself is still valid (0 days left)', () => {
    expect(isExpired(doc({ expiresAt: '2026-10-09' }), TODAY)).toBe(true);
    expect(isExpired(doc({ expiresAt: '2025-01-01' }), TODAY)).toBe(true);
    expect(isExpired(doc({ expiresAt: TODAY }), TODAY)).toBe(false);
    expect(isExpired(doc({ expiresAt: '2026-10-11' }), TODAY)).toBe(false);
    expect(isExpired(doc(), TODAY)).toBe(false);
  });

  it('is worded on the end of validity: the expiry day was still valid, so never « expired since » that day', () => {
    for (const [lang, until] of [['fr', 'valable jusqu’au'], ['en', 'valid until']] as const) {
      const t = DICT[lang];
      expect(t.dl_expired, lang).toContain(until);
      expect(t.notice_expired, lang).toContain(`${until} {date}`);
      expect(`${t.dl_expired} ${t.notice_expired}`, lang).not.toMatch(/depuis|since/i);
    }
  });

  it('only on an active document: an obsolete or archived one is no longer applied (D-17)', () => {
    expect(isExpired(doc({ state: 'obsolete', expiresAt: '2026-01-01' }), TODAY)).toBe(false);
    expect(isExpired(doc({ state: 'archived', expiresAt: '2026-01-01' }), TODAY)).toBe(false);
  });

  it('also on a draft never in force, which its drafting circle alone sees (D-14)', () => {
    expect(isExpired(doc({ revInForce: null, expiresAt: '2026-01-01' }), TODAY)).toBe(true);
  });
});

describe('isReviewOverdue', () => {
  it('once the review date has passed, on an active document with a revision in force', () => {
    expect(isReviewOverdue(doc({ reviewDueAt: '2026-10-09' }), TODAY)).toBe(true);
    expect(isReviewOverdue(doc({ reviewDueAt: TODAY }), TODAY)).toBe(false);
    expect(isReviewOverdue(doc({ reviewDueAt: '2027-01-01' }), TODAY)).toBe(false);
    expect(isReviewOverdue(doc(), TODAY)).toBe(false);
  });

  it('never without a revision in force, nor on an obsolete or archived document', () => {
    expect(isReviewOverdue(doc({ revInForce: null, reviewDueAt: '2026-01-01' }), TODAY)).toBe(false);
    for (const state of ['obsolete', 'archived']) expect(isReviewOverdue(doc({ state, reviewDueAt: '2026-01-01' }), TODAY), state).toBe(false);
  });
});

describe('addMonths and reviewAfter', () => {
  it('the same day months later, the last day of a shorter month', () => {
    expect(addMonths('2026-10-10', 12)).toBe('2027-10-10');
    expect(addMonths('2026-10-10', 3)).toBe('2027-01-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-10-10', 240)).toBe('2046-10-10');
  });

  it('nothing without a periodicity', () => {
    expect(reviewAfter('2026-10-10', 36)).toBe('2029-10-10');
    expect(reviewAfter('2026-10-10', null)).toBeNull();
    expect(reviewAfter('2026-10-10', undefined)).toBeNull();
  });
});

describe('parseReviewMonths (Administration › Registre des types)', () => {
  it('empty for none, a whole number of months within bounds', () => {
    expect(parseReviewMonths('')).toBeNull();
    expect(parseReviewMonths('  ')).toBeNull();
    expect(parseReviewMonths('36')).toBe(36);
    expect(parseReviewMonths(' 1 ')).toBe(1);
    expect(parseReviewMonths(String(REVIEW_MONTHS_MAX))).toBe(REVIEW_MONTHS_MAX);
  });

  it('refuses anything else rather than correct it', () => {
    for (const v of ['0', '-12', '12.5', '1e2', 'douze', String(REVIEW_MONTHS_MAX + 1)]) expect(parseReviewMonths(v), v).toBeUndefined();
  });
});

describe('nextReviewDate (« Revue effectuée »)', () => {
  it('the day entered, after today', () => {
    expect(nextReviewDate('2027-10-10', TODAY, null)).toEqual({ date: '2027-10-10' });
    expect(nextReviewDate('2026-10-11', TODAY, 36)).toEqual({ date: '2026-10-11' });
    expect(nextReviewDate(TODAY, TODAY, 36)).toEqual({ err: 'review_next_past' });
    expect(nextReviewDate('2026-01-01', TODAY, 36)).toEqual({ err: 'review_next_past' });
  });

  it('a real calendar day only', () => {
    for (const v of ['2027-02-30', '2027-13-01', '10/10/2027', '0000-01-01', '2027-10-10T08:00:00Z']) expect(nextReviewDate(v, TODAY, 12), v).toEqual({ err: 'date_malformed' });
  });

  it('without a day entered, the type’s periodicity counted from today, else nothing', () => {
    expect(nextReviewDate(null, TODAY, 24)).toEqual({ date: '2028-10-10' });
    expect(nextReviewDate(null, TODAY, null)).toEqual({ err: 'review_next_required' });
  });
});

describe('reviewDueHint (review date of the create and metadata dialogs)', () => {
  it('before any entry into force, announces the date the periodicity will set', () => {
    expect(reviewDueHint(36, false)).toBe('review_due_periodic');
  });

  it('on a document in force, promises no date: emptying it plans no review until the next revision', () => {
    expect(reviewDueHint(36, true)).toBe('review_due_periodic_in_force');
    expect(DICT.fr.review_due_periodic_in_force).toContain('aucune revue n’est planifiée');
  });

  it('says nothing without a periodicity', () => {
    expect(reviewDueHint(null, false)).toBeNull();
    expect(reviewDueHint(undefined, true)).toBeNull();
  });
});

describe('isCircuitLate and circuitDaysLate (point 87)', () => {
  const wf = (over: Partial<{ outcome: string | null; done: boolean; due: string | null }> = {}) => ({ outcome: null, done: false, due: '2026-10-09', ...over });
  it('a running circuit once its due day has passed: the due day itself is not late, the next day is (1 day)', () => {
    expect(isCircuitLate(wf(), TODAY)).toBe(true);
    expect(circuitDaysLate(wf(), TODAY)).toBe(1);
    expect(circuitDaysLate(wf({ due: '2026-09-30' }), TODAY)).toBe(10);
    expect(isCircuitLate(wf({ due: TODAY }), TODAY)).toBe(false);
    expect(isCircuitLate(wf({ due: '2026-10-11' }), TODAY)).toBe(false);
    expect(circuitDaysLate(wf({ due: TODAY }), TODAY)).toBe(0);
  });
  it('never a circuit that is over (approved, rejected, recalled, or with no step left), nor one without a due day', () => {
    for (const outcome of ['approved', 'rejected', 'recalled']) expect(isCircuitLate(wf({ outcome }), TODAY)).toBe(false);
    expect(isCircuitLate(wf({ done: true }), TODAY)).toBe(false);
    expect(isCircuitLate(wf({ due: null }), TODAY)).toBe(false);
    expect(circuitDaysLate(wf({ outcome: 'approved' }), TODAY)).toBe(0);
  });
});
