import { fmtDate } from './format';
import type { Lang, T } from './i18n';

// Coherence of a document's dates (docs/audit-deck-epc2i.md §4.6, rule 12: issue ≤ effect ≤ expiry), checked by the
// Server Actions (lib/actions.ts) and by the import (lib/importer.ts). Days are "YYYY-MM-DD" strings, compared as text.

/** Each rule has its message in lib/i18n.ts, where {date} is the date it conflicts with and {rev} the revision. */
export type DateRule =
  | 'expires_before_issued' | 'expires_before_effective' | 'expires_before_approval' | 'expires_before_first_issue'
  | 'effective_before_issued' | 'review_before_issued' | 'review_before_first_issue'
  | 'received_in_future' | 'received_after_issued'
  | 'effective_after_expiry' | 'approval_after_expiry' | 'effective_after_review' | 'approval_after_review';

/** A date that breaks a rule: the field to correct (`effective`: the revision's effective date), and the date it conflicts with. */
export type DateIssue = { field: 'effective' | 'reviewDueAt' | 'expiresAt' | 'receivedAt'; rule: DateRule; ref: string; letter?: string };

/** The day a revision takes effect; `atApproval`: no date set ahead, it takes effect when approved, today at the earliest. */
export type Effect = { letter: string; at: string; atApproval?: boolean };

export type DocDates = {
  /** First entry into force of the document (documents.issued_at). */
  issuedAt: string | null;
  /** Not issued yet: the earliest day it can be (today, or the effective date of the revision that will issue it). */
  issueFrom?: string | null;
  /** The latest day a revision of the document took or takes effect (latestEffect). */
  effective: Effect | null;
  reviewDueAt: string | null;
  expiresAt: string | null;
  receivedAt: string | null;
};

type RevDates = { letter: string; status: string; effectiveAt: string | null; inForceAt: string | null };

/** Day a revision in force took effect: its effective date, or the day it entered into force when that came later. */
export function inForceEffect(r: Pick<RevDates, 'effectiveAt' | 'inForceAt'>): string | null {
  return r.effectiveAt && (!r.inForceAt || r.effectiveAt >= r.inForceAt) ? r.effectiveAt : r.inForceAt;
}

/**
 * The latest day a revision of the document takes effect: the revision in force, and one approved or in review. A
 * draft (which may keep the date of a rejected circuit), a revision superseded or cancelled are left out.
 * Without `today`, only the dates on record count: a revision in review without effective date is left out.
 * With `today`, a revision in review takes effect on its effective date or at its approval, today at the earliest.
 */
export function latestEffect(revs: RevDates[], today?: string): Effect | null {
  let out: Effect | null = null;
  for (const r of revs) {
    const e = revisionEffect(r, today);
    if (e && (!out || e.at > out.at)) out = e;
  }
  return out;
}

function revisionEffect(r: RevDates, today?: string): Effect | null {
  const { letter, status, effectiveAt } = r;
  if (status === 'in_force') {
    const at = inForceEffect(r);
    return at ? { letter, at } : null;
  }
  // Approved: in force on its effective date (lifecycle.promoteDue), at once without one.
  if (status === 'approved') return effectiveAt || today ? { letter, at: (effectiveAt ?? today)! } : null;
  if (status !== 'in_review') return null;
  if (!today) return effectiveAt ? { letter, at: effectiveAt } : null;
  // In review: on an effective date still to come, or at its approval, today at the earliest (lifecycle.approveRevision).
  return effectiveAt && effectiveAt > today ? { letter, at: effectiveAt } : { letter, at: today, atApproval: true };
}

/**
 * The earliest day a document not issued yet can be: today, or the day the revision that will issue it takes effect
 * when that comes later (`effect`: latestEffect with today). Null for a document already issued.
 */
export function issueFrom(issuedAt: string | null, effect: Effect | null, today: string): string | null {
  if (issuedAt) return null;
  return effect && effect.at > today ? effect.at : today;
}

/**
 * Every date of the document that breaks a rule: expiry after the issue and after the revision's effective date, review
 * after the issue, reception neither in the future nor after the issue, and the revision in force since the issue at
 * the earliest. For a document not issued yet, `issueFrom` stands for the issue date. A missing date breaks nothing.
 */
export function dateIssues(d: DocDates, today: string): DateIssue[] {
  const { issuedAt, effective, reviewDueAt, expiresAt, receivedAt } = d;
  const from = issuedAt ? null : d.issueFrom ?? null;
  const out: DateIssue[] = [];
  if (issuedAt && effective && effective.at < issuedAt) out.push({ field: 'effective', rule: 'effective_before_issued', ref: issuedAt, letter: effective.letter });
  if (expiresAt && issuedAt && expiresAt <= issuedAt) out.push({ field: 'expiresAt', rule: 'expires_before_issued', ref: issuedAt });
  else if (expiresAt && effective && expiresAt <= effective.at) out.push({ field: 'expiresAt', rule: effective.atApproval ? 'expires_before_approval' : 'expires_before_effective', ref: effective.at, letter: effective.letter });
  else if (expiresAt && from && expiresAt <= from) out.push({ field: 'expiresAt', rule: 'expires_before_first_issue', ref: from });
  if (reviewDueAt && issuedAt && reviewDueAt <= issuedAt) out.push({ field: 'reviewDueAt', rule: 'review_before_issued', ref: issuedAt });
  else if (reviewDueAt && from && reviewDueAt <= from) out.push({ field: 'reviewDueAt', rule: 'review_before_first_issue', ref: from });
  if (receivedAt && receivedAt > today) out.push({ field: 'receivedAt', rule: 'received_in_future', ref: today });
  else if (receivedAt && issuedAt && receivedAt > issuedAt) out.push({ field: 'receivedAt', rule: 'received_after_issued', ref: issuedAt });
  return out;
}

/**
 * Request for approval: an effective date set must come before the expiry. Without one, the approval day is unknown
 * and the request is accepted, even for a document already expired (renewal: its expiry is moved once the new
 * revision is in force). A document not issued yet is issued by this revision, on its effective date or at its
 * approval (today at the earliest): its expiry and its review must come after that day.
 */
export function effectIssue(d: Pick<DocDates, 'issuedAt' | 'expiresAt' | 'reviewDueAt'>, effective: string | null, today: string): DateIssue | null {
  const { issuedAt, expiresAt, reviewDueAt } = d;
  if (effective && expiresAt && effective >= expiresAt) return { field: 'effective', rule: 'effective_after_expiry', ref: expiresAt };
  if (issuedAt) return null;
  const issue = effective ?? today;
  if (expiresAt && expiresAt <= issue) return { field: 'effective', rule: 'approval_after_expiry', ref: expiresAt };
  if (reviewDueAt && reviewDueAt <= issue) return { field: 'effective', rule: effective ? 'effective_after_review' : 'approval_after_review', ref: reviewDueAt };
  return null;
}

/** The message of an issue, which says what to correct. */
export function dateIssueText(t: T, lang: Lang, i: DateIssue): string {
  return t[i.rule].replace('{date}', fmtDate(i.ref, lang)).replace('{rev}', i.letter ?? '');
}
