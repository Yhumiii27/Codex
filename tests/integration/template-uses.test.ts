import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FILES_DIR, schema as s } from '@/db';
import { createDocument } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { listTemplates } from '@/lib/queries';
import { addDoc, fixClock, getDoc, journalOf, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Uses of a template (point 66 of docs/reste-a-faire.md, G06): createDocument keeps the template a document was made
// from (documents.template_id), and listTemplates counts them for Administration › Modèles and « Nouveau depuis un
// modèle ». The count covers the documents the reader may read only: it never tells of a draft or a confidential
// document they cannot see (D-14).

vi.mock('@/db', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...(await importOriginal<typeof import('@/db')>()), FILES_DIR: mkdtempSync(join(tmpdir(), 'codex-test-files-')), getDb: async () => (await import('../support/db')).currentDb() };
});
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

beforeAll(() => {
  vi.stubEnv('CODEX_STORAGE', 'local');
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(FILES_DIR, { recursive: true, force: true });
});

const TPL = 'FRM-QMS-001';

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function fromTemplate(who: Person, fields: Record<string, string | File> = {}) {
  actAs(who);
  const res = await createDocument(form({ title: 'Depuis le modèle', typeCode: 'PRO', templateId: TPL, ...fields }));
  expect(res).toMatchObject({ ok: true });
  return (res as { message: string }).message.split(' : ')[1];
}

async function usesFor(who: Person) {
  actAs(who);
  return Object.fromEntries((await listTemplates(await getCtx())).map((x) => [x.id, x.uses]));
}

describe('template uses (point 66, G06)', () => {
  it('keeps the template a document was created from, journaled, and not one the dialog sent along with a file', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    const id = await fromTemplate('owner');
    expect(await getDoc(db(), id)).toMatchObject({ templateId: TPL });
    expect((await journalOf(db(), id))[0]).toMatchObject({ action: 'upload', detail: `A.1 · ${TPL}`, data: { text: { code: 'version', params: { label: 'A.1', template: TPL } } } });
    // A file sent: it is the document's first version, whatever template was also chosen.
    const pdf = new File(['%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n%%EOF'], 'x.pdf', { type: 'application/pdf' });
    const other = await fromTemplate('owner', { file: pdf });
    expect(await getDoc(db(), other)).toMatchObject({ templateId: null });
    expect((await journalOf(db(), other))[0].detail).toBe('A.1');
  });

  it('counts only the documents the reader may read; records managers count them all (D-14)', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    // A draft of owner's: in their drafting circle, not in head's (same department, not its author).
    const draft = await fromTemplate('owner');
    // A confidential document in force of QUA, from the template: read by QUA, not by writer2 (ING).
    await addDoc(db(), { id: 'PRO-QUA-0009', conf: 'confidentiel' });
    await db().update(s.documents).set({ templateId: TPL }).where(eq(s.documents.id, 'PRO-QUA-0009'));
    // A document in force any reader may read.
    await addDoc(db(), { id: 'PRO-QUA-0010' });
    await db().update(s.documents).set({ templateId: TPL }).where(eq(s.documents.id, 'PRO-QUA-0010'));

    expect(await usesFor('manager')).toEqual({ [TPL]: 3 });
    expect(await usesFor('owner')).toEqual({ [TPL]: 3 });
    expect(await usesFor('head')).toEqual({ [TPL]: 2 });
    expect(await usesFor('writer2')).toEqual({ [TPL]: 1 });
    expect(draft).toMatch(/^PRO-QUA-/);
  });
});
