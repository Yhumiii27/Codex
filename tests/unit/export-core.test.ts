import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  ExportError, ZipWriter, entryBuffer, exportName, fieldName, fileExt, filePath, importMeta, importRevision, verifyExport, zipEntries,
} from '@/lib/export-core.mjs';

// The pieces of the full export (lib/export-core.mjs, point 17 of docs/reste-a-faire.md) that need no database: the
// streamed ZIP writer and its reader, zip64 records included; the names of columns and files in the archive; the
// revision and the metadata a document would be imported with (POST /api/import, docs/api.md).

const scratch = mkdtempSync(path.join(tmpdir(), 'codex-export-unit-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let n = 0;
/** Writes the archive `entries` make (each a name and its chunks) and returns its path and the writer's result. */
async function zipOf(entries: [string, (string | Buffer)[]][], limits?: { offset?: number; entries?: number; size?: number }) {
  const zip = new ZipWriter({ date: new Date(2026, 9, 15, 10, 30, 4), limits });
  const parts: Buffer[] = [];
  const written = [];
  for (const [name, chunks] of entries) {
    const it = zip.entry(name, chunks);
    for (let r = await it.next(); ; r = await it.next()) {
      if (r.done) {
        written.push(r.value);
        break;
      }
      parts.push(r.value);
    }
  }
  const end = zip.end();
  let total;
  for (let r = end.next(); ; r = end.next()) {
    if (r.done) {
      total = r.value;
      break;
    }
    parts.push(r.value);
  }
  const file = path.join(scratch, `a${n++}.zip`);
  const bytes = Buffer.concat(parts);
  writeFileSync(file, bytes);
  return { file, bytes, written, total };
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function readBack(file: string) {
  const fh = await open(file, 'r');
  try {
    const entries = await zipEntries(fh);
    return await Promise.all(entries.map(async (e) => ({ ...e, data: (await entryBuffer(fh, e)).toString('latin1') })));
  } finally {
    await fh.close();
  }
}

describe('ZipWriter and zipEntries', () => {
  it('writes stored entries with a data descriptor, read back with their names, sizes and CRC-32', async () => {
    const { file, bytes, written, total } = await zipOf([
      ['LISEZMOI.txt', ['Bonjour ', 'à tous\n']],
      ['files/PRO-QUA-0001/PRO-QUA-0001_A.1.pdf', [Buffer.from('%PDF-one'), Buffer.alloc(0), Buffer.from('-two')]],
      ['vide.json', []],
    ]);
    const back = await readBack(file);
    expect(back.map((e) => [e.name, e.size, e.data])).toEqual([
      ['LISEZMOI.txt', Buffer.byteLength('Bonjour à tous\n'), Buffer.from('Bonjour à tous\n').toString('latin1')],
      ['files/PRO-QUA-0001/PRO-QUA-0001_A.1.pdf', 12, '%PDF-one-two'],
      ['vide.json', 0, ''],
    ]);
    expect(back[1].crc).toBe(crc32('%PDF-one-two') >>> 0);
    expect(written.map((w) => w.sha256)).toEqual([sha('Bonjour à tous\n'), sha('%PDF-one-two'), sha('')]);
    // The writer hashes the whole archive as it goes.
    expect(total).toEqual({ size: bytes.length, sha256: sha(bytes) });
    // Local headers: stored (method 0), sizes after the data (bit 3), UTF-8 names (bit 11), no size in the header.
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(6)).toBe(0x0808);
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.readUInt32LE(18)).toBe(0);
    // No zip64 record for a small archive.
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
  });

  it('writes zip64 end records and offsets past the thresholds, and reads them back', async () => {
    const entries: [string, string[]][] = Array.from({ length: 5 }, (_, i) => [`e${i}.txt`, [`entry ${i} `.repeat(20)]]);
    const { file, bytes } = await zipOf(entries, { offset: 300, entries: 3 });
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07]))).toBe(true);
    // The end record defers to the zip64 one.
    const eocd = bytes.subarray(bytes.length - 22);
    expect([eocd.readUInt16LE(10), eocd.readUInt32LE(16)]).toEqual([0xffff, 0xffffffff]);
    const back = await readBack(file);
    expect(back.map((e) => [e.name, e.data])).toEqual(entries.map(([name, [text]]) => [name, text]));
  });

  it('refuses two entries of the same name, and an entry that reaches the size limit of ZIP', async () => {
    const zip = new ZipWriter();
    for await (const _ of zip.entry('a.txt', ['x'])) void _;
    await expect(zip.entry('a.txt', ['y']).next()).rejects.toMatchObject({ code: 'duplicate' });
    const small = new ZipWriter({ limits: { size: 10 } });
    const it = small.entry('big.bin', [Buffer.alloc(6), Buffer.alloc(6)]);
    await expect((async () => { for await (const _ of it) void _; })()).rejects.toMatchObject({ code: 'entry_too_large', detail: 'big.bin' });
  });

  it('refuses what is not a ZIP archive, or one cut short', async () => {
    const { bytes } = await zipOf([['a.txt', ['abc']]]);
    const notZip = path.join(scratch, 'not.zip');
    writeFileSync(notZip, 'plain text, no end record at all');
    const cut = path.join(scratch, 'cut.zip');
    writeFileSync(cut, bytes.subarray(10));
    for (const [f, code] of [[notZip, 'not_zip'], [cut, 'not_zip']] as const) {
      const fh = await open(f, 'r');
      await expect(zipEntries(fh)).rejects.toBeInstanceOf(ExportError);
      await expect(zipEntries(fh)).rejects.toMatchObject({ code });
      await fh.close();
    }
  });
});

