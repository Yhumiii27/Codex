import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import type { RevStatus } from '@/db/schema';
import { addWorkingVersion, decideStep, graftChange, releaseHold, requestChange, requestValidation, simulateVigieDecision } from '@/lib/actions';
import { buildAccessIndex, inDraftingCircle, readerMaySeeRevision } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { applyChangeDecision, applyPendingDecision, approveRevision, cancelOpenRevisions, promoteDue } from '@/lib/lifecycle';
import { acceptedWaitL, decisionWaitL, listAudit, listChangeRequests, listRevisions } from '@/lib/queries';
import { submitChange } from '@/lib/vigie';
import { addDoc, addWorkflow, fixClock, getChange, getDoc, getRevision, journalOf, revisionStatuses, setClock, setupDb, type DocSpec } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// A change Vigie accepts while a revision of the document is already open (D-26, docs/decisions.md): it is recorded
// « Acceptée » and waits, then opens the next revision once the open one enters into force or is cancelled; or it is
// grafted onto the open revision while that one is drafted, by a records manager or its author. A lock adds to the
// wait. Outside the drafting circle, nothing tells of the graft or of the revision it is linked to (D-14).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

// No Vigie endpoint: decisions may be simulated from Codex (lib/vigie.ts, vigieSimulated).
beforeAll(() => {
  vi.stubEnv('VIGIE_API_URL', '');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const t = DICT.fr;
const ID = 'PRO-QUA-0001';
const ECO_B = 'ECO-2026-010'; // the change order that opened B
const ECO = 'ECO-2026-020'; // the change Vigie accepts while B is open
const DECIDED = '2026-10-10 10:00:00';

/** A in force, B open with status `status`, drafted by writer under ECO_B (unless `rev` says otherwise). */
const withOpen = (status: RevStatus, over: Partial<DocSpec> = {}, rev: { effectiveAt?: string; modifierId?: Person | null } = {}) =>
  addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status, modifierId: 'modifierId' in rev ? rev.modifierId : 'writer', changeRef: ECO_B, effectiveAt: rev.effectiveAt ?? null, versions: ['writer'] }], ...over });

/** A change asked by writer2 (lib/vigie.ts, as requestChange does). */
const ask = () => db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer2', reason: 'r', description: '' }));

type Decision = Parameters<typeof applyChangeDecision>[2];
const decide = (id: string, decision: Decision) => db().transaction((tx) => applyChangeDecision(tx, id, decision, 'vigie'));

/** A change accepted by Vigie while B is open, naming `modifierId` to write it. */
async function waiting(modifierId: Person | null = 'writer2') {
  const id = await ask();
  expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId, note: 'CCB' })).toMatchObject({ status: 'accepted' });
  return id;
}

async function graft(who: Person, id: string) {
  actAs(who);
  return graftChange(id);
}

/** Puts B in force as its last approval does. */
const approveB = async () => {
  const b = await getRevision(db(), ID, 'B');
  if (b.status === 'draft') await db().update(s.revisions).set({ status: 'in_review' }).where(eq(s.revisions.id, b.id));
  return db().transaction((tx) => approveRevision(tx, b.id));
};

describe('change accepted while a revision is open (D-26)', () => {
  it.each<[string, RevStatus, string | undefined]>([
    ['drafted', 'draft', undefined],
    ['under review', 'in_review', undefined],
    ['approved, waiting for its effective date', 'approved', '2026-10-20'],
  ])('is recorded « Acceptée » while B is %s, and opens no second revision', async (_, status, effectiveAt) => {
    await withOpen(status, {}, { effectiveAt });
    const id = await ask();
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer2', note: 'CCB' })).toEqual({ status: 'accepted', state: 'active', legalHold: false, revision: 'B' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'accepted', ecoRef: ECO, modifierId: 'writer2', decisionNote: 'CCB', decidedAt: DECIDED, revisionId: null });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: status });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ modifierId: 'writer', changeRef: ECO_B });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: 'vigie', action: 'ecr', detail: `${id} · ✓`, revisionId: null });
  });

  it('keeps waiting while B stays open, sent back to drafting or not', async () => {
    await withOpen('in_review');
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
    const id = await waiting();
    expect(await db().transaction((tx) => applyPendingDecision(tx, ID))).toBeNull();
    actAs('head');
    expect(await decideStep('W-1', false, 1, 'Plan à revoir')).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });
});

