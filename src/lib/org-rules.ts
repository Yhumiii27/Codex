import type { TKey } from './i18n';
import { LABEL_MAX, type Parsed } from './registry-rules';

// Pure rules of the organisation's administration (Administration › Organisation): departments and sites are renamed,
// retired and brought back; lib/actions.ts applies them with the rights and the usage read by lib/queries.ts orgUsage.
// Departments and sites stay provisional until the organisation chart is provided (D-19, O-04).

export const ORG_KINDS = ['department', 'site'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const isOrgKind = (k: unknown): k is OrgKind => typeof k === 'string' && (ORG_KINDS as readonly string[]).includes(k);

/** Labels of a department or a site: French required, English defaulting to it, both bounded. */
export function orgLabels(fr: unknown, en: unknown): Parsed<{ labelFr: string; labelEn: string }> {
  const labelFr = typeof fr === 'string' ? fr.trim() : '';
  const labelEn = (typeof en === 'string' ? en.trim() : '') || labelFr;
  if (!labelFr) return { ok: false, key: 'reg_label_required', field: 'labelFr' };
  if (labelFr.length > LABEL_MAX) return { ok: false, key: 'reg_text_too_long', field: 'labelFr' };
  if (labelEn.length > LABEL_MAX) return { ok: false, key: 'reg_text_too_long', field: 'labelEn' };
  return { ok: true, value: { labelFr, labelEn } };
}

export type OrgValues = { labelFr: string; labelEn: string; active: boolean };

/** The dialog of an existing department or site: its labels and whether it is active. Its code or key is not read. */
export function parseOrgForm(fd: FormData): Parsed<OrgValues> {
  const names = orgLabels(fd.get('labelFr'), fd.get('labelEn'));
  return names.ok ? { ok: true, value: { ...names.value, active: fd.get('active') !== 'off' } } : names;
}

/**
 * What refers to a department or a site. Any of it keeps the value from being deleted: it is made inactive instead.
 * `ids`: identifiers given under a department's code (former ones included, kept as aliases), whose counter stays.
 */
export type OrgUsage = { documents: number; people: number; holders: number; searches: number; ids: number };

export const NO_USAGE: OrgUsage = { documents: 0, people: 0, holders: 0, searches: 0, ids: 0 };

export function inUse(u: OrgUsage | undefined): boolean {
  return !!u && Object.values(u).some((n) => n > 0);
}

/**
 * The values a form offers for a new entry: the active ones, and the one an existing entry already has (`current`),
 * which it keeps while the value is inactive.
 */
export function offered<T extends { key: string; active: boolean }>(values: readonly T[], current?: string | null): T[] {
  return values.filter((x) => x.active || x.key === current);
}

/**
 * Every value, an inactive one marked after its label (`word`: « inactif »): where an inactive value is still offered,
 * a department's page picker or the holders of a department-scoped function (its documents still go through circuits).
 */
export function markInactive<T extends { label: string; active: boolean }>(values: readonly T[], word: string): T[] {
  return values.map((x) => (x.active ? x : { ...x, label: `${x.label} (${word})` }));
}

/** The department a new document is given by default: the user's own while it is active, else the first active one. */
export function newDocDepartment(userDepartment: string | null | undefined, departments: readonly { key: string; active: boolean }[]): string {
  return departments.find((d) => d.key === userDepartment && d.active)?.key ?? departments.find((d) => d.active)?.key ?? '';
}

/**
 * Why a department may not be made inactive or deleted (`next`: its state after, null when deleted), or null. One
 * stays active at least: a new document without attachment takes a department's code as the context of its ID.
 */
export function lastActiveIssue(departments: readonly { code: string; active: boolean }[], code: string, next: boolean | null): TKey | null {
  // Bringing one back, or deleting one already inactive, leaves the active ones as they are.
  if (next || !departments.some((d) => d.code === code && d.active)) return null;
  return departments.some((d) => d.active && d.code !== code) ? null : 'org_last_department';
}