describe('verifyExport', () => {
  /** A minimal export archive: one data entry, its sums, its manifest. */
  async function exportLike(alter?: (entries: [string, string[]][]) => void) {
    const data = '[\n{"id":"PRO-QUA-0001"}\n]\n';
    const listed = [{ name: 'data/documents.json', size: Buffer.byteLength(data), sha256: sha(data) }];
    const sums = `${listed[0].sha256}  ${listed[0].name}\n`;
    const manifest = { format: 'codex-export', version: 1, entries: [...listed, { name: 'SHA256SUMS', size: sums.length, sha256: sha(sums) }] };
    const entries: [string, string[]][] = [['data/documents.json', [data]], ['SHA256SUMS', [sums]], ['manifest.json', [JSON.stringify(manifest)]]];
    alter?.(entries);
    const { file } = await zipOf(entries);
    const fh = await open(file, 'r');
    try {
      return await verifyExport(fh);
    } finally {
      await fh.close();
    }
  }

  it('accepts an archive whose entries match the manifest and SHA256SUMS', async () => {
    expect((await exportLike()).entries).toHaveLength(2);
  });

  it('refuses an altered entry, an entry the manifest does not list, a missing one, sums that differ', async () => {
    await expect(exportLike((e) => { e[0][1] = ['[\n{"id":"PRO-QUA-0002"}\n]\n']; })).rejects.toMatchObject({ code: 'entry_corrupt', detail: 'data/documents.json' });
    await expect(exportLike((e) => { e.unshift(['extra.txt', ['x']]); })).rejects.toMatchObject({ code: 'entry_unexpected', detail: 'extra.txt' });
    await expect(exportLike((e) => { e.splice(0, 1); })).rejects.toMatchObject({ code: 'entry_missing', detail: 'data/documents.json' });
    await expect(exportLike((e) => { e[2][1] = ['{"format":"codex-backup","version":1,"entries":[]}']; })).rejects.toMatchObject({ code: 'format' });
  });
});

describe('names in the archive', () => {
  it('names every column as src/db/schema.ts names it, for every table', () => {
    const tables = Object.values(schema).filter((v) => isTable(v));
    expect(tables.length).toBeGreaterThan(20);
    for (const table of tables) {
      for (const [field, column] of Object.entries(getTableColumns(table))) {
        expect(fieldName(column.name), `${getTableName(table)}.${column.name}`).toBe(field);
      }
    }
  });

  it('files: {ID}/{ID}_{letter}.{n}{ext}, the extension of the recorded name, else of the key', () => {
    expect(filePath('PRO-QUA-0001', 'B', 3, fileExt('Procédure achats.DOCX', 'k'))).toBe('files/PRO-QUA-0001/PRO-QUA-0001_B.3.docx');
    expect(fileExt(null, '0000-PID-HLT-026-002_C.pdf')).toBe('.pdf');
    // A SharePoint key is a driveItem id: no extension from it.
    expect(fileExt('plan', '01ABCDEF')).toBe('');
    expect(fileExt('archive.tar.gz', 'k')).toBe('.gz');
    // Never a path out of the document's folder.
    expect(filePath('../x/y', 'A', 1, '.pdf')).toBe('files/__x_y/__x_y_A.1.pdf');
    expect(exportName(new Date('2026-10-15T08:30:00.123Z'))).toBe('codex-export-2026-10-15T08-30-00-123Z.zip');
  });
});

