import type { Disposition, RetentionTrigger } from '@/db/schema';
import { addYears, parseIsoDay } from './format';

// Retention class of a document: years counted from a trigger event (docs/modele-cible.md §8). Counted per document:
// its replaced revisions follow it.

type RetDoc = {
  retentionYears: number | null; retentionTrigger: RetentionTrigger | string; retentionDisposition: Disposition | string;
  createdAt: string; issuedAt: string | null; obsoleteAt: string | null; archivedAt: string | null; expiresAt: string | null;
  /** Date of the event entered by hand, for EVENT_TRIGGERS. */
  retentionEventAt?: string | null;
};

/**
 * Triggers whose event Codex cannot know and whose date is entered on the record (end of life of the asset, departure
 * of the employee). The end of a project is not one of them: it is expected from Keystone (O-03).
 */
export const EVENT_TRIGGERS = ['asset_life', 'employee_departure'] as const satisfies readonly RetentionTrigger[];

export function isEventTrigger(trigger: string): boolean {
  return (EVENT_TRIGGERS as readonly string[]).includes(trigger);
}

/** Date the trigger event happened, when Codex knows it. */
export function triggerDate(d: RetDoc): string | null {
  switch (d.retentionTrigger) {
    case 'creation': return d.createdAt;
    case 'in_force': return d.issuedAt;
    // Counted per document: from its withdrawal (Vigie), else from its archiving. Replaced revisions keep the
    // document's retention (docs/modele-cible.md §8).
    case 'superseded': return d.obsoleteAt ?? d.archivedAt;
    case 'contract_end':
    case 'expiry': return d.expiresAt;
    case 'fiscal_year_end': {
      const base = d.issuedAt ?? d.createdAt;
      return `${base.slice(0, 4)}-12-31`;
    }
    // Entered on the record by its owner or a records manager.
    case 'asset_life':
    case 'employee_departure': return d.retentionEventAt ?? null;
    default: return null; // project end: not known to Codex yet (Keystone, O-03); permanent: never
  }
}

/** End of retention, or null when it is not (yet) computable or the document is kept permanently. */
export function retainUntil(d: RetDoc): string | null {
  if (d.retentionTrigger === 'permanent' || d.retentionDisposition === 'permanent' || d.retentionYears == null) return null;
  const base = triggerDate(d);
  return base ? addYears(base, d.retentionYears) : null;
}

/**
 * Why a document that will not be kept permanently has no end of retention yet: the date of its event is to be entered
 * (`event_missing`), its class has no duration (`no_duration`, which O-07 may set), or its event is not known yet
 * (`event_unknown`: entry into force, withdrawal, expiry, end of project). Null when it has an end or is permanent.
 */
export type RetentionGap = 'event_missing' | 'no_duration' | 'event_unknown';
export function retentionGap(d: RetDoc): RetentionGap | null {
  if (d.retentionTrigger === 'permanent' || d.retentionDisposition === 'permanent' || retainUntil(d)) return null;
  if (isEventTrigger(d.retentionTrigger) && !d.retentionEventAt) return 'event_missing';
  if (d.retentionYears == null) return 'no_duration';
  return 'event_unknown';
}

export type RetentionRule = { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string };

/** Same duration, trigger and final disposition. */
export function sameRule(a: RetentionRule, b: RetentionRule): boolean {
  return a.retentionYears === b.retentionYears && a.retentionTrigger === b.retentionTrigger && a.retentionDisposition === b.retentionDisposition;
}

/** Earliest event date accepted: older dates are typing errors. */
export const EVENT_DATE_MIN = '1900-01-01';

/**
 * The date of an event entered on a record: a real day, from EVENT_DATE_MIN to today (the event has happened; a planned
 * end of life or departure is not one yet). Empty clears it.
 */
export function parseEventDate(raw: string | null | undefined, today: string): { ok: true; value: string | null } | { ok: false; key: 'retention_event_invalid' | 'retention_event_future' } {
  const v = (raw ?? '').trim();
  if (!v) return { ok: true, value: null };
  const day = parseIsoDay(v);
  if (!day || day.length !== v.length || day < EVENT_DATE_MIN) return { ok: false, key: 'retention_event_invalid' };
  if (day > today) return { ok: false, key: 'retention_event_future' };
  return { ok: true, value: day };
}
