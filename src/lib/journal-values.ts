import type { AuditChange, AuditValue, docTypes } from '@/db/schema';
import { subtypesJournal, type FamilyValues, type FunctionValues, type TypeValues } from './registry-rules';

// Values of the journal's changes (audit_log.data.changes), stored as keys and codes and rendered in the reader's
// language (lib/queries.ts). Shared by the Server Actions (lib/actions.ts) and the command that applies the register
// to an existing database (lib/registry-apply.ts, npm run registry:apply), so that both write the same entries.

/** An empty value (none, empty text, empty list) is stored as null. */
export function auditValue(v: AuditValue | undefined): AuditValue {
  return v == null || v === '' || (Array.isArray(v) && !v.length) ? null : v;
}

/** Journal changes, before → after, of the values that differ. */
export function changes(parts: [field: string, before: AuditValue, after: AuditValue][]): AuditChange[] {
  return parts
    .map(([field, b, a]) => ({ field, before: auditValue(b), after: auditValue(a) }))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
}

/** Retention class of a type or a document, as the journal stores it. */
export function retentionValue(x: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string }): AuditValue {
  return { years: x.retentionYears, trigger: x.retentionTrigger, disposition: x.retentionDisposition };
}

/** Months as the journal stores them: text (an AuditValue), rendered with their unit (lib/queries.ts). */
export const monthsValue = (n: number | null): AuditValue => (n == null ? null : String(n));

/** Changes from `before` to `after`, each a list of [field, value] in the same order; null for an entry added or removed. */
export function entryChanges(before: [string, AuditValue][] | null, after: [string, AuditValue][] | null): AuditChange[] {
  const fields = (before ?? after ?? []).map(([k]) => k);
  const value = (xs: [string, AuditValue][] | null, k: string) => xs?.find(([f]) => f === k)?.[1] ?? null;
  return changes(fields.map((k): [string, AuditValue, AuditValue] => [k, value(before, k), value(after, k)]));
}

type TypeRow = typeof docTypes.$inferSelect;

/** A type as the journal stores it, field by field. */
export function typeJournal(x: TypeValues | TypeRow): [string, AuditValue][] {
  return [
    ['code', x.code], ['labelFr', x.labelFr], ['labelEn', x.labelEn], ['family', x.family], ['origins', x.origins], ['attachments', x.attachments],
    ['subtypes', subtypesJournal(x.subtypes)], ['circuit', x.circuit], ['confAllowed', x.confAllowed], ['confDefault', x.confDefault],
    ['retention', retentionValue(x)], ['retentionBasis', x.retentionBasis], ['reviewMonths', monthsValue(x.reviewMonths)], ['iso', x.iso],
    ['clientDeliverable', x.clientDeliverable], ['active', x.active],
  ];
}

/** A family as the journal stores it. */
export const familyJournal = (x: FamilyValues | { key: string; labelFr: string; labelEn: string; grp: string }): [string, AuditValue][] => [['key', x.key], ['labelFr', x.labelFr], ['labelEn', x.labelEn], ['grp', x.grp]];

/** A function as the journal stores it. */
export const functionJournal = (x: FunctionValues | { key: string; labelFr: string; labelEn: string; scope: string }): [string, AuditValue][] => [['key', x.key], ['labelFr', x.labelFr], ['labelEn', x.labelEn], ['scope', x.scope]];
