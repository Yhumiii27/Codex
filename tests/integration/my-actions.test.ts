import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { decideStep, graftChange, requestChange, requestValidation } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT, MATRIX_ROLE, type SimRole } from '@/lib/i18n';
import { applyChangeDecision } from '@/lib/lifecycle';
import { myActions } from '@/lib/queries';
import { addDoc, addWorkflow, fixClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// « À traiter » (G19): what waits for the user, the one list of the home, the sidebar badge and the bell. An item shows
// only on a document the user may see (D-14) and when the server would let them act on it (lib/actions.ts).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // type PRO: head of the QUA department, then the quality manager
const ECO = 'ECO-2026-010';

/** What waits for `who`, with their default role or the simulated `role`. */
async function todo(who: Person, role?: SimRole) {
  actAs(who, role);
  return myActions(await getCtx());
}

/** Kind and document of each item waiting for `who`. */
async function kinds(who: Person, role?: SimRole) {
  return (await todo(who, role)).map((a) => `${a.kind} ${a.docId}`);
}

/** Revision A in force, B drafted: opened by an ECO for `modifier` when given, its working versions by `authors`. */
const drafting = (opts: { modifier?: Person; authors?: Person[]; id?: string } = {}) =>
  addDoc(db(), {
    id: opts.id ?? ID,
    revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: opts.modifier ?? null, changeRef: opts.modifier ? ECO : null, versions: opts.authors ?? [] }],
  });

async function act<R>(who: Person, fn: () => Promise<R>): Promise<R> {
  actAs(who);
  return fn();
}

describe('approval steps', () => {
  it('lists the step waiting for the user’s decision, with a link to it, and nothing to the others', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
    expect(await todo('head')).toEqual([{
      key: 'step:W-1', kind: 'step', docId: ID, docTitle: ID, href: '/validations?r=W-1', due: '2026-10-20',
      detail: `${ID} · ${t.rev_short} B · ${t.requested_by} owner · ${t.step} : step 1 · ${t.due} 20/10/2026`,
    }]);
    // The next approver, the requester and a records manager have nothing to decide yet.
    for (const who of ['quality', 'owner', 'manager'] as const) expect(await kinds(who), who).toEqual([]);
  });

  it('leaves out a step for a role without the Validations screen, even when granted the approve permission', async () => {
    // An administrator grants « Valider » to auditors: one may be designated, but decideStep refuses a role that cannot
    // open Validations, so the step is not offered (its link would lead to a screen the role cannot open).
    await db().insert(s.rolePermissions).values({ role: MATRIX_ROLE.auditeur, perm: 'approve', granted: true });
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['auditor'] });
    expect(await kinds('auditor')).toEqual([]);
    expect(await act('auditor', () => decideStep('W-1', true, 1))).toEqual({ ok: false, error: t.forbidden });
    // The same person simulated as an approver may decide it: the step is listed.
    expect(await kinds('auditor', 'validateur')).toEqual([`step ${ID}`]);
  });

  it('leaves out a step the user cannot decide: without the approve permission, or on a locked document', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
    expect(await kinds('head', 'collaborateur')).toEqual([]);
    expect(await kinds('head', 'auditeur')).toEqual([]);
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    expect(await kinds('head')).toEqual([]);
  });
});

