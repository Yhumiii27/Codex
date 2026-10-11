import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/integrations/vigie/route';
import { submitChange } from '@/lib/vigie';
import { approveRevision } from '@/lib/lifecycle';
import { addDoc, fixClock, getChange, getRevision, journalOf, revisionStatuses, setupDb } from '../support/db';

// The webhook Vigie sends its decisions to (docs/api.md, "Réponses"): a replayed decision is answered without effect
// (200 alreadyApplied, 202 alreadyRecorded), a contrary one is refused (409), a designated author who may not draft
// the document is refused (400) and nothing is recorded; an acceptance that cannot apply yet, on a locked document or
// for a change while a revision is open (D-26), is recorded and answered 202 with the reason it waits.

// The route reads the database through getDb(): it gets the test's in-memory database.
vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));

const db = setupDb();
fixClock();

const TOKEN = 'test-token';
const ID = 'PRO-QUA-0001';
let saved: string | undefined;
beforeAll(() => {
  saved = process.env.VIGIE_WEBHOOK_TOKEN;
  process.env.VIGIE_WEBHOOK_TOKEN = TOKEN;
});
afterAll(() => {
  if (saved === undefined) delete process.env.VIGIE_WEBHOOK_TOKEN;
  else process.env.VIGIE_WEBHOOK_TOKEN = saved;
});

async function post(body: Record<string, unknown>) {
  const res = await POST(new Request('http://codex.test/api/integrations/vigie', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const ask = (kind: 'modification' | 'obsolescence' = 'modification') =>
  db().transaction((tx) => submitChange(tx, { kind, docId: ID, requesterId: 'writer', reason: 'r', description: '' }));

describe('POST /api/integrations/vigie', () => {
  it('applies an acceptance once; the same decision sent again answers 200 alreadyApplied without effect', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const decision = { requestId, accepted: true, ecoRef: 'ECO-2026-010', modifierId: 'writer2' };
    expect(await post(decision)).toEqual({ status: 200, body: { ok: true, requestId, kind: 'modification', docId: ID, status: 'implemented', docStatus: 'in_force', revision: 'B' } });
    const journal = await journalOf(db(), ID);
    expect(await post(decision)).toEqual({ status: 200, body: { ok: true, alreadyApplied: true, requestId, docId: ID, status: 'implemented' } });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect(await journalOf(db(), ID)).toEqual(journal);
  });

  it('refuses the contrary decision with 409 already_decided', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    await post({ requestId, accepted: true });
    expect(await post({ requestId, accepted: false })).toEqual({ status: 409, body: { error: 'already_decided', status: 'implemented' } });
    expect((await getChange(db(), requestId)).status).toBe('implemented');
  });

  it('answers a refusal sent again with 200 alreadyApplied', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    expect((await post({ requestId, accepted: false })).body).toMatchObject({ status: 'rejected' });
    expect(await post({ requestId, accepted: false })).toMatchObject({ status: 200, body: { alreadyApplied: true, status: 'rejected' } });
  });

  it('records an acceptance on a frozen document with 202, and the same acceptance sent again gets 202 alreadyRecorded', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const requestId = await ask();
    const decision = { requestId, accepted: true, ecoRef: 'ECO-2026-010' };
    const pending = { ok: true, pending: true, reason: 'locked', requestId, kind: 'modification', docId: ID, status: 'accepted', state: 'active', legalHold: true, revision: null };
    expect(await post(decision)).toEqual({ status: 202, body: pending });
    const journal = await journalOf(db(), ID);
    expect(await post(decision)).toEqual({ status: 202, body: { ...pending, alreadyRecorded: true } });
    expect(await journalOf(db(), ID)).toEqual(journal);
    expect(await post({ requestId, accepted: false })).toEqual({ status: 409, body: { error: 'already_decided', status: 'accepted' } });
    expect(await getChange(db(), requestId)).toMatchObject({ status: 'accepted', ecoRef: 'ECO-2026-010' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
  });

  it('refuses with 400 a designated author who may not draft the document, and records nothing', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    const journal = await journalOf(db(), ID);
    expect(await post({ requestId, accepted: true, modifierId: 'auditor' })).toEqual({ status: 400, body: { error: 'modifier_not_allowed', field: 'modifierId', docId: ID } });
    expect(await getChange(db(), requestId)).toMatchObject({ status: 'submitted', modifierId: null });
    expect(await journalOf(db(), ID)).toEqual(journal);
    // Nothing was recorded: the decision can still be sent with someone who may draft.
    expect((await post({ requestId, accepted: true, modifierId: 'writer' })).status).toBe(200);
  });

  it('refuses a system account or an unknown person as author with 400 unknown_user, whatever the decision', async () => {
    await addDoc(db(), { id: ID });
    const requestId = await ask();
    for (const modifierId of ['vigie', 'nobody']) {
      expect(await post({ requestId, accepted: false, modifierId })).toEqual({ status: 400, body: { error: 'unknown_user', field: 'modifierId' } });
    }
    expect((await getChange(db(), requestId)).status).toBe('submitted');
  });

  it('records a change accepted while a revision is open with 202 revision_open, and the same acceptance sent again gets 202 alreadyRecorded (D-26)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review' }] });
    const requestId = await ask();
    const decision = { requestId, accepted: true, ecoRef: 'ECO-2026-010', modifierId: 'writer2' };
    const pending = { ok: true, pending: true, reason: 'revision_open', requestId, kind: 'modification', docId: ID, status: 'accepted', state: 'active', legalHold: false, revision: 'B' };
    expect(await post(decision)).toEqual({ status: 202, body: pending });
    const journal = await journalOf(db(), ID);
    expect(await post(decision)).toEqual({ status: 202, body: { ...pending, alreadyRecorded: true } });
    expect(await journalOf(db(), ID)).toEqual(journal);
    expect(await post({ requestId, accepted: false })).toEqual({ status: 409, body: { error: 'already_decided', status: 'accepted' } });
    expect(await getChange(db(), requestId)).toMatchObject({ status: 'accepted', ecoRef: 'ECO-2026-010', modifierId: 'writer2' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'in_review' });

    // B enters into force: the change opens C, and the same acceptance sent again is answered as applied.
    const b = await getRevision(db(), ID, 'B');
    await db().transaction((tx) => approveRevision(tx, b.id));
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    expect(await post(decision)).toEqual({ status: 200, body: { ok: true, alreadyApplied: true, requestId, docId: ID, status: 'implemented' } });
  });

  it('gives the lock as the reason first when the document is also locked, with the revision open', async () => {
    await addDoc(db(), { id: ID, legalHold: true, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    const requestId = await ask();
    expect(await post({ requestId, accepted: true })).toEqual({
      status: 202, body: { ok: true, pending: true, reason: 'locked', requestId, kind: 'modification', docId: ID, status: 'accepted', state: 'active', legalHold: true, revision: 'B' },
    });
  });

  it('gives no revision for a withdrawal, which never waits for one', async () => {
    await addDoc(db(), { id: ID, state: 'archived', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    const requestId = await ask('obsolescence');
    expect((await post({ requestId, accepted: true })).body).toMatchObject({ pending: true, reason: 'locked', kind: 'obsolescence', state: 'archived', revision: null });
  });

  it('answers 404 for a request Codex does not know', async () => {
    expect(await post({ requestId: 'ECR-2026-999', accepted: true })).toEqual({ status: 404, body: { error: 'not_found' } });
  });
});
