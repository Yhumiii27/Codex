// @ts-check
// Integrity check of the stored files (point 31 of docs/reste-a-faire.md): every working version with a file is read
// again from its store, its SHA-256 recomputed and compared with the one recorded when the file entered Codex
// (working_versions.sha256, lib/storage.ts stageFile). Plain JavaScript without the application's modules, like
// lib/backup-core.mjs: the server runs it from Administration (lib/integrity.ts), and `npm run integrity`
// (scripts/codex-integrity.mjs) runs it on the database on disk, server stopped.
//
// A file whose bytes no longer match is altered; one the store does not have is missing; one stored before
// fingerprints were computed gets its fingerprint now (the bytes as they are, which nothing older can vouch for), unless
// its size already differs from the one recorded. Nothing is repaired or removed: the check reports, and journals.

import { createHash } from 'node:crypto';

/** Working versions read per query. */
const BATCH = 200;
/** Working versions the journal names per kind of finding; the counts cover all of them. */
export const INTEGRITY_LIST_MAX = 200;

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Queryable */

/**
 * A stored file as the opener receives it.
 * @typedef {{ workingVersion: number, storage: string, fileKey: string, size: number | null }} IntegrityRef
 */

/**
 * The file's bytes; null when the store has no such file; 'skipped' when this process cannot reach its store
 * (SharePoint from the command line, or not set up). Any other failure is thrown and stops the check.
 * @typedef {(f: IntegrityRef) => Promise<AsyncIterable<Uint8Array> | null | 'skipped'>} IntegrityOpener
 */

/** @typedef {{ v: number, doc: string, label: string }} IntegrityItem */

/**
 * @typedef {object} IntegrityResult
 * @property {number} checked files read whole
 * @property {number} bytes their size
 * @property {IntegrityItem[]} altered bytes that differ from the recorded fingerprint (or size), at most INTEGRITY_LIST_MAX
 * @property {number} alteredCount
 * @property {IntegrityItem[]} missing referenced but absent from their store, at most INTEGRITY_LIST_MAX
 * @property {number} missingCount
 * @property {number} filled fingerprints recorded by this check, for files stored before they were computed
 * @property {number} skipped files kept by a store this process cannot reach
 */

/**
 * SHA-256 and size of a stream.
 * @param {AsyncIterable<Uint8Array>} data
 */
export async function hashStream(data) {
  const h = createHash('sha256');
  let size = 0;
  for await (const chunk of data) {
    h.update(chunk);
    size += chunk.length;
  }
  return { sha256: h.digest('hex'), size };
}

/**
 * What a check found, compared with what the record says: 'ok', 'altered', or 'fill' (no fingerprint recorded yet, and
 * nothing tells the bytes are not the ones received: same size, or no size recorded).
 * @param {{ sha256: string | null, size: number | null }} recorded
 * @param {{ sha256: string, size: number }} actual
 * @returns {'ok' | 'altered' | 'fill'}
 */
export function compareFile(recorded, actual) {
  if (recorded.sha256) return recorded.sha256 === actual.sha256 ? 'ok' : 'altered';
  return recorded.size == null || recorded.size === actual.size ? 'fill' : 'altered';
}

/**
 * Journals a check in `q`, raw SQL like lib/export-core.mjs: action 'integrity_checked', target 'integrity' 'files'.
 * @param {Queryable} q
 * @param {string} actor
 * @param {Record<string, unknown>} integrity
 */
async function journal(q, actor, integrity) {
  await q.query(
    `insert into audit_log (at, user_id, action, target_kind, target_id, detail, data) values ($1, $2, 'integrity_checked', 'integrity', 'files', '', $3::jsonb)`,
    [new Date().toISOString(), actor, JSON.stringify({ integrity })],
  );
}

