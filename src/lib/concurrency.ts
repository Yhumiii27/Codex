import type { T } from './i18n';

// Concurrent changes from two views of the same record (point 20 of docs/reste-a-faire.md): a write that starts from
// what a dialog showed is refused once the record or its working versions moved on since, instead of overwriting them
// silently. Optimistic only: nothing is reserved while a dialog is open.

/**
 * The version of the document a form saw (documents.version, raised by the database at every change of the row,
 * src/db/index.ts): a positive whole number, as a form field or a number; null when it is missing or malformed, which
 * is answered as an outdated view.
 */
export function seenVersion(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^[1-9][0-9]{0,8}$/.test(s)) return null;
  return Number(s);
}

/**
 * The working version an upload or an approval request starts from: the revision drafted and the number of its last
 * version (0 before A.1).
 */
export type WorkingBase = { revisionId: number; n: number };

/** The base sent by the upload or the approval request dialog, or null when it is missing or malformed. */
export function seenWorkingBase(revisionId: unknown, n: unknown): WorkingBase | null {
  const rev = seenVersion(revisionId);
  const s = typeof n === 'number' ? String(n) : typeof n === 'string' ? n.trim() : '';
  if (rev === null || !/^(0|[1-9][0-9]{0,8})$/.test(s)) return null;
  return { revisionId: rev, n: Number(s) };
}

/**
 * Why an upload or an approval request may not start from `base` on the revision drafted now (`rev`, whose last working
 * version is `latest`): 'newer' when a later version was uploaded since (the dialog names it), 'stale' when the view is
 * out of date otherwise (no base, another revision, a version that does not exist), null when the base is the last one.
 */
export function workingIssue(base: WorkingBase | null, rev: { id: number }, latest: { n: number } | null | undefined): 'newer' | 'stale' | null {
  if (!base || base.revisionId !== rev.id) return 'stale';
  const last = latest?.n ?? 0;
  if (last > base.n) return 'newer';
  return last === base.n ? null : 'stale';
}

/** A journal entry written in the transaction that last changed a document's record (lib/actions.ts lastChangedBy). */
export type ChangeEntry = { userId: string; docId: string | null };

/**
 * Who made the last change of a document's record (`docId`), among the journal entries written in the transaction that
 * made it, newest first: an entry about this document rather than another one, then a person rather than Codex or
 * Vigie (`isSystem`; a final approval puts the revision in force in the approver's transaction), then the newest. Null
 * without any entry: a change nothing journaled names nobody, rather than someone who did not make it.
 */
export function changeAuthor(entries: readonly ChangeEntry[], docId: string, isSystem: (userId: string) => boolean): string | null {
  const rank = (e: ChangeEntry) => (e.docId === docId ? 0 : 2) + (isSystem(e.userId) ? 1 : 0);
  let best: ChangeEntry | null = null;
  for (const e of entries) if (!best || rank(e) < rank(best)) best = e;
  return best?.userId ?? null;
}

/** Refusal of a write from an outdated view of the record: who changed it since, when the journal names them. */
export function staleText(t: T, who: string | null): string {
  return who ? t.stale.replace('{who}', who) : t.stale_anon;
}

/**
 * Refusal of an upload (`upload`) or of an approval request (`validate`) whose dialog missed a later working version
 * (`label`, e.g. A.3), uploaded by `who`.
 */
export function workingStaleText(t: T, label: string, who: string, from: 'upload' | 'validate' = 'upload'): string {
  return t[from === 'upload' ? 'working_stale' : 'validate_stale'].replace('{label}', label).replace('{who}', who);
}
