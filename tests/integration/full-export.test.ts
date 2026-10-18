import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/export/full/route';
import { FILES_DIR, schema as s } from '@/db';
import { PgServerClient, type SqlQueryable } from '@/db/sql-client';
import { getCtx } from '@/lib/context';
import { entryBuffer, verifyExport, zipEntries } from '@/lib/export-core.mjs';
import { fmtSize } from '@/lib/format';
import { importDocument } from '@/lib/importer';
import { auditDetailL } from '@/lib/queries';
import { addDoc, addWorkflow, fixClock, getDoc, reset, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Full export for reversibility (point 17 of docs/reste-a-faire.md, lib/export-core.mjs, GET /api/export/full): an
// archive of the test database read back whole (every entry against the manifest and SHA256SUMS), its counts against
// the tables, its files against the stored bytes, drafts included; journaled at its start (inside the archive) and its
// end; a snapshot that later writes do not reach; refused to whoever is not a records manager with Administration; an
// interrupted download journaled as such; and one document imported back through the importer.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mk(join(td(), 'codex-export-files-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock('2026-10-15T08:00:00Z');
const scratch = mkdtempSync(path.join(tmpdir(), 'codex-export-'));

beforeEach(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
  mkdirSync(FILES_DIR, { recursive: true });
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n% ${text}\n%%EOF\n`);
const key = (id: number, name: string) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}-${name}`;

/** Gives the working version `n` of a document's revision a stored file (`bytes`, or none on disk when null). */
async function attach(docId: string, letter: string, n: number, bytes: Buffer | null, storage = 'local') {
  const [v] = await db().select({ id: s.workingVersions.id }).from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(and(eq(s.workingVersions.docId, docId), eq(s.revisions.letter, letter), eq(s.workingVersions.n, n)));
  const k = storage === 'local' ? key(v.id, `${docId}_${letter}.${n}.pdf`) : `01SPITEM${v.id}`;
  if (bytes && storage === 'local') writeFileSync(path.join(FILES_DIR, k), bytes);
  await db().update(s.workingVersions).set({ storage, fileKey: k, fileName: 'procédure.pdf', mime: 'application/pdf', size: bytes?.length ?? 9 }).where(eq(s.workingVersions.id, v.id));
  return { id: v.id, key: k };
}

const FILES = { a1: pdf('PRO-QUA-0001 A.1'), b1: pdf('PRO-QUA-0001 B.1'), b2: pdf('PRO-QUA-0001 B.2'), draft: pdf('PRO-QUA-0002 draft'), pid: pdf('PID confidential') };

/**
 * A procedure in force at B (A superseded) with a change request; a draft under a running circuit, with a comment, that
 * only its drafting circle sees (D-14); a confidential project document with a named reader and a « voir aussi » link;
 * a working version whose file is missing from the store, another kept by SharePoint, which is not set up.
 */
async function fill() {
  await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'superseded', versions: ['owner'] }, { letter: 'B', status: 'in_force', versions: ['owner', 'writer'] }] });
  await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'in_review', versions: ['owner', 'writer'] }] });
  await addDoc(db(), { id: 'PID-HLT-026-001', typeCode: 'PID', department: 'ING', projectCode: 'HLT-026', conf: 'confidentiel', ownerId: 'engineer', revisions: [{ letter: 'A', status: 'in_force', versions: ['engineer'] }] });
  await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }] });
  const files = {
    a1: await attach('PRO-QUA-0001', 'A', 1, FILES.a1),
    b1: await attach('PRO-QUA-0001', 'B', 1, FILES.b1),
    b2: await attach('PRO-QUA-0001', 'B', 2, FILES.b2),
    draft: await attach('PRO-QUA-0002', 'A', 2, FILES.draft),
    missing: await attach('PRO-QUA-0002', 'A', 1, null),
    pid: await attach('PID-HLT-026-001', 'A', 1, FILES.pid),
    sharepoint: await attach('COR-QUA-0001', 'A', 1, null, 'sharepoint'),
  };
  await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0002', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
  await db().insert(s.workflowComments).values({ workflowId: 'W-1', authorId: 'head', at: '2026-10-12', text: 'À reprendre §3' });
  await db().update(s.documents).set({ processOwnerId: 'quality', keywords: ['=SUM(A1)', 'achats'] }).where(eq(s.documents.id, 'PRO-QUA-0001'));
  await db().insert(s.documentReaders).values({ docId: 'PID-HLT-026-001', userId: 'writer' });
  await db().insert(s.documentLinks).values({ sourceId: 'PRO-QUA-0001', targetId: 'PID-HLT-026-001', kind: 'see_also', createdBy: 'owner', createdAt: '2026-10-01' });
  await db().insert(s.changeRequests).values({ id: 'ECR-2026-0001', kind: 'modification', docId: 'PRO-QUA-0001', requesterId: 'writer', reason: 'Mise à jour', status: 'submitted', createdAt: '2026-10-02 09:00:00' });
  await db().insert(s.auditLog).values({ at: '2026-10-02T09:00:00Z', userId: 'writer', action: 'ecr', docId: 'PRO-QUA-0001', detail: 'ECR-2026-0001' });
  return files;
}

