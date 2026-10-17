import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { recordConsultation, updateMeta } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { refreshHeadline } from '@/lib/lifecycle';
import { listAudit, METADATA_ACTIONS } from '@/lib/queries';
import { addDoc, fixClock, journalOf, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// History of the metadata (point 22 of docs/reste-a-faire.md): every field updateMeta changes is journaled with its value
// before and after, rendered in the reader's language; the record's History tab lists them apart ("Métadonnées",
// METADATA_ACTIONS). Outside the drafting circle, the values of a change made on a draft are withheld (D-14).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const ID = 'PRO-QUA-0001';

async function saveMeta(who: Person, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ docId: ID, version: (await viewOf(db(), ID)).version, ...fields })) fd.set(k, v);
  actAs(who);
  return updateMeta(fd);
}

/** The metadata history of the record as `who` reads it: action and detail. */
async function metadataHistory(who: Person) {
  actAs(who);
  const metadata = new Set<string>(METADATA_ACTIONS);
  return (await listAudit(await getCtx(), { docId: ID, consultations: 'without' })).filter((e) => metadata.has(e.action)).map((e) => e.detail);
}

describe('metadata history', () => {
  it('journals each field changed with its value before and after', async () => {
    await addDoc(db(), { id: ID });
    expect(await saveMeta('owner', { title: 'Nouveau titre', keywords: 'acier, soudure' })).toMatchObject({ ok: true });
    const [e] = (await journalOf(db(), ID)).filter((x) => x.action === 'edit');
    expect(e.data?.changes).toEqual([
      { field: 'title', before: ID, after: 'Nouveau titre' },
      { field: 'keywords', before: null, after: ['acier', 'soudure'] },
    ]);
    // A reader of the document reads the values, in their language; a consultation is not a change.
    await recordConsultation(ID);
    const [detail, ...rest] = await metadataHistory('auditor');
    expect(rest).toEqual([]);
    expect(detail).toContain(`« ${ID} » → « Nouveau titre »`);
    expect(detail).toContain('acier, soudure');
  });

  it('withholds, outside the drafting circle, the values of a change made on a draft', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    await saveMeta('owner', { title: 'Titre provisoire' });
    // Revision A comes into force: the record is read by others from then on.
    await db().update(s.revisions).set({ status: 'in_force', approvedAt: '2026-10-10', inForceAt: '2026-10-10' }).where(eq(s.revisions.docId, ID));
    await db().update(s.documents).set({ issuedAt: '2026-10-10' }).where(eq(s.documents.id, ID));
    await refreshHeadline(db(), ID);
    const [outside] = await metadataHistory('auditor');
    expect(outside).not.toContain('Titre provisoire');
    expect(outside).not.toContain('→');
    const [circle] = await metadataHistory('owner');
    expect(circle).toContain(`« ${ID} » → « Titre provisoire »`);
  });
});
