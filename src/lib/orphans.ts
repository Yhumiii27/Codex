import 'server-only';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { audit } from './lifecycle';
import { logger } from './log';
import { activeStore, listStoredFiles, localTouched, removeLocalFile, type ListedFile, type StoreName } from './storage';

// Files of the store that no working version points to (point 36 of docs/reste-a-faire.md). A file is stored before
// the transaction that records it (lib/storage.ts stageFile), then renamed after it (nameStoredFile): a process stopped
// in between, a failed transaction whose clean-up failed too, or a rename that could not finish leaves a file no record
// names. Administration lists them (a dry run: nothing is removed) and a records manager removes, journaled, those of
// the local store that the list showed. SharePoint files are listed only: removing them waits for a test on a real
// tenant (O-01).
//
// What is never removed: a file a working version points to (looked up again just before removing), a file written,
// linked or moved less than the grace period ago (an upload in progress, whose record is not committed yet; a rename
// makes a hard link, which moves the ctime), a file whose name Codex does not give (a .DS_Store, a file put there by
// hand).

const log = logger('orphans');

export const DEFAULT_GRACE_HOURS = 24;
/** Files removed at most per run: the journal entry lists each of them. */
export const MAX_PER_RUN = 200;

/**
 * Grace period: CODEX_ORPHAN_GRACE_HOURS, whole hours, at least 1 (an upload takes seconds; a shorter delay would risk
 * one in progress), 24 by default or when the value is not a whole number of hours.
 */
export function graceHours(env: Record<string, string | undefined>): number {
  const raw = env.CODEX_ORPHAN_GRACE_HOURS?.trim();
  if (!raw) return DEFAULT_GRACE_HOURS;
  if (!/^\d{1,5}$/.test(raw)) {
    log.warn(`CODEX_ORPHAN_GRACE_HOURS=${raw} is not a whole number of hours: ${DEFAULT_GRACE_HOURS} h`);
    return DEFAULT_GRACE_HOURS;
  }
  return Math.max(1, Number(raw));
}

/** Names Codex gives to local files: a random UUID, then the provisional or final name (lib/storage.ts). */
const CODEX_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-./;

export function isCodexKey(store: StoreName, key: string): boolean {
  // A SharePoint key is a driveItem id, listed from _staging, where only Codex writes.
  return store === 'sharepoint' || CODEX_KEY.test(key);
}

/** What a look at one store found. */
export type OrphanScan = {
  store: StoreName;
  /** Orphans older than the grace period, oldest first: what a purge removes (local store). */
  orphans: ListedFile[];
  /** Their total size. */
  bytes: number;
  /** Files no record names but too recent to be orphans: kept. */
  recent: number;
  /** Files whose name Codex does not give: left alone. */
  foreign: number;
};

/** Sorts the files of a store against the keys working versions point to. Pure. */
export function classify(store: StoreName, files: ListedFile[], referenced: ReadonlySet<string>, now: number, graceMs: number): OrphanScan {
  const out: OrphanScan = { store, orphans: [], bytes: 0, recent: 0, foreign: 0 };
  for (const f of files) {
    if (!isCodexKey(store, f.key)) out.foreign++;
    else if (referenced.has(f.key)) continue;
    else if (now - f.touched < graceMs) out.recent++;
    else out.orphans.push(f);
  }
  out.orphans.sort((a, b) => a.touched - b.touched || a.key.localeCompare(b.key));
  out.bytes = out.orphans.reduce((n, f) => n + f.size, 0);
  return out;
}

/** Keys the working versions of a store point to (no storage recorded: the local store). */
async function referencedKeys(store: StoreName, keys?: string[]): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select({ storage: s.workingVersions.storage, fileKey: s.workingVersions.fileKey }).from(s.workingVersions)
    .where(keys ? sql`${s.workingVersions.fileKey} = any(${sql.param(keys)}::text[])` : isNotNull(s.workingVersions.fileKey));
  return new Set(rows.filter((r) => (r.storage === 'sharepoint') === (store === 'sharepoint')).map((r) => r.fileKey!));
}

/** Lists a store, then reads which files the records name: a file listed before a record that names it is committed is younger than the grace period. */
async function scan(store: StoreName, now: number, graceMs: number): Promise<OrphanScan> {
  const files = await listStoredFiles(store);
  return classify(store, files, await referencedKeys(store), now, graceMs);
}