describe('the import view of a document', () => {
  const rev = (id: number, letter: string, status: string, inForce: string | null = null, effective: string | null = null) => ({ id, letter, status, in_force_at: inForce, effective_at: effective });

  it('takes the revision in force; else an approved one on its effective date; else the latest, as a draft', () => {
    expect(importRevision([rev(1, 'A', 'superseded', '2025-01-01'), rev(2, 'B', 'in_force', '2026-01-01'), rev(3, 'C', 'draft')]))
      .toMatchObject({ rev: { letter: 'B' }, status: 'in_force', inForceAt: '2026-01-01' });
    expect(importRevision([rev(1, 'A', 'approved', null, '2026-12-01')])).toMatchObject({ rev: { letter: 'A' }, status: 'in_force', inForceAt: '2026-12-01' });
    expect(importRevision([rev(1, 'A', 'in_review')])).toMatchObject({ rev: { letter: 'A' }, status: 'draft', inForceAt: null });
    expect(importRevision([])).toBeNull();
  });

  const doc = {
    id: 'PID-HLT-026-002', title: 'P&ID', typeCode: 'PID', subtype: null, origin: 'externe', attachment: 'project', projectCode: 'HLT-026', programCode: 'R2601',
    department: 'ING', site: null, ownerId: 'jwagner', authorId: null, authorText: 'Bureau Tartempion', conf: 'interne', keywords: ['CVC'], lang: 'fr',
    issuedAt: '2023-01-10', reviewDueAt: null, expiresAt: null, createdAt: '2023-01-01', modifiedAt: '2025-03-12', sourceOrg: 'Tartempion', externalRef: 'TT-1',
    receivedAt: '2023-01-05', projectPhase: 'Etudes', workPackage: null, discipline: null, researchTheme: 'x', studyId: null, ipStatus: null, processOwnerId: 'gcomte',
  };

  it('gives the fields of POST /api/import: the ID as legacy reference, only those of its context, no empty value', () => {
    const meta = importMeta(doc, { rev: rev(5, 'C', 'in_force', '2025-03-12'), status: 'in_force', inForceAt: '2025-03-12' }, ['gcomte']);
    expect(meta).toEqual({
      legacyRef: 'PID-HLT-026-002', title: 'P&ID', typeCode: 'PID', origin: 'externe', attachment: 'project', projectCode: 'HLT-026', department: 'ING',
      ownerId: 'jwagner', author: 'Bureau Tartempion', conf: 'interne', keywords: ['CVC'], lang: 'fr', revision: 'C', status: 'in_force', inForceAt: '2025-03-12',
      issuedAt: '2023-01-10', createdAt: '2023-01-01', modifiedAt: '2025-03-12', sourceOrg: 'Tartempion', externalRef: 'TT-1', receivedAt: '2023-01-05', projectPhase: 'Etudes',
    });
  });

  it('names readers of a confidential document only, and the process owner of an internal one', () => {
    const internal = { ...doc, origin: 'interne', attachment: 'none', conf: 'confidentiel', authorId: 'jwagner' };
    const meta = importMeta(internal, null, ['gcomte', 'cbardet']);
    expect(meta).toMatchObject({ readers: ['gcomte', 'cbardet'], processOwnerId: 'gcomte', author: 'jwagner', status: 'draft' });
    expect(meta).not.toHaveProperty('projectCode');
    expect(meta).not.toHaveProperty('sourceOrg');
    expect(importMeta({ ...internal, conf: 'interne' }, null, ['gcomte'])).not.toHaveProperty('readers');
  });
});
