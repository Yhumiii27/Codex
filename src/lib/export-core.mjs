// @ts-check
// Full export of Codex's data, to leave Codex or feed another system (point 17 of docs/reste-a-faire.md; format:
// docs/export.md). Plain JavaScript, Node built-ins only, like lib/backup-core.mjs: the server streams it to a records
// manager (lib/full-export.ts, GET /api/export/full) and the npm command writes it to a file (scripts/codex-export.mjs).
//
// One ZIP archive, written as a stream (nothing is held whole in memory, nor written twice):
//   LISEZMOI.txt                      what the archive holds and how to check it
//   data/<table>.json                 every table of the database, row by row (columns named as in src/db/schema.ts)
//   data/documents.csv                the documents' metadata for a spreadsheet
//   files/{ID}/{ID}_{letter}.{n}.ext  the file of every working version
//   import/documents.json             each document as POST /api/import takes it, with the file to send
//   SHA256SUMS                        the SHA-256 of every entry above (sha256sum -c)
//   manifest.json                     last: format, date, schema, counts, every entry with its size and SHA-256
//
// Complete, drafts included: no D-14 filter. The server restricts it to records managers with access to Administration
// (lib/access.ts mayExportAll) and journals it (actions 'export_full' and 'export_full_end').
//
// Consistency: every table but the journal is copied into temporary tables in one transaction (seconds; writes wait
// meanwhile on PGlite, as for a backup), and read from them afterwards in batches. The journal, append-only, is read up
// to the last entry of that transaction. On a PostgreSQL server (DATABASE_URL) the transaction is REPEATABLE READ, so
// that every table is copied from the same snapshot while writes go on, and the whole export runs on one connection
// (`session()` of src/db/sql-client.ts), the only one that sees its temporary tables (unlogged tables of the schema
// codex where the role may not create temporary ones: the shared server). There, a journal entry written by
// a transaction still running at the snapshot, with a lower number than its last entry, may be in the export or not.
// Files are read as the export goes: a stored file is never written again, and one renamed meanwhile (a
// reclassification) is looked up again under the key its working version now records.

import { createHash, randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';

export const FORMAT = 'codex-export';
export const FORMAT_VERSION = 1;
export const MANIFEST_ENTRY = 'manifest.json';
export const SUMS_ENTRY = 'SHA256SUMS';
export const README_ENTRY = 'LISEZMOI.txt';
export const DOCUMENTS_CSV = 'data/documents.csv';
export const IMPORT_ENTRY = 'import/documents.json';
/**
 * Derived tables, left out: the search index, which the database writes from the documents (src/db/index.ts,
 * documents_terms), and the PDF renderings of the preview (version_previews, lib/office-preview.ts), whose files the
 * archive does not carry either: both are made again from what the export holds.
 */
export const DERIVED_TABLES = ['document_terms', 'version_previews'];
const JOURNAL = 'audit_log';
const BATCH = 1000;
const FILE_BATCH = 200;

const U16 = 0xffff;
const U32 = 0xffffffff;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
/** General purpose flags: sizes and CRC-32 after the data (bit 3), names in UTF-8 (bit 11). */
const FLAGS = 0x0808;
/** Unix permissions of the extracted files: readable by their owner only, like the backups. */
const MODE = 0o100600;

/**
 * @typedef {'duplicate' | 'entry_too_large' | 'not_zip' | 'truncated' | 'unsupported' | 'format' | 'entry_missing'
 *   | 'entry_unexpected' | 'entry_corrupt' | 'sums_mismatch'} ExportErrorCode
 */

/** A damaged or unexpected archive, or an entry ZIP cannot carry; the code is put into words by the command. */
export class ExportError extends Error {
  /**
   * @param {ExportErrorCode} code
   * @param {string} [detail]
   */
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExportError';
    this.code = code;
    this.detail = detail;
  }
}

/** @param {Date} date */
export function exportName(date) {
  return `codex-export-${date.toISOString().replace(/[:.]/g, '-')}.zip`;
}

// ── ZIP writer ──────────────────────────────────────────────────────────

/**
 * Date and time of an entry, as ZIP stores them (MS-DOS format, local time, two-second steps).
 * @param {Date} d
 */