describe('revisions being drafted', () => {
  it('a revision opened by an ECO waits for its designated modifier, with the change order, and for the owner as his draft', async () => {
    await addDoc(db(), { id: ID });
    await act('writer2', () => requestChange(ID, 'modification', 'Mise à jour', ''));
    const [req] = await db().select().from(s.changeRequests);
    await db().transaction((tx) => applyChangeDecision(tx, req.id, { accepted: true, ecoRef: ECO, modifierId: 'writer' }, 'vigie'));
    expect(await todo('writer')).toEqual([{
      key: `eco:${ID}`, kind: 'eco', docId: ID, docTitle: ID, href: `/documents/${ID}?tab=versions`, due: null,
      detail: `${ID} · ${t.rev_short} B ${t.todo_eco} · ${ECO}`,
    }]);
    // A draft of his never submitted: the owner may send it for approval too, and is told who was designated to write it.
    expect(await todo('owner')).toEqual([{
      key: `draft:${ID}`, kind: 'draft', docId: ID, docTitle: ID, href: `/documents/${ID}?tab=versions`, due: null,
      detail: `${ID} · ${t.rev_short} B ${t.todo_draft} · ${t.todo_assigned} writer · ${ECO}`,
    }]);
    // The requester, a records manager and the approvers have nothing to do.
    for (const who of ['writer2', 'manager', 'head'] as const) expect(await kinds(who), who).toEqual([]);
    // Without the upload permission, there is nothing the modifier can do on a revision without working version.
    expect(await kinds('writer', 'auditeur')).toEqual([]);
  });

  it('the owner designated by the ECO drafts it as its modifier, the last working version named', async () => {
    await drafting({ modifier: 'owner', authors: ['owner', 'owner'] });
    expect((await todo('owner')).map((a) => [a.kind, a.detail])).toEqual([['eco', `${ID} · ${t.rev_short} B.2 ${t.todo_eco} · ${ECO}`]]);
  });

  it('a draft never submitted waits for its owner until it is sent for approval', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect(await todo('owner')).toEqual([{ key: `draft:${ID}`, kind: 'draft', docId: ID, docTitle: ID, href: `/documents/${ID}?tab=versions`, due: null, detail: `${ID} · ${t.rev_short} A.1 ${t.todo_draft}` }]);
    for (const who of ['writer', 'head', 'manager'] as const) expect(await kinds(who), who).toEqual([]);
    expect(await act('owner', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await kinds('owner')).toEqual([]);
    expect(await kinds('head')).toEqual([`step ${ID}`]);
  });

  it('with the edit permission but not upload, only a draft with a working version can be acted on (sent for approval)', async () => {
    await db().delete(s.rolePermissions).where(eq(s.rolePermissions.perm, 'upload'));
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft' }] });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect(await kinds('owner')).toEqual(['draft PRO-QUA-0002']);
  });

  it('nothing on a locked document', async () => {
    await drafting({ modifier: 'writer' });
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    expect(await kinds('writer')).toEqual([]);
    expect(await kinds('owner')).toEqual([]);
  });

  it('a revision sent back by a circuit waits for its author and the owner, with who rejected it, until sent again', async () => {
    await drafting({ modifier: 'writer', authors: ['writer'] });
    expect(await act('writer', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await kinds('writer')).toEqual([]);
    expect(await act('head', () => decideStep('W-1', false, 1))).toEqual({ ok: true });
    const sentBack = `${ID} · ${t.rev_short} B.1 ${t.todo_rejected} head · ${ECO}`;
    for (const who of ['writer', 'owner'] as const) {
      expect((await todo(who)).map((a) => [a.kind, a.detail, a.href]), who).toEqual([['rejected', sentBack, `/documents/${ID}?tab=versions`]]);
    }
    // The approvers left the drafting circle with the circuit (D-14): nothing for them, nor for a records manager.
    for (const who of ['head', 'quality', 'manager'] as const) expect(await kinds(who), who).toEqual([]);
    expect(await act('writer', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await kinds('writer')).toEqual([]);
    expect(await kinds('owner')).toEqual([]);
    expect(await kinds('head')).toEqual([`step ${ID}`]);
  });

  it('not for an author of the revision who is no longer in its drafting circle (D-14)', async () => {
    // A records manager wrote B.1; the owner sent it for approval and the head of department rejected it.
    await drafting({ authors: ['manager'] });
    expect(await act('owner', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await act('head', () => decideStep('W-1', false, 1))).toEqual({ ok: true });
    expect(await kinds('manager')).toEqual([`rejected ${ID}`]);
    expect(await kinds('owner')).toEqual([`rejected ${ID}`]);
    // Simulating another role, the same person is outside the drafting circle: the revision does not exist for them.
    expect(await kinds('manager', 'collaborateur')).toEqual([]);
  });
});

describe('accepted change waiting for the revision being drafted (D-26)', () => {
  /** Revision B drafted by the owner; Vigie accepts a change asked by writer2, designating `writer` for it. */
  async function waiting() {
    await drafting({ authors: ['owner'] });
    expect(await act('writer2', () => requestChange(ID, 'modification', 'Mise à jour', ''))).toMatchObject({ ok: true });
    const [req] = await db().select().from(s.changeRequests);
    const res = await db().transaction((tx) => applyChangeDecision(tx, req.id, { accepted: true, ecoRef: 'ECO-2026-020', modifierId: 'writer' }, 'vigie'));
    expect(res).toMatchObject({ status: 'accepted', revision: 'B' });
    return req.id;
  }
  const graft = `${ID} · ECO-2026-020 ${t.ecr_accepted_l}, ${t.todo_graft} B`;

  it('may be grafted by the author of that revision and by records managers, not by the author Vigie designated', async () => {
    await waiting();
    expect((await todo('owner')).map((a) => [a.kind, a.detail, a.href])).toEqual([
      ['graft', graft, `/documents/${ID}?tab=requests`],
      ['draft', `${ID} · ${t.rev_short} B.1 ${t.todo_draft}`, `/documents/${ID}?tab=versions`],
    ]);
    expect(await kinds('manager')).toEqual([`graft ${ID}`]);
    for (const who of ['writer', 'writer2', 'head'] as const) expect(await kinds(who), who).toEqual([]);
    expect(await kinds('owner', 'auditeur')).toEqual([]);
  });

  it('not on a locked document: the graft would be refused', async () => {
    const id = await waiting();
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    expect(await kinds('owner')).toEqual([]);
    expect(await kinds('manager')).toEqual([]);
    expect(await act('owner', () => graftChange(id))).toEqual({ ok: false, error: t.locked_hold });
  });

  it('no longer once the revision is in review', async () => {
    await waiting();
    expect(await act('owner', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await kinds('owner')).toEqual([]);
    expect(await kinds('manager')).toEqual([]);
  });

  it('no longer once grafted', async () => {
    const id = await waiting();
    expect(await act('owner', () => graftChange(id))).toMatchObject({ ok: true });
    expect(await kinds('owner')).toEqual([`draft ${ID}`]);
    expect(await kinds('manager')).toEqual([]);
  });
});

describe('review and expiry dates', () => {
  /** Revision A in force; review on 30 November (51 days ahead), expiry on 1 October (9 days past). */
  async function dated(over: Partial<typeof s.documents.$inferInsert> = {}, id = ID) {
    await addDoc(db(), { id });
    await db().update(s.documents).set({ reviewDueAt: '2026-11-30', expiresAt: '2026-10-01', processOwnerId: 'writer', ...over }).where(eq(s.documents.id, id));
  }

  it('wait for the owner and the process owner, overdue or within 90 days, with a link to the record', async () => {
    await dated();
    const items = [
      { key: `review:${ID}`, kind: 'review', docId: ID, docTitle: ID, href: `/documents/${ID}?tab=meta`, due: '2026-11-30', detail: `${ID} · ${t.dl_review} 30/11/2026 · 51 ${t.days_left}` },
      { key: `renew:${ID}`, kind: 'renew', docId: ID, docTitle: ID, href: `/documents/${ID}?tab=meta`, due: '2026-10-01', detail: `${ID} · ${t.dl_expiry} 01/10/2026 · 9 ${t.days_late}` },
    ];
    expect(await todo('owner')).toEqual(items);
    expect(await todo('writer')).toEqual(items);
    // Another reader and a records manager, who follows every date in Archivage, have nothing to do.
    for (const who of ['head', 'manager', 'writer2'] as const) expect(await kinds(who), who).toEqual([]);
  });

  it('only within 90 days, never for an end of retention, a locked document or without the edit permission', async () => {
    await dated({ reviewDueAt: '2027-01-08', expiresAt: '2027-01-09' });
    expect(await kinds('owner')).toEqual([`review ${ID}`]);
    await db().update(s.documents).set({ reviewDueAt: '2027-01-09', retentionTrigger: 'creation', retentionYears: 0 }).where(eq(s.documents.id, ID));
    expect(await kinds('owner')).toEqual([]);
    await dated({}, 'PRO-QUA-0002');
    expect(await kinds('owner', 'auditeur')).toEqual([]);
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, 'PRO-QUA-0002'));
    expect(await kinds('owner')).toEqual([]);
  });

  it('the process owner, who can only ask for a change, not while one is pending', async () => {
    await dated();
    expect(await act('writer2', () => requestChange(ID, 'modification', 'Mise à jour', ''))).toMatchObject({ ok: true });
    expect(await kinds('writer')).toEqual([]);
    expect(await kinds('owner')).toEqual([`review ${ID}`, `renew ${ID}`]);
  });

  it('nothing on a document the user may not read (D-13, D-14)', async () => {
    // writer2 (ING) owns the process of a confidential QUA document: outside its department, he does not read it.
    await dated({ conf: 'confidentiel', processOwnerId: 'writer2' });
    expect(await kinds('writer2')).toEqual([]);
    expect(await kinds('owner')).toEqual([`review ${ID}`, `renew ${ID}`]);
  });
});

describe('order', () => {
  it('decisions first, then revisions to draft, grafts, drafts, then dates, each by date', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'draft', versions: ['head'] }], ownerId: 'head' });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0002', letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['head'] });
    await drafting({ id: 'PRO-QUA-0003', modifier: 'head' });
    await addDoc(db(), { id: 'PRO-QUA-0004', ownerId: 'head' });
    await addDoc(db(), { id: 'PRO-QUA-0005', ownerId: 'head' });
    await db().update(s.documents).set({ reviewDueAt: '2026-12-01' }).where(eq(s.documents.id, 'PRO-QUA-0004'));
    await db().update(s.documents).set({ reviewDueAt: '2026-11-01' }).where(eq(s.documents.id, 'PRO-QUA-0005'));
    expect(await kinds('head')).toEqual(['step PRO-QUA-0002', 'eco PRO-QUA-0003', 'draft PRO-QUA-0001', 'review PRO-QUA-0005', 'review PRO-QUA-0004']);
  });
});
