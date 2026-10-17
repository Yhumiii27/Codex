import 'server-only';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getDb } from '@/db';
import { readMigrations } from './backup-core.mjs';
import { exportArchive, exportName, type FileOpener } from './export-core.mjs';
import { logger } from './log';
import { FileNotFoundError, openStored } from './storage';
import { appVersion } from './version';

// Full export while the server runs (GET /api/export/full, Administration › Journal d'audit): the archive of
// lib/export-core.mjs, streamed to the browser from this process, which holds the database. The same archive is written
// to a file, server stopped, by npm run export (scripts/codex-export.mjs).

const log = logger('export');

/** The settings Graph needs (lib/storage.ts): without them, files kept by SharePoint cannot be read from here. */
const SHAREPOINT_VARS = ['CODEX_SP_TENANT_ID', 'CODEX_SP_CLIENT_ID', 'CODEX_SP_CLIENT_SECRET', 'CODEX_SP_DRIVE_ID'];

/**
 * A stored file as a stream, from either store; null when the store has no such file. A file kept by SharePoint while
 * SharePoint is not set up (O-01) is skipped, and listed as such by the manifest and the journal, rather than failing
 * the whole export; once set up, a store out of reach fails it, as a local file that cannot be read does. The integrity
 * check reads the files the same way (lib/integrity.ts).
 */
export const openFile = async (f: Pick<Parameters<FileOpener>[0], 'storage' | 'fileKey' | 'size'>): ReturnType<FileOpener> => {
  if (f.storage === 'sharepoint' && SHAREPOINT_VARS.some((k) => !process.env[k])) return 'skipped';
  try {
    const src = await openStored(f.storage, f.fileKey, f.size);
    return Readable.fromWeb((await src.read()) as import('node:stream/web').ReadableStream<Uint8Array>);
  } catch (err) {
    if (err instanceof FileNotFoundError) return null;
    throw err;
  }
};

/**
 * Starts the export of everything by `userId` and returns the name of its archive and its bytes as a stream. The
 * snapshot is taken and the start journaled before this returns, so that a failure there is an error of the request
 * rather than a broken download; the end is journaled when the stream ends, is cancelled (the download stopped) or fails.
 * "Ends" means the last bytes were handed to the response: whether the client received them all is not known here, and a
 * download cut once the archive sits in the server's buffers is journaled as complete (docs/export.md, Journal).
 */
export async function startFullExport(userId: string, now = new Date()): Promise<{ name: string; body: ReadableStream<Uint8Array> }> {
  const it = exportArchive({
    pg: (await getDb()).$client, openFile, actor: userId, mode: 'online', by: userId, now,
    migrations: await readMigrations(path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle')), app: await appVersion(),
    warn: (msg, err) => log.warn(msg, { by: userId, err }),
  });
  const first = await it.next();
  let sent = 0;
  // Set when the download stops: a chunk read meanwhile is dropped, the controller being closed by then.
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      if (first.done) c.close();
      else c.enqueue(first.value);
    },
    async pull(c) {
      try {
        const r = await it.next();
        if (cancelled) return;
        if (r.done) {
          log.info('full export written', { by: userId, size: r.value.size, sha256: r.value.sha256, files: r.value.manifest.files.count, missing: r.value.manifest.files.missing.length || undefined });
          c.close();
          return;
        }
        sent += r.value.length;
        c.enqueue(r.value);
      } catch (err) {
        if (cancelled) return;
        log.error('full export failed', { by: userId, sent, err });
        c.error(err);
      }
    },
    async cancel() {
      cancelled = true;
      log.warn('full export interrupted', { by: userId, sent });
      // Waits for a chunk being read, then ends the export: temporary tables dropped, interruption journaled.
      await it.return(undefined as never);
    },
  }, { highWaterMark: 0 });
  return { name: exportName(now), body };
}