function dosStamp(d) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** @param {Uint8Array | string} chunk */
function asBuffer(chunk) {
  return typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

/**
 * Writes a ZIP archive as a stream of buffers (APPNOTE 6.3): entries stored without compression (the files are mostly
 * compressed already), their CRC-32 and sizes in a data descriptor after their bytes, since neither is known before
 * they are read: readers that go by the central directory (unzip and Python's zipfile tried) read it, streaming readers
 * that do not (Java's ZipInputStream) cannot. Zip64 end records once the archive passes 4 GiB or 65 534 entries; an
 * entry of 4 GiB or more is refused (a file of Codex is at most CODEX_MAX_FILE_MB). Hashes every byte it writes.
 */
export class ZipWriter {
  /**
   * @param {{ date?: Date, limits?: { offset?: number, entries?: number, size?: number } }} [o] `limits`: thresholds of
   *   the zip64 records and largest entry, lowered by the tests only
   */
  constructor(o = {}) {
    this.offset = 0;
    /** @type {{ name: Buffer, crc: number, size: number, offset: number }[]} */
    this.central = [];
    /** @type {Set<string>} */
    this.names = new Set();
    this.hash = createHash('sha256');
    this.stamp = dosStamp(o.date ?? new Date());
    this.maxOffset = o.limits?.offset ?? U32;
    this.maxEntries = o.limits?.entries ?? U16;
    this.maxSize = o.limits?.size ?? U32;
  }

  /** @param {Buffer} buf */
  out(buf) {
    this.offset += buf.length;
    this.hash.update(buf);
    return buf;
  }

  /**
   * One entry: yields its local header, its bytes as `data` gives them, then its data descriptor; returns its name,
   * size and SHA-256.
   * @param {string} name
   * @param {AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>} data
   * @returns {AsyncGenerator<Buffer, { name: string, size: number, sha256: string }>}
   */
  async *entry(name, data) {
    if (this.names.has(name)) throw new ExportError('duplicate', name);
    this.names.add(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const offset = this.offset;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(SIG_LOCAL, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(FLAGS, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(this.stamp.time, 10);
    h.writeUInt16LE(this.stamp.date, 12);
    h.writeUInt16LE(nameBuf.length, 26);
    yield this.out(Buffer.concat([h, nameBuf]));
    const sha = createHash('sha256');
    let crc = 0;
    let size = 0;
    for await (const chunk of data) {
      const buf = asBuffer(chunk);
      if (!buf.length) continue;
      size += buf.length;
      if (size >= this.maxSize) throw new ExportError('entry_too_large', name);
      crc = crc32(buf, crc);
      sha.update(buf);
      yield this.out(buf);
    }
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(SIG_DESCRIPTOR, 0);
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(size, 8);
    dd.writeUInt32LE(size, 12);
    yield this.out(dd);
    this.central.push({ name: nameBuf, crc: crc >>> 0, size, offset });
    return { name, size, sha256: sha.digest('hex') };
  }

  /**
   * The central directory and the end records; returns the size and SHA-256 of the whole archive.
   * @returns {Generator<Buffer, { size: number, sha256: string }>}
   */
  *end() {
    const start = this.offset;
    for (const e of this.central) {
      const z64 = e.offset >= this.maxOffset;
      const extra = Buffer.alloc(z64 ? 12 : 0);
      if (z64) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(e.offset), 4);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE((3 << 8) | (z64 ? 45 : 20), 4); // made by Unix, for the permissions below
      h.writeUInt16LE(z64 ? 45 : 20, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE((MODE << 16) >>> 0, 38);
      h.writeUInt32LE(z64 ? U32 : e.offset, 42);
      yield this.out(Buffer.concat([h, e.name, extra]));
    }
    const cdSize = this.offset - start;
    const count = this.central.length;
    const z64 = count >= this.maxEntries || start >= this.maxOffset || cdSize >= this.maxOffset;
    if (z64) {
      const at = this.offset;
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(SIG_END64, 0);
      rec.writeBigUInt64LE(BigInt(44), 4);
      rec.writeUInt16LE((3 << 8) | 45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(count), 24);
      rec.writeBigUInt64LE(BigInt(count), 32);
      rec.writeBigUInt64LE(BigInt(cdSize), 40);
      rec.writeBigUInt64LE(BigInt(start), 48);
      yield this.out(rec);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(SIG_LOCATOR64, 0);
      loc.writeBigUInt64LE(BigInt(at), 8);
      loc.writeUInt32LE(1, 16);
      yield this.out(loc);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_END, 0);
    eocd.writeUInt16LE(z64 ? U16 : count, 8);
    eocd.writeUInt16LE(z64 ? U16 : count, 10);
    eocd.writeUInt32LE(z64 ? U32 : cdSize, 12);
    eocd.writeUInt32LE(z64 ? U32 : start, 16);
    yield this.out(eocd);
    return { size: this.offset, sha256: this.hash.digest('hex') };
  }
}

// ── ZIP reader (checks) ─────────────────────────────────────────────────

/**
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {number} position
 * @param {number} length
 */
async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  for (let off = 0; off < length;) {
    const { bytesRead } = await fh.read(buf, off, length - off, position + off);
    if (!bytesRead) throw new ExportError('truncated');
    off += bytesRead;
  }
  return buf;
}

/** @typedef {{ name: string, size: number, crc: number, offset: number }} ZipEntry */

/**
 * The entries of a ZIP archive, in the order of its central directory: name, size, CRC-32, where their bytes start.
 * Zip64 end records and offsets are read; a compressed, encrypted or split archive is refused (Codex writes none).
 * @param {import('node:fs/promises').FileHandle} fh
 * @returns {Promise<ZipEntry[]>}
 */
export async function zipEntries(fh) {
  const { size: total } = await fh.stat();
  if (total < 22) throw new ExportError('not_zip');
  const tailLen = Math.min(total, 22 + U16);
  const tail = await readAt(fh, total - tailLen, tailLen);
  let at = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_END && i + 22 + tail.readUInt16LE(i + 20) === tailLen) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ExportError('not_zip');
  let count = tail.readUInt16LE(at + 10);
  let cdSize = tail.readUInt32LE(at + 12);
  let cdStart = tail.readUInt32LE(at + 16);
  if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) throw new ExportError('unsupported', 'split archive');
  if (count === U16 || cdSize === U32 || cdStart === U32) {
    const endPos = total - tailLen + at;
    if (endPos < 20) throw new ExportError('not_zip');
    const loc = await readAt(fh, endPos - 20, 20);
    if (loc.readUInt32LE(0) !== SIG_LOCATOR64) throw new ExportError('not_zip', 'zip64 locator');
    const recPos = Number(loc.readBigUInt64LE(8));
    if (recPos + 56 > endPos) throw new ExportError('not_zip', 'zip64 record');
    const rec = await readAt(fh, recPos, 56);
    if (rec.readUInt32LE(0) !== SIG_END64) throw new ExportError('not_zip', 'zip64 record');
    count = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdStart = Number(rec.readBigUInt64LE(48));
  }
  if (cdStart + cdSize > total) throw new ExportError('truncated');
  const cd = await readAt(fh, cdStart, cdSize);
  /** @type {ZipEntry[]} */
  const entries = [];
  for (let p = 0, i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new ExportError('not_zip', `central entry ${i}`);
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let packed = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw new ExportError('not_zip', `central entry ${i}`);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    if (method !== 0 || flags & 0x0001) throw new ExportError('unsupported', `${name}: compressed or encrypted`);
    // Zip64 extra field: the 8-byte values of the fields set to 0xFFFFFFFF, in this order.
    for (let x = p + 46 + nameLen, xEnd = x + extraLen; x + 4 <= xEnd;) {
      const id = cd.readUInt16LE(x);
      const len = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let v = x + 4;
        if (size === U32) { size = Number(cd.readBigUInt64LE(v)); v += 8; }
        if (packed === U32) { packed = Number(cd.readBigUInt64LE(v)); v += 8; }
        if (offset === U32) { offset = Number(cd.readBigUInt64LE(v)); v += 8; }
      }
      x += 4 + len;
    }
    if (packed !== size) throw new ExportError('unsupported', `${name}: compressed`);
    const local = await readAt(fh, offset, 30);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new ExportError('not_zip', `local header of ${name}`);
    const localName = (await readAt(fh, offset + 30, local.readUInt16LE(26))).toString('utf8');
    if (localName !== name) throw new ExportError('not_zip', `local header of ${name}`);
    const start = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (start + size > total) throw new ExportError('truncated');
    entries.push({ name, size, crc, offset: start });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * The bytes of an entry, in chunks of at most 1 MiB.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {ZipEntry} e
 */
export async function* entryBytes(fh, e) {
  for (let done = 0; done < e.size;) {
    const n = Math.min(1 << 20, e.size - done);
    yield await readAt(fh, e.offset + done, n);
    done += n;
  }
}

/**
 * The whole bytes of an entry (small entries: the manifest, the sums, a JSON table in a test).
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {ZipEntry} e
 */
export async function entryBuffer(fh, e) {
  return readAt(fh, e.offset, e.size);
}

/**
 * Checks an export archive whole: every entry against its CRC-32, the manifest's size and SHA-256 of every entry,
 * SHA256SUMS against the manifest, nothing missing nor unexpected. Returns its manifest.
 * @param {import('node:fs/promises').FileHandle} fh
 * @returns {Promise<Manifest>}
 */
export async function verifyExport(fh) {
  const entries = await zipEntries(fh);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const me = byName.get(MANIFEST_ENTRY);
  if (!me) throw new ExportError('entry_missing', MANIFEST_ENTRY);
  /** @type {Manifest} */
  let m;
  try {
    m = JSON.parse((await entryBuffer(fh, me)).toString('utf8'));
  } catch {
    throw new ExportError('format', 'manifest.json is not JSON');
  }
  if (m?.format !== FORMAT || m.version !== FORMAT_VERSION || !Array.isArray(m.entries)) throw new ExportError('format', `${m?.format} ${m?.version}`);
  const listed = new Set(m.entries.map((x) => x.name));
  for (const e of entries) {
    if (e.name !== MANIFEST_ENTRY && !listed.has(e.name)) throw new ExportError('entry_unexpected', e.name);
  }
  for (const x of m.entries) {
    const e = byName.get(x.name);
    if (!e) throw new ExportError('entry_missing', x.name);
    const sha = createHash('sha256');
    let crc = 0;
    for await (const chunk of entryBytes(fh, e)) {
      sha.update(chunk);
      crc = crc32(chunk, crc);
    }
    if (e.size !== x.size || sha.digest('hex') !== x.sha256 || crc >>> 0 !== e.crc) throw new ExportError('entry_corrupt', x.name);
  }
  const sums = byName.get(SUMS_ENTRY);
  if (!sums) throw new ExportError('entry_missing', SUMS_ENTRY);
  const expected = m.entries.filter((x) => x.name !== SUMS_ENTRY).map((x) => `${x.sha256}  ${x.name}\n`).join('');
  if ((await entryBuffer(fh, sums)).toString('utf8') !== expected) throw new ExportError('sums_mismatch');
  return m;
}

// ── Reading the database ────────────────────────────────────────────────

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>, exec: (sql: string) => Promise<unknown> }} Queryable */
/**
 * @typedef {Queryable & { transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
 *   session?: () => Promise<Queryable & { transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>, release: () => void }> }} Database
 */