const req = (method = 'GET') => new Request('http://codex.test/api/export/full', { method });

/** Reads an archive: its manifest checked whole, and each entry's bytes by name. */
async function readArchive(bytes: Buffer) {
  const file = path.join(scratch, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  writeFileSync(file, bytes);
  const fh = await open(file, 'r');
  try {
    const manifest = await verifyExport(fh);
    const entries = await zipEntries(fh);
    const byName = new Map<string, Buffer>();
    for (const e of entries) byName.set(e.name, await entryBuffer(fh, e));
    const json = <T = Record<string, unknown>[]>(name: string): T => JSON.parse(byName.get(name)!.toString('utf8'));
    return { manifest, names: entries.map((e) => e.name), byName, json };
  } finally {
    await fh.close();
  }
}

async function download() {
  const res = await GET(req());
  expect(res.status).toBe(200);
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

const exportEntries = () => db().select().from(s.auditLog).where(inArray(s.auditLog.action, ['export_full', 'export_full_end'])).orderBy(asc(s.auditLog.id));
const tempTables = async () => (await db().$client.query<{ n: number }>(`select count(*)::int as n from pg_class where relname like 'codex_export_%'`)).rows[0].n;

describe('GET /api/export/full', () => {
  it('gives a records manager every table, file and journal entry, drafts included, checked against the manifest and the database', async () => {
    const files = await fill();
    actAs('manager');
    const { res, bytes } = await download();
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="codex-export-2026-10-15T08-00-00-000Z.zip"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const { manifest, names, byName, json } = await readArchive(bytes);

    expect(manifest).toMatchObject({ format: 'codex-export', version: 1, createdAt: '2026-10-15T08:00:00.000Z', mode: 'online', by: 'manager', schema: { migration: '0000_init' } });
    expect(names[0]).toBe('LISEZMOI.txt');
    expect(names.slice(-2)).toEqual(['SHA256SUMS', 'manifest.json']);

    // Every table of the application but the search index, each with as many rows as the database holds.
    const { rows: tables } = await db().$client.query<{ name: string }>(`select tablename as name from pg_tables where schemaname = 'public' order by 1`);
    const exported = tables.map((t) => t.name).filter((t) => t !== 'document_terms');
    expect(Object.keys(manifest.tables).sort()).toEqual(exported);
    for (const t of exported) {
      const rows = json(manifest.tables[t]);
      expect(rows, t).toHaveLength(manifest.counts[t]);
      const [{ n }] = (await db().$client.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows;
      // The journal holds one more entry now: the end of this export.
      expect(manifest.counts[t], t).toBe(t === 'audit_log' ? n - 1 : n);
    }
    // Rows as the database holds them, under the field names of src/db/schema.ts.
    const docs = json('data/documents.json');
    expect(docs.map((d) => d.id).sort()).toEqual(['COR-QUA-0001', 'PID-HLT-026-001', 'PRO-QUA-0001', 'PRO-QUA-0002']);
    expect(docs.find((d) => d.id === 'PRO-QUA-0002')).toMatchObject({ status: 'in_review', revWorking: 'A', revInForce: null, legalHold: false });
    expect(json('data/workflow_comments.json')).toEqual([{ id: 1, workflowId: 'W-1', authorId: 'head', at: '2026-10-12', text: 'À reprendre §3' }]);
    expect(json('data/change_requests.json')).toMatchObject([{ id: 'ECR-2026-0001', status: 'submitted', createdAt: '2026-10-02T09:00:00' }]);
    expect(json('data/document_links.json')).toMatchObject([{ sourceId: 'PRO-QUA-0001', targetId: 'PID-HLT-026-001', kind: 'see_also' }]);
    expect(json('data/document_readers.json')).toEqual([{ docId: 'PID-HLT-026-001', userId: 'writer' }]);
    expect(manifest.tables).not.toHaveProperty('document_terms');
    expect(json('data/users.json')).toHaveLength(15);

    // The journal, its start entry included (written in the snapshot), its end entry not.
    const journal = json('data/audit_log.json');
    expect(journal.at(-1)).toMatchObject({ userId: 'manager', action: 'export_full', targetKind: 'export', targetId: 'full', data: { archive: { documents: 4, files: 7 } } });
    expect(journal.some((e) => e.action === 'export_full_end')).toBe(false);

    // Every stored file under {ID}/{ID}_{letter}.{n}.ext, with its bytes; the missing one and SharePoint's listed apart.
    const path0 = (id: string, l: string, n: number) => `files/${id}/${id}_${l}.${n}.pdf`;
    const expected = { [path0('PRO-QUA-0001', 'A', 1)]: FILES.a1, [path0('PRO-QUA-0001', 'B', 1)]: FILES.b1, [path0('PRO-QUA-0001', 'B', 2)]: FILES.b2, [path0('PRO-QUA-0002', 'A', 2)]: FILES.draft, [path0('PID-HLT-026-001', 'A', 1)]: FILES.pid };
    expect(names.filter((x) => x.startsWith('files/')).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, content] of Object.entries(expected)) {
      expect(byName.get(name)!.equals(content), name).toBe(true);
      expect(manifest.entries.find((e) => e.name === name)).toMatchObject({ size: content.length, sha256: sha(content) });
    }
    expect(manifest.entries.find((e) => e.name === path0('PRO-QUA-0001', 'B', 2))?.workingVersion).toBe(files.b2.id);
    expect(manifest.files).toEqual({
      count: 5, bytes: Object.values(expected).reduce((n, b) => n + b.length, 0),
      missing: [{ workingVersion: files.missing.id, path: path0('PRO-QUA-0002', 'A', 1) }],
      skipped: [{ workingVersion: files.sharepoint.id, path: path0('COR-QUA-0001', 'A', 1), storage: 'sharepoint' }],
      altered: [],
    });
    expect(manifest.counts.files).toBe(5);

    // SHA256SUMS: every entry but itself and the manifest, as sha256sum -c reads it.
    const sums = byName.get('SHA256SUMS')!.toString('utf8').trim().split('\n');
    expect(sums).toHaveLength(names.length - 2);
    expect(sums).toContain(`${sha(FILES.draft)}  ${path0('PRO-QUA-0002', 'A', 2)}`);

    // The documents' CSV: one line per document, lists joined, formulas neutralised.
    const csv = byName.get('data/documents.csv')!.toString('utf8');
    expect(csv.startsWith('﻿id;aliases;legacyRef;title;')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(5);
    expect(csv).toContain(";'=SUM(A1), achats;");

    // What POST /api/import takes for each document, with the file of its revision.
    const view = json<{ id: string; state: string; meta: Record<string, unknown>; file: string | null; fileName: string | null; mime: string | null }[]>('import/documents.json');
    expect(view.map((v) => v.id).sort()).toEqual(docs.map((d) => d.id).sort());
    expect(view.find((v) => v.id === 'PRO-QUA-0001')).toMatchObject({
      state: 'active', file: path0('PRO-QUA-0001', 'B', 2), fileName: 'procédure.pdf', mime: 'application/pdf',
      meta: { legacyRef: 'PRO-QUA-0001', typeCode: 'PRO', revision: 'B', status: 'in_force', inForceAt: '2026-09-10', processOwnerId: 'quality' },
    });
    expect(view.find((v) => v.id === 'PID-HLT-026-001')?.meta).toMatchObject({ attachment: 'project', projectCode: 'HLT-026', conf: 'confidentiel', readers: ['writer'] });
    // The draft's last working version has its file; the earlier one, missing, is not the one to send.
    expect(view.find((v) => v.id === 'PRO-QUA-0002')).toMatchObject({ file: path0('PRO-QUA-0002', 'A', 2), meta: { revision: 'A', status: 'draft' } });
    expect(view.find((v) => v.id === 'COR-QUA-0001')?.file).toBeNull();

    // Journaled at its start and its end, the end with the archive's size and SHA-256; no temporary table left.
    const [start, end] = await exportEntries();
    expect(start).toMatchObject({ userId: 'manager', targetKind: 'export', targetId: 'full', data: { archive: { documents: 4, files: 7 } } });
    expect(end).toMatchObject({ userId: 'manager', action: 'export_full_end', data: { archive: { size: bytes.length, sha256: sha(bytes), files: 5, missing: 1, skipped: 1 } } });
    expect(await tempTables()).toBe(0);
    const ctx = await getCtx();
    expect(auditDetailL(ctx, end)).toBe(`fichiers : 5 (${fmtSize(manifest.files.bytes, 'fr')}) · absents du stockage : 1 · sur SharePoint, non inclus : 1 · archive ${fmtSize(bytes.length, 'fr')}, SHA-256 ${sha(bytes).slice(0, 16)}…`);
    expect(auditDetailL(ctx, start)).toBe(`4 documents · fichiers : 7 (${fmtSize(Object.values(FILES).reduce((n, b) => n + b.length, 0) + 9 + 9, 'fr')})`);
  });

  it('is refused to whoever is not a records manager with access to Administration, HEAD included, and journals nothing', async () => {
    await fill();
    // An administrator who is not a records manager, and a records manager without the admin permission.
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    for (const who of ['owner', 'auditor', 'head', 'writer'] as const) {
      actAs(who);
      expect((await GET(req())).status, who).toBe(403);
      expect((await HEAD(req('HEAD'))).status, who).toBe(403);
    }
    await db().update(s.rolePermissions).set({ granted: false }).where(and(eq(s.rolePermissions.role, 'gestionnaire'), eq(s.rolePermissions.perm, 'admin')));
    actAs('manager');
    expect((await GET(req())).status).toBe(403);
    await db().update(s.rolePermissions).set({ granted: true }).where(and(eq(s.rolePermissions.role, 'gestionnaire'), eq(s.rolePermissions.perm, 'admin')));
    const head = await HEAD(req('HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('application/zip');
    expect(await exportEntries()).toEqual([]);
  });

  it('counts in the exports\' budget (CODEX_RATE_EXPORTS): a refused export takes no snapshot and journals nothing', async () => {
    await fill();
    vi.stubEnv('CODEX_RATE_EXPORTS', '1/1m');
    try {
      actAs('manager');
      await download();
      const refused = await GET(req());
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await exportEntries()).map((e) => e.action)).toEqual(['export_full', 'export_full_end']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('exports the database as it was when the export started: later writes and a file renamed meanwhile change nothing', async () => {
    const files = await fill();
    actAs('manager');
    const res = await GET(req());
    // The snapshot is taken before the response is given: what follows happens while the archive is downloaded.
    await db().update(s.documents).set({ title: 'Titre changé' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await addDoc(db(), { id: 'PRO-QUA-0009' });
    await db().insert(s.auditLog).values({ at: '2026-10-15T08:00:01Z', userId: 'owner', action: 'create', docId: 'PRO-QUA-0009' });
    // A reclassification renames the stored files: new key linked, record updated, old key removed (lib/storage.ts).
    const renamed = key(files.b2.id, 'PRO-QUA-0003_B.2.pdf');
    linkSync(path.join(FILES_DIR, files.b2.key), path.join(FILES_DIR, renamed));
    await db().update(s.workingVersions).set({ fileKey: renamed }).where(eq(s.workingVersions.id, files.b2.id));
    unlinkSync(path.join(FILES_DIR, files.b2.key));

    const { manifest, byName, json } = await readArchive(Buffer.from(await res.arrayBuffer()));
    const docs = json('data/documents.json');
    expect(docs.map((d) => d.id)).not.toContain('PRO-QUA-0009');
    expect(docs.find((d) => d.id === 'PRO-QUA-0001')?.title).toBe('PRO-QUA-0001');
    expect(json('data/audit_log.json').some((e) => e.docId === 'PRO-QUA-0009')).toBe(false);
    expect(manifest.counts.documents).toBe(4);
    expect(byName.get('files/PRO-QUA-0001/PRO-QUA-0001_B.2.pdf')!.equals(FILES.b2)).toBe(true);
    expect(manifest.files.missing).toHaveLength(1);
    expect((await getDoc(db(), 'PRO-QUA-0001')).title).toBe('Titre changé');
  });

  it('journals an interrupted download as such, and leaves no temporary table', async () => {
    await fill();
    actAs('manager');
    const res = await GET(req());
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    const [start, end] = await exportEntries();
    expect(start.action).toBe('export_full');
    expect(end).toMatchObject({ action: 'export_full_end', data: { archive: { interrupted: true } } });
    expect(end.data?.archive?.sha256).toBeUndefined();
    expect(await tempTables()).toBe(0);
    // Other readers of the journal see that it stopped, not how far nor what it held (D-14).
    expect(auditDetailL(await getCtx(), end)).toMatch(/^interrompu après \d/);
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    actAs('head');
    expect(auditDetailL(await getCtx(), end)).toBe('interrompu');
    expect(auditDetailL(await getCtx(), start)).toBe('');
  });

  it('stops cleanly when the download stops while a chunk is being read: interruption journaled, no error logged', async () => {
    await fill();
    actAs('manager');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(req());
      const reader = res.body!.getReader();
      await reader.read();
      // A read in flight when the client goes away, as a server sees it: the stream is cancelled before it answers.
      const pending = reader.read();
      await reader.cancel();
      expect((await pending).done).toBe(true);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
    const [, end] = await exportEntries();
    expect(end).toMatchObject({ action: 'export_full_end', data: { archive: { interrupted: true } } });
    expect(await tempTables()).toBe(0);
  });

  it('reports an end it could not journal through the structured log (scope export), not as plain text', async () => {
    await fill();
    actAs('manager');
    const client = db().$client;
    const failingQuery = <Q extends SqlQueryable['query']>(query: Q) => ((sql: string, params?: unknown[], ...rest: unknown[]) =>
      params?.[2] === 'export_full_end' ? Promise.reject(new Error('disk full')) : (query as (...a: unknown[]) => unknown)(sql, params, ...rest)) as Q;
    const query = failingQuery(client.query.bind(client));
    vi.spyOn(client, 'query').mockImplementation(query);
    // On a PostgreSQL server (npm run test:pg) the export runs on a connection of its own (PgServerClient.session).
    if (client instanceof PgServerClient) {
      const session = client.session.bind(client);
      vi.spyOn(client, 'session').mockImplementation(async () => {
        const s = await session();
        return { ...s, query: failingQuery(s.query) };
      });
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await download();
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('[export] end of the export not journaled') && l.includes('disk full'))).toBe(true);
      expect(warn.mock.calls.every((c) => c.length === 1)).toBe(true);
    } finally {
      vi.restoreAllMocks();
      warn.mockRestore();
    }
    expect((await exportEntries()).map((e) => e.action)).toEqual(['export_full']);
    expect(await tempTables()).toBe(0);
  });

  it('gives what POST /api/import needs to bring a document back into an empty Codex, under the same ID', async () => {
    await fill();
    actAs('manager');
    const { byName, json } = await readArchive((await download()).bytes);
    const view = json<{ id: string; meta: Record<string, unknown>; file: string; fileName: string; mime: string }[]>('import/documents.json');
    const one = view.find((v) => v.id === 'PRO-QUA-0001')!;
    const before = await getDoc(db(), 'PRO-QUA-0001');

    await reset(db());
    const res = await importDocument(one.meta, { buf: byName.get(one.file)!, name: one.fileName, mime: one.mime });
    expect(res).toMatchObject({ kind: 'created', id: 'PRO-QUA-0001', revision: 'B', version: 'B.1', revStatus: 'in_force', file: true });
    const after = await getDoc(db(), 'PRO-QUA-0001');
    expect(after).toMatchObject({ title: before.title, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', conf: before.conf, revInForce: 'B', issuedAt: before.issuedAt, processOwnerId: 'quality', keywords: before.keywords });
    const [v] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-QUA-0001'));
    const { readStored } = await import('@/lib/storage');
    expect((await readStored(v.storage, v.fileKey!)).equals(FILES.b2)).toBe(true);
  });
});

describe('fingerprints recorded at upload (point 31)', () => {
  it('lists in the manifest, and counts in the journal, the files archived whose bytes differ from their recorded SHA-256', async () => {
    const files = await fill();
    await db().update(s.workingVersions).set({ sha256: sha(FILES.b1) }).where(eq(s.workingVersions.id, files.b1.id));
    await db().update(s.workingVersions).set({ sha256: sha('what was uploaded') }).where(eq(s.workingVersions.id, files.b2.id));
    actAs('manager');
    const { manifest, byName } = await readArchive((await download()).bytes);
    const where = 'files/PRO-QUA-0001/PRO-QUA-0001_B.2.pdf';
    // Archived as stored, and said.
    expect(byName.get(where)!.equals(FILES.b2)).toBe(true);
    expect(manifest.files.altered).toEqual([{ workingVersion: files.b2.id, path: where, recorded: sha('what was uploaded') }]);
    const [, end] = await exportEntries();
    expect(end.data?.archive?.altered).toBe(1);
    const ctx = await getCtx();
    expect(auditDetailL(ctx, end)).toContain('différents de leur empreinte : 1');
  });
});
