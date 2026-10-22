import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/documents/[id]/compare/route';
import { FILES_DIR, schema as s } from '@/db';
import type { CompareResult } from '@/lib/compare';
import { simplePdf } from '@/lib/pdf';
import { getCtx } from '@/lib/context';
import { auditDetailL } from '@/lib/queries';
import { addDoc, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { docx } from '../support/office';
import { actAs, setLangCookie } from '../support/session';

// Comparison of the content of two versions (GET /api/documents/[id]/compare, src/lib/compare.ts, point 14 of
// docs/reste-a-faire.md): text extracted on the server, differences line by line, under the file route's rules (D-14):
// outside the drafting circle, only the final file of the revision in force; everything else answers 404, as for a
// document that does not exist. Each version compared is journaled as a consultation.

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync: mk } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mk(join(tmpdir(), 'codex-compare-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));

const db = setupDb();
fixClock();

afterAll(() => {
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const ID = 'PRO-QUA-0001';

/** Gives working version `n` of revision `letter` a stored file; `sha256: false` records none, a string a wrong one. */
async function attach(docId: string, letter: string, n: number, bytes: Buffer, name: string, mime: string, opts: { sha256?: string | false } = {}) {
  const [v] = await db().select({ id: s.workingVersions.id }).from(s.workingVersions).innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(and(eq(s.workingVersions.docId, docId), eq(s.revisions.letter, letter), eq(s.workingVersions.n, n)));
  const key = `${'0'.repeat(8)}-0000-4000-8000-${String(v.id).padStart(12, '0')}-${docId}_${letter}.${n}`;
  writeFileSync(path.join(FILES_DIR, key), bytes);
  const sha256 = opts.sha256 === false ? null : opts.sha256 ?? createHash('sha256').update(bytes).digest('hex');
  await db().update(s.workingVersions).set({ storage: 'local', fileKey: key, fileName: name, mime, size: bytes.length, sha256 }).where(eq(s.workingVersions.id, v.id));
  return v.id;
}

/** PRO-QUA-0001: A in force (one version, a Word file), B being drafted (B.1 Word, B.2 PDF). */
async function setup() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['owner', 'writer'] }] });
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const a = await attach(ID, 'A', 1, docx(['Procédure de contrôle', 'Étape 1 : vérifier', 'Étape 2 : signer']), 'procedure.docx', DOCX);
  const b1 = await attach(ID, 'B', 1, docx(['Procédure de contrôle', 'Étape 1 : vérifier tout', 'Étape 2 : signer', 'Étape 3 : archiver']), 'procedure-b.docx', DOCX);
  const b2 = await attach(ID, 'B', 2, simplePdf([{ text: 'Procédure de contrôle' }, { text: 'Étape 2 : signer' }]), 'procedure-b.pdf', 'application/pdf');
  return { a, b1, b2 };
}

async function compare(who: Person, a: number | string, b: number | string, id = ID) {
  actAs(who);
  return GET(new Request(`http://codex.test/api/documents/${encodeURIComponent(id)}/compare?a=${a}&b=${b}`), { params: Promise.resolve({ id }) });
}
const json = async (res: Response) => {
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  return (await res.json()) as CompareResult;
};
const views = async (who: Person) => (await db().select().from(s.auditLog).where(and(eq(s.auditLog.userId, who), eq(s.auditLog.action, 'view')))).map((x) => x.detail).sort();

describe('within the drafting circle', () => {
  it('compares the text of two versions of different formats, line by line, and journals both', async () => {
    const { a, b1, b2 } = await setup();
    const r = await json(await compare('owner', a, b1));
    expect(r.a).toEqual({ id: a, label: 'A', lines: 3, truncated: false, failure: null });
    expect(r.b).toMatchObject({ id: b1, label: 'B.1', lines: 4, failure: null });
    expect(r.sameFile).toBe(false);
    expect(r.diff).toMatchObject({ kind: 'diff', added: 2, removed: 1, truncated: false });
    const shown = r.diff?.kind === 'diff' ? r.diff.hunks.flatMap((h) => h.lines.map((l) => `${l.op}${l.text}`)) : [];
    expect(shown).toEqual([' Procédure de contrôle', '-Étape 1 : vérifier', '+Étape 1 : vérifier tout', ' Étape 2 : signer', '+Étape 3 : archiver']);
    expect(await views('owner')).toEqual(['A · Comparaison', 'B.1 · Comparaison']);
    // Word against PDF.
    const pdf = await json(await compare('owner', b1, b2));
    expect(pdf.diff).toMatchObject({ kind: 'diff', added: 0, removed: 2 });
  });

  it('journals the comparison in the reader\'s language', async () => {
    // Revue du lot 9 : le détail « Comparaison » était écrit en français seulement, alors que le journal est traduit.
    const { a, b1 } = await setup();
    await json(await compare('owner', a, b1));
    const rows = await db().select().from(s.auditLog).where(and(eq(s.auditLog.userId, 'owner'), eq(s.auditLog.action, 'view')));
    expect(rows).toHaveLength(2);
    for (const [lang, word, other] of [['en', 'Comparison', 'Comparaison'], ['fr', 'Comparaison', 'Comparison']] as const) {
      setLangCookie(lang);
      const ctx = await getCtx();
      const shown = rows.map((r) => auditDetailL(ctx, r)).sort();
      expect(shown).toEqual([`A · ${word}`, `B.1 · ${word}`]);
      expect(shown.join()).not.toContain(other);
    }
  });

  it('a records manager compares drafts too; the same version compared with itself is the same text', async () => {
    const { b1, b2 } = await setup();
    expect((await json(await compare('manager', b2, b1))).diff).toMatchObject({ kind: 'diff', added: 2, removed: 0 });
    const same = await json(await compare('manager', b1, b1));
    expect(same).toMatchObject({ sameFile: true, diff: { kind: 'same', lines: 4 } });
  });
});