/** @typedef {{ name: string, columns: string[], order: string[] }} TableInfo */
/** @typedef {{ tag: string, hash: string, createdAt: number }} Migration */

/** @param {string} id */
const ident = (id) => `"${id.replace(/"/g, '""')}"`;

/**
 * A column's name in the archive: its name in src/db/schema.ts (label_fr → labelFr), which is also the import API's.
 * @param {string} column
 */
export function fieldName(column) {
  return column.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * The tables of the application (schema codex, but the journal of the migrations), each with its columns in order and the columns that order its rows
 * (its primary key, else every column).
 * @param {Queryable} q
 * @returns {Promise<TableInfo[]>}
 */
async function listTables(q) {
  const { rows } = await q.query(`select c.relname::text as name,
      (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
      (select array_agg(a.attname::text order by k.ord) from pg_index i
        cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where i.indrelid = c.oid and i.indisprimary) as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind in ('r', 'p') and c.relname not like 'codex\\_export\\_%' and c.relname <> '__drizzle_migrations' order by c.relname`);
  return rows.map((r) => ({ name: r.name, columns: r.columns, order: r.pk?.length ? r.pk : r.columns }));
}

/**
 * `select` list naming each column as in the archive.
 * @param {string[]} columns
 * @param {string} [alias]
 */
function aliased(columns, alias) {
  return columns.map((c) => `${alias ? `${alias}.` : ''}${ident(c)} as ${ident(fieldName(c))}`).join(', ');
}

/**
 * @typedef {object} Snapshot
 * @property {string} tag prefix of the temporary tables
 * @property {TableInfo[]} tables copied, in name order
 * @property {Record<string, number>} rows per table, the journal included (up to `journalMax`)
 * @property {TableInfo} journal
 * @property {number} journalMax last journal entry exported
 * @property {{ hash: string, createdAt: number } | null} migration
 * @property {string} postgres
 * @property {{ count: number, bytes: number }} files working versions with a file, and their recorded size
 */

/**
 * Copies every table but the journal and the derived ones into temporary tables, in one transaction; `onStart` runs in
 * it (the journal entry of the export), and the journal is exported up to the last entry it then holds.
 * @param {Database} pg
 * @param {(tx: Queryable, s: Omit<Snapshot, 'journalMax'>) => Promise<void>} onStart
 * @returns {Promise<Snapshot>}
 */
async function takeSnapshot(pg, onStart) {
  const tag = `codex_export_${randomBytes(6).toString('hex')}`;
  return pg.transaction(async (tx) => {
    // First statement of the transaction: one snapshot for every table (a no-op for PGlite's one connection).
    await tx.exec('set transaction isolation level repeatable read');
    const all = await listTables(tx);
    // The shared EPC2I server gives Codex's role no TEMPORARY on the database (Matrix, infra/postgres/init/01): the copies
    // are then unlogged tables of the schema codex, under the same names, dropped as temporary ones are (dropSnapshot).
    // An export cut short by a crash leaves them behind (codex_export_*, never read by another export: listTables).
    const [{ temp }] = (await tx.query(`select has_database_privilege(current_database(), 'TEMPORARY') as temp`)).rows;
    const kind = temp ? 'temp' : 'unlogged';
    const journal = all.find((t) => t.name === JOURNAL);
    if (!journal) throw new ExportError('format', 'no audit_log table');
    const tables = all.filter((t) => t.name !== JOURNAL && !DERIVED_TABLES.includes(t.name));
    /** @type {Record<string, number>} */
    const rows = {};
    for (const t of tables) {
      const snap = ident(`${tag}_${t.name}`);
      // __n numbers the rows in the table's order, so that they are read back in batches without sorting again.
      await tx.exec(`create ${kind} table ${snap} as select row_number() over (order by ${t.order.map((c) => `t.${ident(c)}`).join(', ')}) as __n, t.* from ${ident(t.name)} t;
        create index on ${snap} (__n);`);
      rows[t.name] = (await tx.query(`select count(*)::int as n from ${snap}`)).rows[0].n;
    }
    // A failed query would abort the transaction: the migrations' table is looked up first.
    const [{ migrations }] = (await tx.query(`select to_regclass('codex.__drizzle_migrations')::text as migrations`)).rows;
    const [m] = migrations ? (await tx.query(`select hash, created_at::text as created_at from ${migrations} order by created_at desc limit 1`)).rows : [];
    const [v] = (await tx.query('select version() as v')).rows;
    const wv = tables.some((t) => t.name === 'working_versions')
      ? (await tx.query(`select count(*)::int as n, coalesce(sum(size), 0)::float8 as bytes from ${ident(`${tag}_working_versions`)} where file_key is not null`)).rows[0]
      : { n: 0, bytes: 0 };
    const base = {
      tag, tables, rows, journal,
      migration: m ? { hash: String(m.hash), createdAt: Number(m.created_at) } : null,
      postgres: /^PostgreSQL \S+(?: \(PGlite [^)]+\))?/.exec(String(v.v))?.[0] ?? String(v.v),
      files: { count: wv.n, bytes: wv.bytes },
    };
    await onStart(tx, base);
    const [j] = (await tx.query(`select coalesce(max(id), 0)::int as max, count(*)::int as n from ${JOURNAL}`)).rows;
    return { ...base, rows: { ...rows, [JOURNAL]: j.n }, journalMax: j.max };
  });
}