export type OrphanReport = {
  graceHours: number;
  local: OrphanScan;
  /** SharePoint, when it is the active store or still holds files of some records; `error` when it could not be listed. */
  sharepoint: OrphanScan | { error: true } | null;
};

/** The dry run: what a purge would remove from the local store, and the SharePoint orphans, which it never removes. */
export async function orphanReport(opts: { now?: number; env?: Record<string, string | undefined> } = {}): Promise<OrphanReport> {
  const hours = graceHours(opts.env ?? process.env);
  const now = opts.now ?? Date.now();
  const graceMs = hours * 3_600_000;
  const local = await scan('local', now, graceMs);
  let sharepoint: OrphanReport['sharepoint'] = null;
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.workingVersions).where(eq(s.workingVersions.storage, 'sharepoint'));
  if (activeStore() === 'sharepoint' || n > 0) {
    try {
      sharepoint = await scan('sharepoint', now, graceMs);
    } catch (err) {
      log.error('SharePoint listing failed', { err });
      sharepoint = { error: true };
    }
  }
  return { graceHours: hours, local, sharepoint };
}

/**
 * `removed`: the files removed; `failed`: those that could not be; `kept`: candidates (the keys the dry run listed, or
 * the oldest orphans) found no longer orphans just before (named by a record, touched since, gone); `left`: orphans of
 * the store still there after the run, new ones included.
 */
export type PurgeResult = { removed: ListedFile[]; bytes: number; failed: number; kept: number; left: number };

// On globalThis: the scheduler (lib/scheduler.ts) runs in the bundle of src/instrumentation.ts, apart from the Server
// Actions; both must see a run in progress.
const busy = ((globalThis as unknown as { __codexBusy?: Set<string> }).__codexBusy ??= new Set<string>());

/**
 * Removes orphans of the local store, at most MAX_PER_RUN, and journals them in one entry by `userId` (action
 * 'files_purged', target the local store), each with its size and last change; the server log names each one as it
 * goes. `keys`: the files the dry run showed, of which only those still orphans go (an orphan that turned up since
 * waits for the next look; a key that is not an orphan, whatever a page sent back, is never removed); without it (the
 * scheduler, point 38), the oldest orphans. Each candidate is checked again just before: still old enough, still named
 * by no record. 'busy' while another purge runs in this process (Administration or the scheduler).
 */
export async function purgeOrphans(
  userId: string,
  opts: { keys?: readonly string[]; now?: number; env?: Record<string, string | undefined> } = {},
): Promise<PurgeResult | 'busy'> {
  if (busy.has('orphans')) return 'busy';
  busy.add('orphans');
  try {
    const now = opts.now ?? Date.now();
    const graceMs = graceHours(opts.env ?? process.env) * 3_600_000;
    const { orphans } = await scan('local', now, graceMs);
    const shown = opts.keys ? new Set(opts.keys.slice(0, MAX_PER_RUN)) : null;
    const batch = (shown ? orphans.filter((f) => shown.has(f.key)) : orphans).slice(0, MAX_PER_RUN);
    // Touched since the scan (a rename links the file again): no longer a candidate.
    const still: ListedFile[] = [];
    for (const f of batch) {
      const touched = await localTouched(f.key);
      if (touched != null && now - touched >= graceMs) still.push({ ...f, touched });
    }
    const named = still.length ? await referencedKeys('local', still.map((f) => f.key)) : new Set<string>();
    const removed: ListedFile[] = [];
    let failed = 0;
    for (const f of still.filter((x) => !named.has(x.key))) {
      try {
        await removeLocalFile(f.key);
        log.info('orphan file removed', { key: f.key, size: f.size, lastChanged: new Date(f.touched).toISOString() });
        removed.push(f);
      } catch (err) {
        failed++;
        log.error('orphan file not removed', { key: f.key, err });
      }
    }
    const bytes = removed.reduce((n, f) => n + f.size, 0);
    if (removed.length) {
      const db = await getDb();
      await audit(db, userId, 'files_purged', { kind: 'storage', id: 'local' }, '', null, {
        purge: { files: removed.map((f) => ({ key: f.key, size: f.size, touched: new Date(f.touched).toISOString() })), bytes, ...(failed ? { failed } : {}) },
      });
    }
    return { removed, bytes, failed, kept: (shown ? shown.size : batch.length) - removed.length - failed, left: orphans.length - removed.length };
  } finally {
    busy.delete('orphans');
  }
}