/**
 * Reads every stored file again and compares it with its record; journals the outcome by `actor` (none: not journaled),
 * a failure included, then returns it or throws. Runs outside any transaction: the files are read one by one while the
 * application goes on; a file renamed meanwhile (a reclassification) is read under its new key.
 * @param {object} o
 * @param {Queryable} o.pg
 * @param {IntegrityOpener} o.openFile
 * @param {string | null} o.actor
 * @param {'app' | 'cli'} o.by
 * @returns {Promise<IntegrityResult>}
 */
export async function checkIntegrity(o) {
  /** @type {IntegrityResult} */
  const res = { checked: 0, bytes: 0, altered: [], alteredCount: 0, missing: [], missingCount: 0, filled: 0, skipped: 0 };
  /** @param {any} x */
  const item = (x) => ({ v: x.id, doc: x.doc_id, label: `${x.letter}.${x.n}` });
  try {
    for (let after = 0; ;) {
      const { rows } = await o.pg.query(
        `select w.id, w.doc_id, r.letter, w.n, coalesce(w.storage, 'local') as storage, w.file_key, w.size, w.sha256
         from working_versions w join revisions r on r.id = w.revision_id
         where w.file_key is not null and w.id > $1 order by w.id limit ${BATCH}`,
        [after],
      );
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      for (const x of rows) {
        /** @type {IntegrityRef} */
        const ref = { workingVersion: x.id, storage: x.storage, fileKey: x.file_key, size: x.size };
        let data = await o.openFile(ref);
        if (data === null) {
          // Renamed since it was listed: the working version records its new key.
          const [cur] = (await o.pg.query(`select coalesce(storage, 'local') as storage, file_key from working_versions where id = $1`, [x.id])).rows;
          if (cur?.file_key && cur.file_key !== x.file_key) data = await o.openFile({ ...ref, storage: cur.storage, fileKey: cur.file_key });
        }
        if (data === 'skipped') {
          res.skipped++;
          continue;
        }
        if (data === null) {
          if (res.missing.length < INTEGRITY_LIST_MAX) res.missing.push(item(x));
          res.missingCount++;
          continue;
        }
        const actual = await hashStream(data);
        res.checked++;
        res.bytes += actual.size;
        const verdict = compareFile({ sha256: x.sha256, size: x.size }, actual);
        if (verdict === 'altered') {
          if (res.altered.length < INTEGRITY_LIST_MAX) res.altered.push(item(x));
          res.alteredCount++;
        } else if (verdict === 'fill') {
          // Only while still unset: a fingerprint recorded meanwhile is never replaced.
          const set = await o.pg.query(`update working_versions set sha256 = $1 where id = $2 and sha256 is null returning id`, [actual.sha256, x.id]);
          if (set.rows.length) res.filled++;
        }
      }
    }
  } catch (err) {
    if (o.actor) {
      await journal(o.pg, o.actor, { ...res, by: o.by, failed: true }).catch(() => {});
    }
    throw err;
  }
  if (o.actor) await journal(o.pg, o.actor, { ...res, by: o.by });
  return res;
}

/**
 * The bytes of a whole file as they are served, checked against `expected` (its recorded SHA-256) on the way: the last
 * chunk is held back until the end, then sent if the bytes match. If they do not, `onMismatch` is called and the stream
 * fails instead: the receiver gets an incomplete transfer rather than an altered file that looks whole.
 * @param {ReadableStream<Uint8Array>} body
 * @param {string} expected
 * @param {() => Promise<void>} onMismatch
 * @returns {ReadableStream<Uint8Array>}
 */
export function verifiedStream(body, expected, onMismatch) {
  const h = createHash('sha256');
  /** @type {Uint8Array | null} */
  let held = null;
  return body.pipeThrough(new TransformStream({
    transform(chunk, c) {
      h.update(chunk);
      if (held) c.enqueue(held);
      held = chunk;
    },
    async flush(c) {
      if (h.digest('hex') !== expected) {
        await onMismatch().catch(() => {});
        c.error(new Error('stored file altered: SHA-256 differs from the one recorded'));
        return;
      }
      if (held) c.enqueue(held);
    },
  }));
}