/**
 * @param {Database} pg
 * @param {Snapshot} snap
 */
async function dropSnapshot(pg, snap) {
  for (const t of snap.tables) await pg.exec(`drop table if exists ${ident(`${snap.tag}_${t.name}`)}`);
}

/**
 * The rows of a copied table, as JSON texts with the archive's field names, in batches.
 * @param {Queryable} q
 * @param {Snapshot} snap
 * @param {TableInfo} t
 */
async function* snapshotRows(q, snap, t) {
  const from = ident(`${snap.tag}_${t.name}`);
  for (let n = 0; n < snap.rows[t.name]; n += BATCH) {
    const { rows } = await q.query(`select row_to_json(r)::text as j from (select ${aliased(t.columns)} from ${from}
      where __n > $1 and __n <= $2 order by __n) r`, [n, n + BATCH]);
    yield rows.map((r) => /** @type {string} */ (r.j));
  }
}

/**
 * The journal up to the snapshot's last entry, oldest first, in batches (keyset on its id).
 * @param {Queryable} q
 * @param {Snapshot} snap
 */
async function* journalRows(q, snap) {
  for (let after = 0; ;) {
    const { rows } = await q.query(`select a.id as k, (select row_to_json(z)::text from (select ${aliased(snap.journal.columns, 'a')}) z) as j
      from ${JOURNAL} a where a.id > $1 and a.id <= $2 order by a.id limit ${BATCH}`, [after, snap.journalMax]);
    if (!rows.length) return;
    after = rows[rows.length - 1].k;
    yield rows.map((r) => /** @type {string} */ (r.j));
  }
}