describe('outside the drafting circle (D-14)', () => {
  it('only the final file of the revision in force can be had: any working version answers 404, nothing journaled', async () => {
    const { a, b1, b2 } = await setup();
    for (const [x, y] of [[a, b1], [b1, a], [b2, b1]]) expect((await compare('auditor', x, y)).status).toBe(404);
    expect(await views('auditor')).toEqual([]);
    expect(await json(await compare('auditor', a, a))).toMatchObject({ diff: { kind: 'same', lines: 3 } });
    expect(await views('auditor')).toEqual(['A · Comparaison']);
  });

  it('a version of another document, a document hidden from the reader, or a malformed id answer 404', async () => {
    const { a } = await setup();
    await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', ownerId: 'writer2', conf: 'confidentiel' });
    const [other] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.docId, 'PRO-ING-0001'));
    expect((await compare('owner', a, other.id)).status).toBe(404);
    expect((await compare('owner', other.id, other.id, 'PRO-ING-0001')).status).toBe(404);
    expect((await compare('writer2', other.id, other.id, 'PRO-ING-0001')).status).toBe(200);
    for (const [x, y] of [['', a], [a, 'abc'], [a, '-1'], [a, '1e3'], [a, String(2 ** 31)]]) expect((await compare('owner', x, y)).status).toBe(404);
    expect((await compare('owner', a, a, 'PRO-QUA-9999')).status).toBe(404);
  });
});

describe('files whose text cannot be compared', () => {
  it('says why for each side: format, no file, missing, altered', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner', 'owner', 'owner', 'owner', 'owner'] }] });
    const plan = await attach(ID, 'A', 1, Buffer.from('AC1032\0\0\0\0\0\x06'), 'plan.dwg', 'image/vnd.dwg');
    const [none] = await db().select().from(s.workingVersions).where(and(eq(s.workingVersions.docId, ID), eq(s.workingVersions.n, 2)));
    const gone = await attach(ID, 'A', 3, Buffer.from('texte'), 'note.txt', 'text/plain');
    rmSync(path.join(FILES_DIR, (await db().select().from(s.workingVersions).where(eq(s.workingVersions.id, gone)))[0].fileKey!));
    const altered = await attach(ID, 'A', 4, Buffer.from('texte modifié'), 'note.txt', 'text/plain', { sha256: 'a'.repeat(64) });
    const ok = await attach(ID, 'A', 5, Buffer.from('texte'), 'note.txt', 'text/plain', { sha256: false });
    const r1 = await json(await compare('owner', plan, none.id));
    expect([r1.a.failure, r1.b.failure, r1.diff]).toEqual(['unsupported', 'no_file', null]);
    const r2 = await json(await compare('owner', gone, altered));
    expect([r2.a.failure, r2.b.failure, r2.diff]).toEqual(['unavailable', 'altered', null]);
    // Without a recorded fingerprint, the file is read as it is.
    expect((await json(await compare('owner', ok, ok))).diff).toEqual({ kind: 'same', lines: 1 });
  });

  it('a file beyond CODEX_COMPARE_MAX_MB is not read', async () => {
    vi.stubEnv('CODEX_COMPARE_MAX_MB', '1');
    try {
      await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
      const big = await attach(ID, 'A', 1, Buffer.alloc(1024 * 1024 + 1, 0x61), 'gros.txt', 'text/plain');
      expect((await json(await compare('owner', big, big))).a.failure).toBe('too_large');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
