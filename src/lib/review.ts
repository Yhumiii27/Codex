import { addMonths, parseIsoDay } from './format';

// Expiry and periodic review of a document (G36, G37, point 13 of docs/reste-a-faire.md): indicators, the next review
// date and the periodicity of a type. No new status: an expired document stays in force until Vigie withdraws it (D-17),
// and nothing happens on its own at the expiry or review date. Days are "YYYY-MM-DD" strings, compared as text.

/** Longest periodic review a type may set, in months (the database checks the same bounds, doc_types_review_months). */
export const REVIEW_MONTHS_MAX = 240;

type Dated = { state: string; revInForce: string | null; expiresAt: string | null; reviewDueAt: string | null };

/**
 * Expired: an active document whose expiry date has passed (the expiry day itself is still within validity, as the
 * deadlines count it: 0 days left). An obsolete or archived document is no longer applied: it carries no indicator.
 */
export function isExpired(d: Pick<Dated, 'state' | 'expiresAt'>, today: string): boolean {
  return d.state === 'active' && !!d.expiresAt && d.expiresAt < today;
}

/** Review overdue: an active document with a revision in force whose review date has passed (same day rule as isExpired). */
export function isReviewOverdue(d: Pick<Dated, 'state' | 'revInForce' | 'reviewDueAt'>, today: string): boolean {
  return d.state === 'active' && !!d.revInForce && !!d.reviewDueAt && d.reviewDueAt < today;
}

/** Day of the periodic review `months` after `from`; null without a periodicity. */
export function reviewAfter(from: string, months: number | null | undefined): string | null {
  return months ? addMonths(from, months) : null;
}

/**
 * Hint under the review date of the document dialogs, when the type has a periodicity. Before any entry into force
 * (creation, a draft never issued), an empty date is set by the entry into force. A document already in force gets
 * one only from its next revision: emptying it plans no review, since editing the metadata applies no periodicity.
 */
export function reviewDueHint(months: number | null | undefined, inForce: boolean): 'review_due_periodic' | 'review_due_periodic_in_force' | null {
  if (!months) return null;
  return inForce ? 'review_due_periodic_in_force' : 'review_due_periodic';
}

/**
 * Periodicity typed in the register: empty for none (null), a whole number of months from 1 to REVIEW_MONTHS_MAX, or
 * undefined for anything else (refused rather than corrected).
 */
export function parseReviewMonths(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= REVIEW_MONTHS_MAX ? n : undefined;
}

export type NextReviewError = 'date_malformed' | 'review_next_past' | 'review_next_required';

/**
 * Next review date set by « Revue effectuée »: the day entered, a real calendar day after today; without one, the
 * periodicity of the type counted from today; without either, nothing can be set.
 */
export function nextReviewDate(entered: string | null, today: string, months: number | null | undefined): { date: string } | { err: NextReviewError } {
  if (entered) {
    const day = parseIsoDay(entered);
    if (!day || day !== entered) return { err: 'date_malformed' };
    return day > today ? { date: day } : { err: 'review_next_past' };
  }
  const date = reviewAfter(today, months);
  return date ? { date } : { err: 'review_next_required' };
}
