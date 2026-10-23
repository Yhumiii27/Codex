import { describe, expect, it, vi } from 'vitest';
import { getCtx } from '@/lib/context';
import { getDoc } from '@/lib/queries';
import { addDoc, setupDb } from '../support/db';
import { actAs } from '../support/session';

// The deep link of a document, /documents/{id}, is the contract the other tools of the group link to (Keystone, Vigie,
// Arche: its request CX-08 in REQUESTS.md). The record answers a document under its current ID and under every ID it had
// (a reclassification, a migrated reference: documents.aliases), and the page then redirects to the current ID
// (src/app/documents/[id]/page.tsx); a document the reader may not see stays hidden, whatever the ID it is asked by.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

describe('the deep link /documents/{id}', () => {
  it('finds a document by its current ID and by a former one, which leads to the current ID', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0007', conf: 'interne', aliases: ['PRO-HSE-0002', 'GED1/Q/12'] });
    actAs('manager', 'gestionnaire');
    const ctx = await getCtx();
    for (const asked of ['PRO-QUA-0007', 'PRO-HSE-0002', 'GED1/Q/12']) {
      const res = await getDoc(ctx, asked);
      expect(res, asked).not.toBeNull();
      expect(res !== 'hidden' && res!.doc.id, asked).toBe('PRO-QUA-0007');
      expect(res !== 'hidden' && res!.doc.href, asked).toBe('/documents/PRO-QUA-0007');
    }
    expect(await getDoc(ctx, 'PRO-QUA-9999')).toBeNull();
  });

  it('keeps hidden, under a former ID too, a document the reader may not see', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0008', conf: 'tres_confidentiel', aliases: ['PRO-HSE-0003'] });
    actAs('writer2');
    const ctx = await getCtx();
    expect(await getDoc(ctx, 'PRO-QUA-0008')).toBe('hidden');
    expect(await getDoc(ctx, 'PRO-HSE-0003')).toBe('hidden');
  });
});