/**
 * A JSON array written batch by batch, one element per line.
 * @param {AsyncIterable<string[]>} batches
 * @param {{ count: number }} [tally]
 */
async function* jsonArray(batches, tally) {
  let first = true;
  for await (const b of batches) {
    if (!b.length) continue;
    if (tally) tally.count += b.length;
    yield `${first ? '[\n' : ',\n'}${b.join(',\n')}`;
    first = false;
  }
  yield first ? '[]\n' : '\n]\n';
}

// ── CSV of the documents ────────────────────────────────────────────────

/**
 * One cell, as lib/csv.ts writes them: lists joined by a comma, other structured values in JSON, formulas neutralised.
 * @param {unknown} v
 */
function csvCell(v) {
  const s = v == null ? '' : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** @param {unknown[]} cells */
const csvLine = (cells) => `${cells.map(csvCell).join(';')}\r\n`;

/**
 * @param {Queryable} q
 * @param {Snapshot} snap
 * @param {TableInfo} t
 */
async function* documentsCsv(q, snap, t) {
  const fields = t.columns.map(fieldName);
  yield `﻿${csvLine(fields)}`;
  for await (const batch of snapshotRows(q, snap, t)) {
    yield batch.map((j) => {
      const o = JSON.parse(j);
      return csvLine(fields.map((f) => o[f]));
    }).join('');
  }
}

// ── Files ───────────────────────────────────────────────────────────────

/**
 * Extension of a stored file in the archive: that of its recorded name, else of its key (local store), lower case.
 * @param {string | null} fileName
 * @param {string} fileKey
 */
export function fileExt(fileName, fileKey) {
  for (const n of [fileName ?? '', fileKey]) {
    const base = n.split(/[\\/]/).pop() ?? '';
    const i = base.lastIndexOf('.');
    const ext = i > 0 ? base.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    if (ext && ext.length <= 16) return `.${ext}`;
  }
  return '';
}

/**
 * Where a working version's file goes in the archive: files/{ID}/{ID}_{letter}.{n}{ext}.
 * @param {string} docId
 * @param {string} letter
 * @param {number} n
 * @param {string} ext
 */
export function filePath(docId, letter, n, ext) {
  const id = docId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return `files/${id}/${id}_${letter.replace(/[^A-Za-z0-9]/g, '_')}.${n}${ext}`;
}

/**
 * @typedef {{ workingVersion: number, docId: string, letter: string, n: number, storage: string, fileKey: string,
 *   fileName: string | null, mime: string | null, size: number | null, sha256?: string | null }} StoredRef `sha256`: the one recorded
 *   when the file entered Codex, null when none was
 * @typedef {(f: StoredRef) => Promise<AsyncIterable<Uint8Array> | null | 'skipped'>} FileOpener the file's bytes; null when
 *   the store has no such file; 'skipped' when this process cannot reach its store (SharePoint from the command line)
 */

/**
 * Working versions with a file, in the order of the archive (document, then version), in batches.
 * @param {Queryable} q
 * @param {Snapshot} snap
 * @returns {AsyncGenerator<StoredRef[]>}
 */
async function* storedFiles(q, snap) {
  const w = ident(`${snap.tag}_working_versions`);
  const r = ident(`${snap.tag}_revisions`);
  for (let after = { doc: '', id: 0 }; ;) {
    const { rows } = await q.query(`select w.id, w.doc_id, r.letter, w.n, coalesce(w.storage, 'local') as storage, w.file_key, w.file_name, w.mime, w.size, w.sha256
      from ${w} w join ${r} r on r.id = w.revision_id
      where w.file_key is not null and (w.doc_id, w.id) > ($1, $2) order by w.doc_id, w.id limit ${FILE_BATCH}`, [after.doc, after.id]);
    if (!rows.length) return;
    after = { doc: rows[rows.length - 1].doc_id, id: rows[rows.length - 1].id };
    yield rows.map((x) => ({
      workingVersion: x.id, docId: x.doc_id, letter: x.letter, n: x.n, storage: x.storage, fileKey: x.file_key, fileName: x.file_name, mime: x.mime, size: x.size,
      sha256: x.sha256 ?? null,
    }));
  }
}

// ── Import view ─────────────────────────────────────────────────────────

const READERS_APPLY = new Set(['confidentiel', 'tres_confidentiel']);

/**
 * The revision a document would be imported with (POST /api/import takes one): the one in force; else one approved
 * with its effective date, imported « in force » on that date (the import leaves it approved until then if it is still
 * to come); else the latest revision, as a draft.
 * @param {{ id: number, letter: string, status: string, in_force_at: string | null, effective_at: string | null }[]} revs in creation order
 */
export function importRevision(revs) {
  const inForce = revs.findLast((r) => r.status === 'in_force');
  if (inForce) return { rev: inForce, status: 'in_force', inForceAt: inForce.in_force_at };
  const approved = revs.findLast((r) => r.status === 'approved' && r.effective_at);
  if (approved) return { rev: approved, status: 'in_force', inForceAt: approved.effective_at };
  const last = revs.at(-1);
  return last ? { rev: last, status: 'draft', inForceAt: null } : null;
}

/**
 * The `meta` of POST /api/import for one document (docs/api.md): its current ID as legacy reference, so that an ID
 * of Codex's format is kept by the importing Codex when free; the fields of its context only; null values left out.
 * @param {Record<string, any>} d the document, with the archive's field names
 * @param {ReturnType<typeof importRevision>} pick
 * @param {string[]} readers
 */
export function importMeta(d, pick, readers) {
  const ext = d.origin === 'externe';
  const proj = d.attachment === 'project';
  const res = d.attachment === 'research';
  /** @type {Record<string, unknown>} */
  const meta = {
    legacyRef: d.id, title: d.title, typeCode: d.typeCode, subtype: d.subtype, origin: d.origin, attachment: d.attachment,
    projectCode: proj ? d.projectCode : null, programCode: res ? d.programCode : null, department: d.department, site: d.site,
    ownerId: d.ownerId, author: d.authorId ?? d.authorText, conf: d.conf, readers: READERS_APPLY.has(d.conf) && readers.length ? readers : null,
    keywords: d.keywords?.length ? d.keywords : null, lang: d.lang,
    revision: pick?.rev.letter ?? null, status: pick?.status ?? 'draft', inForceAt: pick?.inForceAt ?? null,
    issuedAt: d.issuedAt, reviewDueAt: d.reviewDueAt, expiresAt: d.expiresAt, createdAt: d.createdAt, modifiedAt: d.modifiedAt,
    sourceOrg: ext ? d.sourceOrg : null, externalRef: ext ? d.externalRef : null, receivedAt: ext ? d.receivedAt : null,
    projectPhase: proj ? d.projectPhase : null, workPackage: proj ? d.workPackage : null, discipline: proj ? d.discipline : null,
    researchTheme: res ? d.researchTheme : null, studyId: res ? d.studyId : null, ipStatus: res ? d.ipStatus : null,
    processOwnerId: d.origin === 'interne' ? d.processOwnerId : null,
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null && v !== ''));
}

