import 'server-only';
import { and, eq, isNotNull, or, isNull, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { audit } from './lifecycle';
import { logger } from './log';
import { graceHours, MAX_PER_RUN } from './orphans';
import { activeStore, listStoredFiles, localTouched, normalizeMime, PROVISIONAL_LOCAL_KEY, renameStoredFile, storedExt, type StoreName } from './storage';

// Files left under their provisional name (point 36 of docs/reste-a-faire.md). A file is stored under a provisional name
// before the transaction that records it, then renamed {ID}_{version}.{ext} once it is committed (lib/storage.ts
// nameStoredFile). A process stopped in between, or a rename that failed (the store out of reach, a full disk), leaves
// a record pointing to the provisional name: the file is served all the same, but its name in the store tells nothing
// (`{uuid}-upload.pdf` locally, an item of `_staging` on SharePoint). This finds those records and gives their file its
// name, as nameStoredFile would have: Administration lists them first (a dry run: nothing changes), then a records
// manager renames those listed; the scheduler may do it too (CODEX_SCHEDULE_RENAMES, off by default). Each run is
// journaled (action 'files_renamed'), the names to records managers only (they carry IDs and versions of drafts, D-14).
//
// What is never renamed: a file touched less than the grace period ago (CODEX_ORPHAN_GRACE_HOURS, as for orphans: a
// rename may be running right now), a record whose file is missing, a final name already taken by another file. On
// SharePoint the rename goes through the existing interface (FileStore.rename: moved to the document's folder), not
// tried on a real tenant yet (O-01).

const log = logger('storage');

/** A working version whose file is still under its provisional name, with the name it should have. */
export type ProvisionalFile = {
  store: StoreName;
  key: string;
  versionId: number;
  docId: string;
  /** {letter}.{n}, as nameStoredFile names it. */
  label: string;
  /** The name the file gets: {ID}_{label}.{ext}. */
  name: string;
  ext: string;
  /** Last write, link or move of the file (local), or last change (SharePoint); null when the file is missing. */
  touched: number | null;
};

export type ProvisionalScan = {
  store: StoreName;
  /** Old enough to be renamed, oldest first. */
  due: ProvisionalFile[];
  /** Touched less than the grace period ago: left for now. */
  recent: number;
  /** Records whose file the store does not have: left (lib/integrity.ts reports them). */
  missing: number;
};

export type ProvisionalReport = {
  graceHours: number;
  local: ProvisionalScan;
  /** SharePoint, when it is the active store or holds files of some records; `error` when it could not be listed. */
  sharepoint: ProvisionalScan | { error: true } | null;
};

/** Working versions of `store` whose key is a provisional one (`keys`: among these only), with what names their file. */
async function candidates(store: StoreName, keys?: readonly string[]): Promise<Omit<ProvisionalFile, 'touched'>[]> {
  const db = await getDb();
  const W = s.workingVersions;
  const inStore = store === 'sharepoint' ? eq(W.storage, 'sharepoint') : or(isNull(W.storage), eq(W.storage, 'local'));
  const rows = await db
    .select({ id: W.id, docId: W.docId, fileKey: W.fileKey, fileName: W.fileName, mime: W.mime, n: W.n, letter: s.revisions.letter })
    .from(W)
    .innerJoin(s.revisions, eq(s.revisions.id, W.revisionId))
    .where(and(inStore, isNotNull(W.fileKey), keys ? sql`${W.fileKey} = any(${sql.param([...keys])}::text[])` : undefined));
  return rows
    .filter((r) => store === 'sharepoint' || PROVISIONAL_LOCAL_KEY.test(r.fileKey!))
    .map((r) => {
      // The same extension as at upload (lib/storage.ts renameDocFiles): a SharePoint key is an item id and has none.
      const name = r.fileName ?? '';
      const ext = storedExt(name, normalizeMime(r.mime, name));
      const label = `${r.letter}.${r.n}`;
      return { store, key: r.fileKey!, versionId: r.id, docId: r.docId, label, ext, name: `${r.docId}_${label}${ext}` };
    });
}

/** Sorts candidates by the grace period. Pure. */
export function sortProvisional(store: StoreName, files: ProvisionalFile[], now: number, graceMs: number): ProvisionalScan {
  const out: ProvisionalScan = { store, due: [], recent: 0, missing: 0 };
  for (const f of files) {
    if (f.touched == null) out.missing++;
    else if (now - f.touched < graceMs) out.recent++;
    else out.due.push(f);
  }
  out.due.sort((a, b) => a.touched! - b.touched! || a.key.localeCompare(b.key));
  return out;
}

/** Looks at one store: local keys by their form, SharePoint's by its `_staging` listing. */
async function scan(store: StoreName, now: number, graceMs: number, keys?: readonly string[]): Promise<ProvisionalScan> {
  if (store === 'local') {
    const found = await candidates('local', keys);
    const files = await Promise.all(found.map(async (f) => ({ ...f, touched: await localTouched(f.key) })));
    return sortProvisional('local', files, now, graceMs);
  }
  const staged = new Map((await listStoredFiles('sharepoint')).map((f) => [f.key, f.touched]));
  const found = (await candidates('sharepoint', keys)).filter((f) => staged.has(f.key));
  return sortProvisional('sharepoint', found.map((f) => ({ ...f, touched: staged.get(f.key)! })), now, graceMs);
}

/** The dry run: what a run would rename, per store. Nothing changes. */
export async function provisionalReport(opts: { now?: number; env?: Record<string, string | undefined> } = {}): Promise<ProvisionalReport> {
  const hours = graceHours(opts.env ?? process.env);
  const now = opts.now ?? Date.now();
  const graceMs = hours * 3_600_000;
  const local = await scan('local', now, graceMs);
  let sharepoint: ProvisionalReport['sharepoint'] = null;
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
 * `renamed`: each file's old and new key (the same on SharePoint, where the item keeps its id); `failed`: those that
 * could not be (left as they were, the reason in the server log); `kept`: candidates no longer due when looked at again
 * (renamed meanwhile, touched since, gone); `left`: files still under a provisional name after the run.
 */
export type RenameResult = { renamed: { store: StoreName; from: string; to: string; doc: string; label: string }[]; failed: number; kept: number; left: number };

// The guard of lib/orphans.ts (globalThis): a rename and a removal of orphans never run at the same time in a process.
const busy = ((globalThis as unknown as { __codexBusy?: Set<string> }).__codexBusy ??= new Set<string>());

/**
 * Renames files left under their provisional name, at most MAX_PER_RUN, and journals them in one entry by `userId`
 * (action 'files_renamed', target the store). `keys`: those the dry run showed, of which only the ones still due go
 * (a key sent back that is not one, whatever a page sent, is never touched); without it (the scheduler), the oldest.
 * Each one is looked at again just before. 'busy' while a rename or an orphan removal runs in this process.
 */
export async function renameProvisional(
  userId: string,
  opts: { keys?: readonly string[]; now?: number; env?: Record<string, string | undefined> } = {},
): Promise<RenameResult | 'busy'> {
  if (busy.has('orphans')) return 'busy';
  busy.add('orphans');
  try {
    const now = opts.now ?? Date.now();
    const graceMs = graceHours(opts.env ?? process.env) * 3_600_000;
    const stores: StoreName[] = ['local'];
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.workingVersions).where(eq(s.workingVersions.storage, 'sharepoint'));
    if (activeStore() === 'sharepoint' || n > 0) stores.push('sharepoint');
    const shown = opts.keys ? new Set(opts.keys.slice(0, MAX_PER_RUN)) : null;
    const out: RenameResult = { renamed: [], failed: 0, kept: 0, left: 0 };
    let budget = MAX_PER_RUN;
    let total = 0;
    const byStore = new Map<StoreName, RenameResult['renamed']>();
    for (const store of stores) {
      let found: ProvisionalScan;
      try {
        found = await scan(store, now, graceMs);
      } catch (err) {
        log.error('provisional names not looked for', { store, err });
        continue;
      }
      const batch = (shown ? found.due.filter((f) => shown.has(f.key)) : found.due).slice(0, budget);
      budget -= batch.length;
      total += batch.length;
      let renamed = 0;
      for (const f of batch) {
        // Looked at again: still recorded under this key, still old enough.
        // (On SharePoint, the record only: listing `_staging` again for each file would cost a Graph call per page.)
        const [again] = store === 'local'
          ? (await scan(store, now, graceMs, [f.key])).due.filter((x) => x.versionId === f.versionId)
          : (await candidates(store, [f.key])).filter((x) => x.versionId === f.versionId);
        if (!again) continue;
        try {
          const to = await renameStoredFile({ storage: store, fileKey: f.key, ext: f.ext }, f.docId, f.label);
          log.info('provisional name replaced', { store, from: f.key, to, doc: f.docId, label: f.label });
          const r = { store, from: f.key, to, doc: f.docId, label: f.label };
          out.renamed.push(r);
          byStore.set(store, [...(byStore.get(store) ?? []), r]);
          renamed++;
        } catch (err) {
          out.failed++;
          log.error('provisional name not replaced', { store, key: f.key, err });
        }
      }
      out.left += found.due.length + found.recent - renamed;
    }
    out.kept = (shown ? shown.size : total) - out.renamed.length - out.failed;
    for (const [store, files] of byStore) {
      await audit(db, userId, 'files_renamed', { kind: 'storage', id: store }, '', null, {
        rename: { files: files.map((f) => ({ from: f.from, to: f.to, doc: f.doc, label: f.label })), ...(out.failed ? { failed: out.failed } : {}) },
      });
    }
    return out;
  } finally {
    busy.delete('orphans');
  }
}
