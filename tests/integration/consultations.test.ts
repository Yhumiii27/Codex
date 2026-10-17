import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/documents/[id]/file/route';
import { recordConsultation } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { listAudit } from '@/lib/queries';
import { schema as s } from '@/db';
import { addDoc, fixClock, getRevision, journalOf, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Consultations (point 28 of docs/reste-a-faire.md): a record opened ('consult', lib/actions.ts recordConsultation) and a
// file shown in the preview ('view', the file route without ?download=1) are journaled once per user, document, revision
// and version every 30 minutes (lib/lifecycle.ts journalConsultation); a range further on and HEAD write nothing. They
// follow the revision they are tied to (D-14) and stay out of the activity feeds.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock('2026-10-10T08:00:00Z');

const ID = 'PRO-QUA-0001';
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });

/** GET (or HEAD) of the file route as `who`; the body is read, as a viewer would. Demo records serve a stand-in PDF. */
async function fetchFile(who: Person, { query = '', headers = {}, method = 'GET' }: { query?: string; headers?: Record<string, string>; method?: 'GET' | 'HEAD' } = {}) {
  actAs(who);
  const req = new Request(`http://codex.test/api/documents/${ID}/file${query}`, { method, headers });
  const res = await (method === 'GET' ? GET(req, ctxOf(ID)) : HEAD(req, ctxOf(ID)));
  if (res.body) await res.arrayBuffer();
  return res;
}

const entries = async (action: string) => (await journalOf(db(), ID)).filter((a) => a.action === action);

describe('file previews', () => {
  it('journals a view of the version shown, with its revision, once within the window', async () => {
    await addDoc(db(), { id: ID });
    expect((await fetchFile('auditor')).status).toBe(200);
    const a = await getRevision(db(), ID, 'A');
    expect((await entries('view')).map((e) => [e.userId, e.detail, e.revisionId])).toEqual([['auditor', 'A · PDF', a.id]]);
    // Reloaded, and pages turned: nothing more within 30 minutes.
    await fetchFile('auditor');
    await fetchFile('auditor', { headers: { range: 'bytes=0-99' } });
    expect(await entries('view')).toHaveLength(1);
    // Another person is journaled apart.
    await fetchFile('writer');
    expect((await entries('view')).map((e) => e.userId)).toEqual(['auditor', 'writer']);
  });

  it('writes nothing for a range further on, nor for HEAD', async () => {
    await addDoc(db(), { id: ID });
    expect((await fetchFile('auditor', { headers: { range: 'bytes=100-199' } })).status).toBe(206);
    expect((await fetchFile('auditor', { method: 'HEAD' })).status).toBe(200);
    expect(await entries('view')).toEqual([]);
    expect((await fetchFile('auditor', { headers: { range: 'bytes=0-99' } })).status).toBe(206);
    expect(await entries('view')).toHaveLength(1);
  });

  it('journals again after 30 minutes, also when the browser shows the copy it kept (304)', async () => {
    await addDoc(db(), { id: ID });
    const first = await fetchFile('auditor');
    const etag = first.headers.get('etag')!;
    setClock('2026-10-10T08:29:00Z');
    expect((await fetchFile('auditor', { headers: { 'if-none-match': etag } })).status).toBe(304);
    expect(await entries('view')).toHaveLength(1);
    setClock('2026-10-10T08:31:00Z');
    expect((await fetchFile('auditor', { headers: { 'if-none-match': etag } })).status).toBe(304);
    expect(await entries('view')).toHaveLength(2);
  });

  it('keeps a download a download, never folded into views', async () => {
    await addDoc(db(), { id: ID });
    await fetchFile('auditor', { query: '?download=1' });
    await fetchFile('auditor', { query: '?download=1' });
    expect(await entries('download')).toHaveLength(2);
    expect(await entries('view')).toEqual([]);
  });

  it('writes nothing for a file refused', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect((await fetchFile('auditor')).status).toBe(404);
    expect(await journalOf(db(), ID)).toEqual([]);
  });
});

describe('records opened', () => {
  it('journals the record once within the window, tied to the revision in force', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    actAs('writer');
    expect(await recordConsultation(ID)).toEqual({ ok: true });
    expect(await recordConsultation(ID)).toEqual({ ok: true });
    const a = await getRevision(db(), ID, 'A');
    expect((await entries('consult')).map((e) => [e.userId, e.detail, e.revisionId])).toEqual([['writer', 'A', a.id]]);
    setClock('2026-10-10T08:31:00Z');
    await recordConsultation(ID);
    expect(await entries('consult')).toHaveLength(2);
  });

  it('writes nothing for a document the user may not read', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    actAs('auditor');
    expect(await recordConsultation(ID)).toMatchObject({ ok: false });
    expect(await recordConsultation('PRO-QUA-9999')).toMatchObject({ ok: false });
    expect(await journalOf(db(), ID)).toEqual([]);
    // Its drafting circle is journaled, under the draft, which only the circle reads (readerMaySeeEntry).
    actAs('owner');
    expect(await recordConsultation(ID)).toEqual({ ok: true });
    expect((await entries('consult')).map((e) => e.detail)).toEqual(['A']);
  });
});

describe('who reads them (D-14)', () => {
  it('hides a view of a draft outside its drafting circle, and keeps consultations out of the activity', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const [b1] = await db().select().from(s.workingVersions).where(eq(s.workingVersions.revisionId, (await getRevision(db(), ID, 'B')).id));
    expect((await fetchFile('writer', { query: `?v=${b1.id}` })).status).toBe(200);
    actAs('writer');
    await recordConsultation(ID);
    expect((await entries('view')).map((e) => e.detail)).toEqual(['B.1 · PDF']);

    actAs('auditor');
    const outside = await listAudit(await getCtx(), { docId: ID, consultations: 'only' });
    expect(outside.map((e) => [e.action, e.detail])).toEqual([['consult', 'A']]);
    actAs('manager');
    const all = await listAudit(await getCtx(), { docId: ID, consultations: 'only' });
    expect(all.map((e) => e.action).sort()).toEqual(['consult', 'view']);
    expect(await listAudit(await getCtx(), { docId: ID, consultations: 'without' })).toEqual([]);
    expect(await listAudit(await getCtx(), { docsOnly: true, consultations: 'without' })).toEqual([]);
  });
});