/**
 * import/documents.json: one element per document, what POST /api/import takes (meta, and the file of its revision
 * when it has one and the archive holds it), with what the import does not carry over (state, legal hold).
 * @param {Queryable} q
 * @param {Snapshot} snap
 * @param {TableInfo} docs
 * @param {Map<number, string>} archived working version → its path in the archive
 */
async function* importView(q, snap, docs, archived) {
  /** @param {string} name */
  const t = (name) => ident(`${snap.tag}_${name}`);
  for await (const batch of snapshotRows(q, snap, docs)) {
    const ds = batch.map((j) => JSON.parse(j));
    const ids = ds.map((d) => d.id);
    const [revs, readers, versions] = await Promise.all([
      q.query(`select id, doc_id, letter, status, in_force_at::text, effective_at::text from ${t('revisions')} where doc_id = any($1) order by id`, [ids]),
      q.query(`select doc_id, user_id from ${t('document_readers')} where doc_id = any($1) order by user_id`, [ids]),
      q.query(`select id, revision_id, n, file_name, mime from ${t('working_versions')} where doc_id = any($1) order by revision_id, n`, [ids]),
    ]);
    yield ds.map((d) => {
      const pick = importRevision(revs.rows.filter((r) => r.doc_id === d.id));
      const last = pick ? versions.rows.filter((v) => v.revision_id === pick.rev.id).at(-1) : undefined;
      const file = last ? archived.get(last.id) ?? null : null;
      return JSON.stringify({
        id: d.id, state: d.state, legalHold: d.legalHold,
        meta: importMeta(d, pick, readers.rows.filter((r) => r.doc_id === d.id).map((r) => r.user_id)),
        file, fileName: file ? last.file_name : null, mime: file ? last.mime : null,
      });
    });
  }
}