describe('waiting: the change opens the next revision once B is in force or cancelled (D-26)', () => {
  it('at the last approval of B, for the author Vigie named, keeping the date of its decision', async () => {
    await withOpen('in_review');
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
    const id = await waiting('writer2');
    actAs('head');
    expect(await decideStep('W-1', true, 1)).toEqual({ ok: true });
    expect((await getChange(db(), id)).status).toBe('accepted');

    setClock('2026-10-12T08:00:00Z');
    actAs('quality');
    expect(await decideStep('W-1', true, 2)).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    const c = await getRevision(db(), ID, 'C');
    expect(c).toMatchObject({ modifierId: 'writer2', changeRef: ECO, createdAt: '2026-10-12' });
    expect(await getDoc(db(), ID)).toMatchObject({ status: 'in_force', revInForce: 'B', revWorking: 'C' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: ECO, modifierId: 'writer2', revisionId: c.id, decidedAt: DECIDED });
    const journal = (await journalOf(db(), ID)).map((e) => [e.userId, e.action, e.detail]);
    expect(journal.slice(-2)).toEqual([['codex', 'in_force', 'B'], ['vigie', 'ecr', `${ECO} → C`]]);
  });

  it('at once when B goes through a circuit without approval', async () => {
    await withOpen('draft', { typeCode: 'COR' });
    const id = await waiting();
    actAs('manager');
    expect((await requestValidation(ID, null)).ok).toBe(true);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('on the effective date of an approved B (promoteDue)', async () => {
    await withOpen('approved', {}, { effectiveAt: '2026-10-20' });
    const id = await waiting();
    setClock('2026-10-19T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    expect((await getChange(db(), id)).status).toBe('accepted');

    setClock('2026-10-20T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    expect(await getRevision(db(), ID, 'C')).toMatchObject({ modifierId: 'writer2', changeRef: ECO, createdAt: '2026-10-20' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('when B is cancelled', async () => {
    await withOpen('draft');
    const id = await waiting();
    expect(await db().transaction((tx) => cancelOpenRevisions(tx, ID))).toBeNull();
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled', C: 'draft' });
    const c = await getRevision(db(), ID, 'C');
    expect(c).toMatchObject({ modifierId: 'writer2', changeRef: ECO });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', revisionId: c.id });
  });

  it('only once, however many times B is promoted or the pending decisions are looked at', async () => {
    await withOpen('approved', {}, { effectiveAt: '2026-10-20' });
    await waiting();
    setClock('2026-10-20T08:00:00Z');
    await promoteDue(db());
    await promoteDue(db());
    await db().transaction((tx) => applyPendingDecision(tx, ID));
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'ecr' && e.detail.startsWith(ECO))).toHaveLength(1);
  });
});

describe('graft onto the revision being drafted (D-26)', () => {
  it.each<[string, Person]>([
    ['a records manager', 'manager'],
    ['the author of the open revision', 'writer'],
  ])('is done by %s: B keeps its author and also carries the change order', async (_, who) => {
    await withOpen('draft');
    const id = await waiting('writer2');
    expect(await graft(who, id)).toEqual({ ok: true, message: `${t.graft_done} : ${ECO} → B` });
    const b = await getRevision(db(), ID, 'B');
    expect(b).toMatchObject({ status: 'draft', modifierId: 'writer', changeRef: ECO_B });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    // The request shows who writes the change; Vigie's designated author, set aside, is named in the journal.
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: ECO, modifierId: 'writer', revisionId: b.id, decidedAt: DECIDED });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: who, action: 'graft', detail: `${ECO} → B · writer2 → writer`, revisionId: b.id });
  });

  it('is done by the owner when nobody was designated to write the open revision', async () => {
    await withOpen('draft', {}, { modifierId: null });
    const id = await waiting(null);
    expect((await graft('owner', id)).ok).toBe(true);
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', modifierId: 'owner' });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ action: 'graft', detail: `${ECO} → B` });
  });

  it('applies once: B then enters into force with nothing opening after it', async () => {
    await withOpen('draft');
    const id = await waiting();
    await graft('writer', id);
    expect(await graft('writer', id)).toEqual({ ok: false, error: t.graft_not_pending });
    expect(await approveB()).toBe(true);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect(await getDoc(db(), ID)).toMatchObject({ revInForce: 'B', revWorking: null });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it.each<[string, RevStatus, string | undefined]>([
    ['under review', 'in_review', undefined],
    ['approved, waiting for its effective date', 'approved', '2026-10-20'],
  ])('is refused while B is %s: the change can only wait, and nothing is written', async (_, status, effectiveAt) => {
    await withOpen(status, {}, { effectiveAt });
    const id = await waiting();
    const before = await journalOf(db(), ID);
    expect(await graft('manager', id)).toEqual({ ok: false, error: t.graft_not_draft });
    expect(await getChange(db(), id)).toMatchObject({ status: 'accepted', revisionId: null, modifierId: 'writer2' });
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('is refused while the document is locked', async () => {
    await withOpen('draft', { legalHold: true });
    const id = await waiting();
    expect(await graft('manager', id)).toEqual({ ok: false, error: t.locked_hold });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });

  it.each<[string, Person]>([
    ['a reader outside the drafting circle', 'engineer'],
    ['the author Vigie designated, who does not write the open revision', 'writer2'],
    ['an approver who reads the document', 'head'],
    ['the owner, when someone else was designated to write the revision', 'owner'],
  ])('is refused to %s', async (_, who) => {
    await withOpen('draft');
    const id = await waiting();
    const before = await journalOf(db(), ID);
    expect(await graft(who, id)).toEqual({ ok: false, error: t.not_allowed });
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('is refused without the edit permission, even to the author of the revision', async () => {
    await withOpen('draft');
    const id = await waiting();
    actAs('writer', 'auditeur');
    expect(await graftChange(id)).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_edit}` });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });

  it('answers « not found » about a document the user cannot read', async () => {
    await withOpen('draft', { conf: 'tres_confidentiel' });
    const id = await waiting(null);
    expect(await graft('writer2', id)).toEqual({ ok: false, error: t.not_found });
    expect(await graft('writer2', 'ECR-2026-999')).toEqual({ ok: false, error: t.not_found });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });

  it('finds nothing to graft before Vigie has accepted the change', async () => {
    await withOpen('draft');
    const id = await ask();
    expect(await graft('manager', id)).toEqual({ ok: false, error: t.graft_not_pending });
    expect((await getChange(db(), id)).status).toBe('submitted');
  });
});

describe('change accepted while a revision is open on a locked document (D-26, D-16)', () => {
  it('waits for the lock to lift, then for B; it may be grafted once the hold is released', async () => {
    await withOpen('draft', { legalHold: true });
    const id = await ask();
    expect(await decide(id, { accepted: true, ecoRef: ECO })).toEqual({ status: 'accepted', state: 'active', legalHold: true, revision: 'B' });
    actAs('manager');
    expect(await releaseHold(ID)).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect((await graft('writer', id)).ok).toBe(true);
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('opens the next revision once an approved B, whose date passed during the hold, enters into force after it', async () => {
    await withOpen('approved', { legalHold: true }, { effectiveAt: '2026-10-12' });
    const id = await waiting();
    setClock('2026-10-14T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    actAs('manager');
    expect(await releaseHold(ID)).toEqual({ ok: true });
    expect((await getChange(db(), id)).status).toBe('accepted');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force', C: 'draft' });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ inForceAt: '2026-10-14' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('opens nothing when B is cancelled while the document stays locked, and applies when the lock lifts', async () => {
    await withOpen('draft', { state: 'archived' });
    const id = await waiting();
    await db().transaction((tx) => cancelOpenRevisions(tx, ID));
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });
    expect((await getChange(db(), id)).status).toBe('accepted');
    await db().transaction(async (tx) => {
      await tx.update(s.documents).set({ state: 'active' }).where(eq(s.documents.id, ID));
      await applyPendingDecision(tx, ID);
    });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled', C: 'draft' });
  });
});

describe('change request while a revision is open (D-26)', () => {
  it('is accepted, and the simulated acceptance says that it waits for the revision in progress', async () => {
    await withOpen('draft');
    actAs('writer2');
    expect(await requestChange(ID, 'modification', 'r', '')).toEqual({ ok: true, message: `${t.ecr_sent} : ECR-2026-001` });
    expect(await getChange(db(), 'ECR-2026-001')).toMatchObject({ kind: 'modification', status: 'submitted', requesterId: 'writer2' });
    actAs('manager');
    expect(await simulateVigieDecision('ECR-2026-001', true, null)).toEqual({ ok: true, message: `${t.ecr_accepted_waiting} : ${t.ecr_wait_revision} B.` });
    expect((await getChange(db(), 'ECR-2026-001')).status).toBe('accepted');
  });

  it('names the revision in progress, then the lock, when both hold the acceptance', async () => {
    await withOpen('draft', { legalHold: true });
    const id = await ask();
    actAs('manager');
    expect(await simulateVigieDecision(id, true, null)).toEqual({ ok: true, message: `${t.ecr_accepted_waiting} : ${t.ecr_wait_revision} B, ${t.ecr_wait_not_before_hold}.` });
  });

  it('names the revision waited for, then what a lock adds to the wait (record, simulation)', () => {
    const wait = (state: 'active' | 'archived' | 'obsolete', legalHold: boolean) => decisionWaitL(t, { state, legalHold, revision: 'B' });
    expect(wait('active', false)).toBe(`${t.ecr_wait_revision} B`);
    expect(wait('active', true)).toBe(`${t.ecr_wait_revision} B, ${t.ecr_wait_not_before_hold}`);
    expect(wait('archived', false)).toBe(`${t.ecr_wait_revision} B, ${t.ecr_wait_not_before_archived}`);
    expect(wait('archived', true)).toBe(`${t.ecr_wait_revision} B, ${t.ecr_wait_not_before_hold_archived}`);
    expect(wait('obsolete', false)).toBe(`${t.ecr_wait_revision} B, ${t.ecr_wait_not_while_locked}`);
    // Without a revision open (or outside the drafting circle, which knows of none), only the lock is named.
    expect(decisionWaitL(t, { state: 'archived', legalHold: true, revision: null })).toBe(t.ecr_wait_hold_archived);
    expect(decisionWaitL(t, { state: 'active', legalHold: true, revision: null })).toBe(t.ecr_wait_hold);
  });

  it('never promises outside the drafting circle that a change applies when a lock lifts: a hidden revision may hold it too', () => {
    const accepted = { kind: 'modification', status: 'accepted' };
    const doc = (state: 'active' | 'archived' | 'obsolete', legalHold: boolean, revWorking: string | null) => ({ state, legalHold, revWorking });
    // The same words whether a revision is open (or the change grafted onto it) or not: nothing tells which.
    for (const rev of ['B', null]) {
      expect(acceptedWaitL(t, accepted, doc('active', true, rev), false), String(rev)).toBe(t.ecr_wait_no_earlier_hold);
      expect(acceptedWaitL(t, accepted, doc('archived', false, rev), false), String(rev)).toBe(t.ecr_wait_no_earlier_archived);
      expect(acceptedWaitL(t, accepted, doc('archived', true, rev), false), String(rev)).toBe(t.ecr_wait_no_earlier_hold_archived);
      expect(acceptedWaitL(t, accepted, doc('obsolete', false, rev), false), String(rev)).toBe(t.ecr_wait_no_earlier_lock);
      // Without a lock, the reader is given no reason at all: « Acceptée », as listChangeRequests shows it.
      expect(acceptedWaitL(t, accepted, doc('active', false, rev), false), String(rev)).toBeNull();
    }
    // A withdrawal waits for the lock alone: when it applies may be said.
    expect(acceptedWaitL(t, { kind: 'obsolescence', status: 'accepted' }, doc('active', true, 'B'), false)).toBe(t.ecr_wait_hold);
    // The drafting circle is told exactly (decisionWaitL); nothing is said of a request that does not wait.
    expect(acceptedWaitL(t, accepted, doc('active', true, 'B'), true)).toBe(`${t.ecr_wait_revision} B, ${t.ecr_wait_not_before_hold}`);
    expect(acceptedWaitL(t, accepted, doc('active', true, null), true)).toBe(t.ecr_wait_hold);
    expect(acceptedWaitL(t, accepted, doc('active', false, 'B'), true)).toBe(`${t.ecr_wait_revision} B`);
    expect(acceptedWaitL(t, { kind: 'modification', status: 'implemented' }, doc('active', true, 'B'), true)).toBeNull();
  });

  it('keeps the other refusals: one pending request per document, a lock, no revision in force', async () => {
    await withOpen('draft');
    const id = await waiting();
    actAs('owner');
    expect(await requestChange(ID, 'modification', 'r', '')).toEqual({ ok: false, error: `${t.change_pending} : ${id}` });
    expect(await requestChange(ID, 'obsolescence', 'r', '')).toEqual({ ok: false, error: `${t.change_pending} : ${id}` });

    await addDoc(db(), { id: 'PRO-QUA-0002', legalHold: true, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    expect(await requestChange('PRO-QUA-0002', 'modification', 'r', '')).toEqual({ ok: false, error: t.locked_hold });
    await addDoc(db(), { id: 'PRO-QUA-0003', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect(await requestChange('PRO-QUA-0003', 'modification', 'r', '')).toEqual({ ok: false, error: t.need_in_force });
  });
});

describe('drafting circle (D-14)', () => {
  /** What `who` reads of the document: its requests, its journal and its revisions. */
  async function seenBy(who: Person) {
    actAs(who);
    const ctx = await getCtx();
    const [requests, journal, revisions] = await Promise.all([listChangeRequests(ctx, { docId: ID }), listAudit(ctx, { docId: ID }), listRevisions(ctx, ID)]);
    const circle = inDraftingCircle(ctx, await getDoc(db(), ID), await buildAccessIndex(db()));
    // `shown`: the revisions the record lists for them, newest first (Révisions tab).
    return { request: requests[0], requests, journal, revisions, circle, shown: revisions.filter((r) => readerMaySeeRevision(circle, r.status)).map((r) => r.letter) };
  }

  it('hides from readers outside it the change order and author of a change waiting for B or grafted onto it, and the graft itself, until B is in force', async () => {
    await withOpen('draft');
    const id = await waiting('writer2');
    const b = await getRevision(db(), ID, 'B');

    // engineer reads the document (interne, in force) but is outside the drafting circle.
    const waitingSeen = await seenBy('engineer');
    expect(waitingSeen.request).toMatchObject({ id, status: 'accepted', ecoRef: null, modifierId: null, modifier: null, revisionId: null });
    expect((await seenBy('writer')).request).toMatchObject({ id, status: 'accepted', ecoRef: ECO, modifier: 'writer2' });

    await graft('writer', id);
    const outside = await seenBy('engineer');
    // Nothing changes for him: the request still reads « Acceptée », as before the graft.
    expect(outside.request).toEqual(waitingSeen.request);
    expect(outside.journal).toEqual(waitingSeen.journal);
    expect(outside.journal.map((e) => e.action)).not.toContain('graft');
    expect(outside.journal.some((e) => e.detail.includes(ECO))).toBe(false);
    const inside = await seenBy('writer');
    expect(inside.request).toMatchObject({ status: 'implemented', ecoRef: ECO, modifier: 'writer', revisionId: b.id });
    expect(inside.journal.find((e) => e.action === 'graft')).toMatchObject({ detail: `${ECO} → B · writer2 → writer`, revisionId: b.id });
    expect(inside.revisions.find((r) => r.letter === 'B')?.changeRefs).toEqual([ECO_B, ECO]);

    // In force, B and everything about it reach every reader of the document.
    await approveB();
    const after = await seenBy('engineer');
    expect(after.request).toMatchObject({ status: 'implemented', ecoRef: ECO, modifier: 'writer', revisionId: b.id });
    expect(after.journal.find((e) => e.action === 'graft')).toMatchObject({ detail: `${ECO} → B · writer2 → writer` });
    expect(after.revisions.find((r) => r.letter === 'B')?.changeRefs).toEqual([ECO_B, ECO]);
  });

  it('hides the change order and author of a change applied to the next revision while that one is drafted', async () => {
    await withOpen('approved', {}, { effectiveAt: '2026-10-20' });
    const id = await waiting('writer2');
    setClock('2026-10-20T08:00:00Z');
    await promoteDue(db());
    const c = await getRevision(db(), ID, 'C');
    expect((await seenBy('engineer')).request).toMatchObject({ id, status: 'implemented', ecoRef: null, modifier: null, revisionId: null });
    expect((await seenBy('writer2')).request).toMatchObject({ id, status: 'implemented', ecoRef: ECO, modifier: 'writer2', revisionId: c.id });
  });

  it('takes in the author Vigie designated for a change waiting for B: he sees B, the change order and his designation', async () => {
    await withOpen('draft');
    const id = await waiting('writer2');
    // writer2 « modifiera le document via une ECO » (D-14): he will write C once B is in force.
    const designated = await seenBy('writer2');
    expect(designated.circle).toBe(true);
    expect(designated.request).toMatchObject({ id, status: 'accepted', ecoRef: ECO, modifier: 'writer2' });
    expect(designated.shown).toEqual(['B', 'A']);
    expect((await seenBy('engineer')).circle).toBe(false);
    // He sees B but does not write it: taking his change into B is a graft, chosen on the record.
    const before = await journalOf(db(), ID);
    actAs('writer2');
    const fd = new FormData();
    fd.set('docId', ID);
    fd.set('file', new File(['%PDF-1.4\n%%EOF'], 'b.pdf', { type: 'application/pdf' }));
    expect(await addWorkingVersion(fd)).toEqual({ ok: false, error: t.not_allowed });
    expect(await requestValidation(ID, null)).toEqual({ ok: false, error: t.not_allowed });
    expect(await graftChange(id)).toEqual({ ok: false, error: t.not_allowed });
    expect(await journalOf(db(), ID)).toEqual(before);

    // Grafted onto B, the change is written by B's author: writer2 is no longer designated, and leaves the circle.
    await graft('writer', id);
    const after = await seenBy('writer2');
    expect(after.circle).toBe(false);
    expect(after.request).toMatchObject({ id, status: 'accepted', ecoRef: null, modifier: null });
    expect(after.shown).toEqual(['A']);
  });

  it('does not let that designation stand for the right to draft: one who lost access gives way when B enters into force', async () => {
    await withOpen('in_review');
    const id = await waiting('writer2');
    // Very confidential now, with writer as the only named reader: writer2 can no longer read it, but for his designation.
    await db().update(s.documents).set({ conf: 'tres_confidentiel' }).where(eq(s.documents.id, ID));
    await db().insert(s.documentReaders).values({ docId: ID, userId: 'writer' });
    expect((await seenBy('writer2')).circle).toBe(true);
    expect(await approveB()).toBe(true);
    // The requester (writer2) cannot draft either: the owner takes over, and the journal says so.
    expect(await getRevision(db(), ID, 'C')).toMatchObject({ modifierId: 'owner', changeRef: ECO });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', modifierId: 'owner' });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: 'codex', action: 'ecr', detail: `${ECO} · writer2 → owner` });
    expect((await seenBy('writer2')).circle).toBe(false);
  });

  it('shows a change grafted onto B « Appliquée » to readers outside it once B is cancelled by a withdrawal: no wait promised for good', async () => {
    await withOpen('draft');
    const id = await waiting('writer2');
    await graft('writer', id);
    const withdrawal = await db().transaction((tx) => submitChange(tx, { kind: 'obsolescence', docId: ID, requesterId: 'owner', reason: 'r', description: '' }));
    expect(await decide(withdrawal, { accepted: true, ecoRef: 'ECO-2026-030' })).toEqual({ status: 'implemented' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });

    const outside = await seenBy('engineer');
    expect(outside.circle).toBe(false);
    expect(outside.requests.find((r) => r.id === id)).toMatchObject({ status: 'implemented', ecoRef: null, modifier: null, revisionId: null });
    // Nothing accepted is left: the record shows no pending decision, and no reason to wait (acceptedWaitL).
    expect(outside.requests.filter((r) => r.status === 'accepted' || r.status === 'submitted')).toEqual([]);
    // The drafting circle keeps the whole story: grafted onto B, cancelled since.
    expect((await seenBy('manager')).requests.find((r) => r.id === id)).toMatchObject({ status: 'implemented', ecoRef: ECO, revisionId: (await getRevision(db(), ID, 'B')).id });
  });
});