// ── Export ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} Manifest
 * @property {string} format
 * @property {number} version
 * @property {string} createdAt UTC instant of the snapshot
 * @property {'online' | 'offline'} mode online: from the application, server running; offline: npm run export
 * @property {string} by who asked (online), 'cli' (offline)
 * @property {string | null} app version of Codex (package.json)
 * @property {{ migration: string | null, hash: string | null, postgres: string }} schema last migration applied to the database
 * @property {Record<string, number>} counts rows of every table exported, `files` the files in the archive
 * @property {Record<string, string>} tables entry of every table
 * @property {{ count: number, bytes: number, missing: { workingVersion: number, path: string }[],
 *   skipped: { workingVersion: number, path: string, storage: string }[],
 *   altered?: { workingVersion: number, path: string, recorded: string }[] }} files the files archived and their size;
 *   those the store did not have; those kept by a store this process cannot reach, not archived; those archived whose
 *   bytes differ from the SHA-256 recorded when they entered Codex (`recorded`; the entry's own is in `entries`)
 * @property {{ name: string, size: number, sha256: string, workingVersion?: number }[]} entries every entry but the manifest
 */

/**
 * What the journal keeps of an export (actions 'export_full', 'export_full_end'): counts and sizes, no document named.
 * @typedef {{ documents?: number, files?: number, bytes?: number, size?: number, sha256?: string, missing?: number,
 *   skipped?: number, altered?: number, interrupted?: boolean, failed?: boolean }} ArchiveJournal
 */

/**
 * Journals an export in `q`, raw SQL like lib/backup-core.mjs journal(): target 'export' 'full'.
 * @param {Queryable} q
 * @param {string} actor
 * @param {'export_full' | 'export_full_end'} action
 * @param {ArchiveJournal} archive
 */
async function journalExport(q, actor, action, archive) {
  await q.query(
    `insert into audit_log (at, user_id, action, target_kind, target_id, detail, data) values ($1, $2, $3, 'export', 'full', '', $4::jsonb)`,
    [new Date().toISOString(), actor, action, JSON.stringify({ archive })],
  );
}

/** @param {Date} now */
function readme(now) {
  return [
    'Export complet de Codex, la GED du groupe EPC2I',
    `Fait le ${now.toISOString()} (UTC).`,
    '',
    'Contenu :',
    '  manifest.json          date, version du schéma, comptes, taille et SHA-256 de chaque élément',
    '  SHA256SUMS             empreintes, vérifiables par : sha256sum -c SHA256SUMS (dans le dossier extrait)',
    '  data/<table>.json      chaque table de la base, ligne par ligne (tableaux JSON)',
    '  data/documents.csv     métadonnées des documents (UTF-8, point-virgule)',
    '  files/{ID}/...         fichier de chaque version de travail : {ID}_{lettre}.{n}.{extension}',
    '  import/documents.json  chaque document au format de POST /api/import, avec le fichier à envoyer',
    '',
    'Le format est décrit dans docs/export.md du dépôt Codex.',
    'Cette archive contient tous les documents, brouillons et documents confidentiels compris : à conserver en lieu sûr.',
    '',
  ].join('\n');
}

/**
 * @typedef {object} ExportResult
 * @property {Manifest} manifest
 * @property {number} size of the whole archive
 * @property {string} sha256 of the whole archive
 */

/**
 * Streams the export archive of the database `pg` (the one connection of the process that holds it). Journals its
 * start by `actor` in the snapshot transaction (so the archive holds that entry) and its end: done (archive size and
 * SHA-256: written to the reader, not known to be received), interrupted (the reader stopped: return() on the generator)
 * or failed. Without `actor`, journals nothing.
 * @param {object} o
 * @param {Database} o.pg
 * @param {FileOpener} o.openFile
 * @param {string | null} o.actor user the journal records the export under
 * @param {'online' | 'offline'} o.mode
 * @param {string} o.by
 * @param {Migration[]} o.migrations the code's, to name the database's last migration
 * @param {string | null} [o.app]
 * @param {Date} [o.now]
 * @param {{ offset?: number, entries?: number, size?: number }} [o.zipLimits] tests only
 * @param {(msg: string, err: unknown) => void} [o.warn] where a cleanup failure is reported (default: console.warn, for
 *   the command line; the server passes its structured log)
 * @returns {AsyncGenerator<Buffer, ExportResult>}
 */
export async function* exportArchive(o) {
  const now = o.now ?? new Date();
  const warn = o.warn ?? ((msg, err) => console.warn(`[export] ${msg}`, err));
  const zip = new ZipWriter({ date: now, limits: o.zipLimits });
  /** @type {Snapshot | null} */
  let snap = null;
  /** @type {ArchiveJournal | null} */
  let outcome = null;
  /** @type {Manifest['files']} */
  const files = { count: 0, bytes: 0, missing: [], skipped: [], altered: [] };
  // A server's pool hands each query any connection: the export keeps one, which alone sees its temporary tables.
  const pinned = o.pg.session ? await o.pg.session() : null;
  /** @type {Database} */
  const pg = pinned ?? o.pg;
  try {
    snap = await takeSnapshot(pg, async (tx, s) => {
      if (o.actor) await journalExport(tx, o.actor, 'export_full', { documents: s.rows.documents ?? 0, files: s.files.count, bytes: s.files.bytes });
    });
    const s = snap;
    /** @type {Manifest['entries']} */
    const entries = [];
    entries.push(yield* zip.entry(README_ENTRY, [readme(now)]));
    /** @type {Record<string, string>} */
    const tables = {};
    for (const t of s.tables) {
      tables[t.name] = `data/${t.name}.json`;
      entries.push(yield* zip.entry(tables[t.name], jsonArray(snapshotRows(pg, s, t))));
    }
    const tally = { count: 0 };
    tables[JOURNAL] = `data/${JOURNAL}.json`;
    entries.push(yield* zip.entry(tables[JOURNAL], jsonArray(journalRows(pg, s), tally)));
    s.rows[JOURNAL] = tally.count;
    const docs = s.tables.find((t) => t.name === 'documents');
    if (docs) entries.push(yield* zip.entry(DOCUMENTS_CSV, documentsCsv(pg, s, docs)));

    /** @type {Map<number, string>} */
    const archived = new Map();
    for await (const batch of storedFiles(pg, s)) {
      for (const f of batch) {
        let where = filePath(f.docId, f.letter, f.n, fileExt(f.fileName, f.fileKey));
        // Two IDs that read the same once made safe for a path (none of Codex's format do): the second is told apart.
        if (zip.names.has(where)) where = where.replace(/(\.[a-z0-9]+)?$/, `~${f.workingVersion}$1`);
        let data = await o.openFile(f);
        if (data === null) {
          // Renamed since the snapshot (a reclassification): the working version records its new key.
          const [cur] = (await pg.query(`select coalesce(storage, 'local') as storage, file_key from working_versions where id = $1`, [f.workingVersion])).rows;
          if (cur?.file_key && cur.file_key !== f.fileKey) data = await o.openFile({ ...f, storage: cur.storage, fileKey: cur.file_key });
        }
        if (data === null) {
          files.missing.push({ workingVersion: f.workingVersion, path: where });
          continue;
        }
        if (data === 'skipped') {
          files.skipped.push({ workingVersion: f.workingVersion, path: where, storage: f.storage });
          continue;
        }
        const e = yield* zip.entry(where, data);
        entries.push({ ...e, workingVersion: f.workingVersion });
        archived.set(f.workingVersion, where);
        files.count++;
        files.bytes += e.size;
        // Archived as stored, and said: the archive keeps what Codex holds, the manifest tells it differs.
        if (f.sha256 && f.sha256 !== e.sha256) files.altered?.push({ workingVersion: f.workingVersion, path: where, recorded: f.sha256 });
      }
    }
    if (docs) entries.push(yield* zip.entry(IMPORT_ENTRY, jsonArray(importView(pg, s, docs, archived))));

    entries.push(yield* zip.entry(SUMS_ENTRY, [entries.map((x) => `${x.sha256}  ${x.name}\n`).join('')]));
    const tag = s.migration ? o.migrations.find((x) => x.hash === s.migration?.hash && x.createdAt === s.migration?.createdAt)?.tag ?? null : null;
    /** @type {Manifest} */
    const manifest = {
      format: FORMAT, version: FORMAT_VERSION, createdAt: now.toISOString(), mode: o.mode, by: o.by, app: o.app ?? null,
      schema: { migration: tag, hash: s.migration?.hash ?? null, postgres: s.postgres },
      counts: { ...s.rows, files: files.count },
      tables,
      files,
      entries,
    };
    yield* zip.entry(MANIFEST_ENTRY, [`${JSON.stringify(manifest, null, 2)}\n`]);
    const { size, sha256 } = yield* zip.end();
    outcome = {
      size, sha256, files: files.count, bytes: files.bytes, ...(files.missing.length ? { missing: files.missing.length } : {}), ...(files.skipped.length ? { skipped: files.skipped.length } : {}),
      ...(files.altered?.length ? { altered: files.altered.length } : {}),
    };
    return { manifest, size, sha256 };
  } catch (err) {
    outcome = { failed: true, size: zip.offset };
    throw err;
  } finally {
    if (snap) {
      await dropSnapshot(pg, snap).catch((err) => warn('temporary tables not dropped', err));
      // Neither done nor failed: the reader stopped before the end.
      if (o.actor) {
        await journalExport(pg, o.actor, 'export_full_end', outcome ?? { interrupted: true, size: zip.offset })
          .catch((err) => warn('end of the export not journaled', err));
      }
    }
    pinned?.release();
  }
}
