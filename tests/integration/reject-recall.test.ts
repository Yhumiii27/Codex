import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { buildAccessIndex } from '@/lib/access';
import { decideStep, recallValidation, requestValidation } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT, type SimRole } from '@/lib/i18n';
import { getDoc as getRecord, listAudit, listWorkflows, myActions } from '@/lib/queries';
import { addDoc, fixClock, getDoc, getRevision, journalOf, revisionStatuses, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Ending a running circuit before its last approval (docs/modele-cible.md §6): an approver rejects the current step,
// with a reason (G17); its requester, or a records manager, recalls the request. Either way the revision goes back to
// drafting and the approvers leave the drafting circle (D-14).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // type PRO: head of the QUA department, then the quality manager
const ECO = 'ECO-2026-010';

async function act<R>(who: Person, fn: () => Promise<R>, role?: SimRole): Promise<R> {
  actAs(who, role);
  return fn();
}

/**
 * Revision A in force; B opened by an ECO for writer, who wrote B.1 and sends it for approval: circuit W-1, steps
 * writer (drafting), head, quality. The owner stays in the drafting circle; writer2 reads the document from outside it.
 */
async function running() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: ECO, versions: ['writer'] }] });
  expect(await act('writer', () => requestValidation(ID, null))).toMatchObject({ ok: true });
  expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'in_review' });
}

async function workflow(id = 'W-1') {
  const [w] = await db().select().from(s.workflows).where(eq(s.workflows.id, id));
  return w;
}

async function comments(id = 'W-1') {
  return db().select().from(s.workflowComments).where(eq(s.workflowComments.workflowId, id));
}

/** Journal entries of the document for an action. */
async function entries(action: string) {
  return (await journalOf(db(), ID)).filter((e) => e.action === action);
}

/** The circuit as `who` (with their default role, or the simulated `role`) gets it from listWorkflows (Validations, the record's Validation tab). */
async function seenBy(who: Person, id = 'W-1', role?: SimRole) {
  actAs(who, role);
  return (await listWorkflows(await getCtx())).find((w) => w.id === id)!;
}

/** Revision A, the first one, drafted by the owner and sent for approval: nothing in force yet, the record reads « En revue ». */
async function firstRevision() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
  expect(await act('owner', () => requestValidation(ID, null))).toMatchObject({ ok: true });
  expect(await getDoc(db(), ID)).toMatchObject({ status: 'in_review', revWorking: 'A', revInForce: null });
}

/** Nothing changed: the circuit still runs at `step`, B is still under review, nothing was commented or journaled. */
async function untouched(step = 1) {
  expect(await workflow()).toMatchObject({ outcome: null, step, closedBy: null, closedAt: null, reason: null });
  expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'in_review' });
  expect(await comments()).toEqual([]);
  expect([...(await entries('reject')), ...(await entries('recall'))]).toEqual([]);
}

describe('rejecting a step: the reason is required (G17)', () => {
  it('refuses a rejection without a reason, and writes nothing', async () => {
    await running();
    for (const reason of [undefined, '', '   \n\t ']) {
      expect(await act('head', () => decideStep('W-1', false, 1, reason)), JSON.stringify(reason)).toEqual({ ok: false, error: t.reason_required });
    }
    await untouched();
    // An approval needs none.
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
  });

  it('refuses a reason over 2,000 characters, and takes one of 2,000', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', false, 1, 'x'.repeat(2001)))).toEqual({ ok: false, error: t.reason_too_long });
    await untouched();
    expect(await act('head', () => decideStep('W-1', false, 1, ` ${'x'.repeat(2000)} `))).toEqual({ ok: true });
    expect((await workflow()).reason).toBe('x'.repeat(2000));
  });

  it('keeps the reason on the circuit, in its comments and in the journal, against the revision; B goes back to drafting', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', false, 1, '  Tableau 3 faux.  '))).toEqual({ ok: true });
    expect(await workflow()).toMatchObject({ outcome: 'rejected', step: 1, closedBy: 'head', closedAt: '2026-10-10', reason: 'Tableau 3 faux.' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getDoc(db(), ID)).revWorking).toBe('B');
    expect((await comments()).map((c) => [c.authorId, c.text])).toEqual([
      ['head', { fr: 'Rejeté — révision renvoyée en rédaction. Motif : Tableau 3 faux.', en: 'Rejected — revision sent back to drafting. Reason: Tableau 3 faux.' }],
    ]);
    const B = await getRevision(db(), ID, 'B');
    expect((await entries('reject')).map((e) => [e.userId, e.detail, e.revisionId])).toEqual([['head', 'W-1 · Tableau 3 faux.', B.id]]);
    // The approvers left the drafting circle with the circuit (D-14).
    expect((await buildAccessIndex(db())).approvers(ID).size).toBe(0);
  });

  it('shows who rejected it, when and why to the author and the owner, nothing of it outside the drafting circle (D-14)', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', false, 1, 'Tableau 3 faux.'))).toEqual({ ok: true });
    for (const who of ['writer', 'owner'] as const) {
      expect(await seenBy(who), who).toMatchObject({ outcomeL: t.wf_rejected, closer: 'head', closedF: '10/10/2026', reason: 'Tableau 3 faux.', stepName: t.wf_rejected });
      // The record's Validation tab lists the circuits of revisions its drafting circle sees.
      actAs(who);
      const ctx = await getCtx();
      expect(await getRecord(ctx, ID), who).toMatchObject({ circle: true });
      expect((await listAudit(ctx, { docId: ID })).find((e) => e.action === 'reject')?.detail, who).toBe('W-1 · Tableau 3 faux.');
    }
    // In Validations, the requester follows it.
    expect((await seenBy('writer')).visible).toBe(true);
    // The approvers no longer see the circuit; a reader outside the circle sees neither it nor the journal entry.
    for (const who of ['head', 'quality', 'writer2'] as const) expect((await seenBy(who)).visible, who).toBe(false);
    actAs('writer2');
    expect(await getRecord(await getCtx(), ID)).toMatchObject({ circle: false });
    // Both entries, the request and the rejection, concern B: hidden until it is in force.
    expect((await journalOf(db(), ID)).map((e) => e.action)).toEqual(['request', 'reject']);
    expect(await listAudit(await getCtx(), { docId: ID })).toEqual([]);
  });
});

describe('rejecting a step: the record follows the revision', () => {
  it('reads « Brouillon » again once the first revision is rejected', async () => {
    await firstRevision();
    expect(await act('head', () => decideStep('W-1', false, 1, 'Incomplet'))).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect(await getDoc(db(), ID)).toMatchObject({ status: 'draft', revWorking: 'A', revInForce: null });
  });
});

describe('recalling a request (docs/modele-cible.md §6)', () => {
  it('is offered to its requester and to records managers only, while it runs', async () => {
    await running();
    for (const who of ['writer', 'manager'] as const) expect((await seenBy(who)).recallable, who).toBe(true);
    // The owner did not request it; the approvers decide on it; a reader outside the circle does not see it.
    for (const who of ['owner', 'head', 'quality', 'writer2'] as const) expect((await seenBy(who)).recallable, who).toBe(false);
    // Simulating another role: a records manager as a collaborator is outside the circle, the requester as an auditor may not edit.
    expect((await seenBy('manager', 'W-1', 'collaborateur')).recallable).toBe(false);
    expect((await seenBy('writer', 'W-1', 'auditeur')).recallable).toBe(false);
    // Still offered after an approval, until the last one.
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
    expect((await seenBy('writer')).recallable).toBe(true);
    expect(await act('quality', () => decideStep('W-1', true, 2))).toEqual({ ok: true });
    for (const who of ['writer', 'manager'] as const) expect((await seenBy(who)).recallable, who).toBe(false);
  });

  it('puts the record back to « Brouillon » when the first revision is recalled', async () => {
    await firstRevision();
    expect((await seenBy('owner')).recallable).toBe(true);
    expect(await act('owner', () => recallValidation('W-1', 1))).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect(await getDoc(db(), ID)).toMatchObject({ status: 'draft', revWorking: 'A', revInForce: null });
  });

  it('lets the requester recall it before the last approval: closed « Rappelé », B back to drafting, the approvers out', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
    expect(await act('writer', () => recallValidation('W-1', 2))).toEqual({ ok: true });
    expect(await workflow()).toMatchObject({ outcome: 'recalled', step: 2, closedBy: 'writer', closedAt: '2026-10-10', reason: null });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getDoc(db(), ID)).status).toBe('in_force');
    expect((await comments()).map((c) => [c.authorId, c.text])).toEqual([
      ['writer', { fr: 'Demande rappelée — révision renvoyée en rédaction.', en: 'Request recalled — revision sent back to drafting.' }],
    ]);
    const B = await getRevision(db(), ID, 'B');
    expect((await entries('recall')).map((e) => [e.userId, e.detail, e.revisionId])).toEqual([['writer', 'W-1', B.id]]);
    expect(await seenBy('writer')).toMatchObject({ visible: true, done: true, outcomeL: t.wf_recalled, stepName: t.wf_recalled, closer: 'writer', recallable: false });

    // The approver whose step was waiting no longer sees it, nor has anything to decide; a stale click changes nothing.
    expect((await buildAccessIndex(db())).approvers(ID).size).toBe(0);
    for (const who of ['head', 'quality'] as const) expect((await seenBy(who)).visible, who).toBe(false);
    actAs('quality');
    expect(await myActions(await getCtx())).toEqual([]);
    expect(await act('quality', () => decideStep('W-1', true, 2))).toEqual({ ok: false, error: t.wrong_step });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });

    // B may be sent for approval again: a new circuit.
    expect(await act('writer', () => requestValidation(ID, null))).toEqual({ ok: true, href: '/validations?f=requested&r=W-2' });
    expect(await workflow('W-2')).toMatchObject({ outcome: null, step: 1 });
  });

  it('keeps an optional reason, bounded like a rejection’s, on the circuit, in its comments and in the journal', async () => {
    await running();
    expect(await act('writer', () => recallValidation('W-1', 1, 'y'.repeat(2001)))).toEqual({ ok: false, error: t.reason_too_long });
    await untouched();
    expect(await act('writer', () => recallValidation('W-1', 1, '  Mauvaise version jointe '))).toEqual({ ok: true });
    expect(await workflow()).toMatchObject({ outcome: 'recalled', reason: 'Mauvaise version jointe' });
    expect((await comments())[0].text).toEqual({ fr: 'Demande rappelée — révision renvoyée en rédaction. Motif : Mauvaise version jointe', en: 'Request recalled — revision sent back to drafting. Reason: Mauvaise version jointe' });
    expect((await entries('recall')).map((e) => e.detail)).toEqual(['W-1 · Mauvaise version jointe']);
  });

  it('lets a records manager recall a circuit someone else requested', async () => {
    await running();
    expect(await act('manager', () => recallValidation('W-1', 1, 'Doublon'))).toEqual({ ok: true });
    expect(await workflow()).toMatchObject({ outcome: 'recalled', closedBy: 'manager', reason: 'Doublon' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });

  it('refuses anyone else: an approver, the owner who did not request it, a reader outside the circle, a role without « Modifier »', async () => {
    await running();
    expect(await act('head', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.not_allowed });
    expect(await act('owner', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.not_allowed });
    // The revision under review does not exist for a reader outside the drafting circle (D-14).
    expect(await act('writer2', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.not_found });
    expect(await act('writer', () => recallValidation('W-1', 1), 'auditeur')).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_edit}` });
    // A records manager simulating another role is outside the circle like anyone else.
    expect(await act('manager', () => recallValidation('W-1', 1), 'collaborateur')).toEqual({ ok: false, error: t.not_found });
    expect(await act('writer', () => recallValidation('W-9', 1))).toEqual({ ok: false, error: t.not_found });
    await untouched();
  });

  it('is refused while the document is locked: the circuit waits for the lock to lift', async () => {
    await running();
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    expect(await act('writer', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.locked_hold });
    expect(await act('manager', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.locked_hold });
    await untouched();
  });

  it('does nothing on a stale click: a step decided since, a circuit already recalled (idempotent), rejected or approved', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
    // The requester saw step 1: the circuit moved on, the page is refreshed and nothing changes.
    expect(await act('writer', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.wrong_step });
    expect(await workflow()).toMatchObject({ outcome: null, step: 2 });
    expect(await act('writer', () => recallValidation('W-1', 2))).toEqual({ ok: true });
    // A second click on the same button, or by a records manager: one recall only.
    expect(await act('writer', () => recallValidation('W-1', 2))).toEqual({ ok: false, error: t.wrong_step });
    expect(await act('manager', () => recallValidation('W-1', 2, 'Encore'))).toEqual({ ok: false, error: t.wrong_step });
    expect(await workflow()).toMatchObject({ outcome: 'recalled', closedBy: 'writer', reason: null });
    expect(await comments()).toHaveLength(1);
    expect(await entries('recall')).toHaveLength(1);
  });

  it('cannot undo a rejection or the last approval', async () => {
    await running();
    expect(await act('head', () => decideStep('W-1', false, 1, 'Incomplet'))).toEqual({ ok: true });
    expect(await act('writer', () => recallValidation('W-1', 1))).toEqual({ ok: false, error: t.wrong_step });
    expect(await workflow()).toMatchObject({ outcome: 'rejected', closedBy: 'head' });

    expect(await act('writer', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    expect(await act('head', () => decideStep('W-2', true, 1))).toEqual({ ok: true });
    expect(await act('quality', () => decideStep('W-2', true, 2))).toEqual({ ok: true });
    expect(await workflow('W-2')).toMatchObject({ outcome: 'approved', closedBy: 'quality', closedAt: '2026-10-10' });
    expect(await act('writer', () => recallValidation('W-2', 3))).toEqual({ ok: false, error: t.wrong_step });
    expect(await act('manager', () => recallValidation('W-2', 3))).toEqual({ ok: false, error: t.wrong_step });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect(await db().select().from(s.auditLog).where(and(eq(s.auditLog.docId, ID), eq(s.auditLog.action, 'recall')))).toEqual([]);
  });

  it('puts B back in « À traiter » for its author and the owner, with who recalled it and why; nothing for the approvers', async () => {
    await running();
    expect(await act('manager', () => recallValidation('W-1', 1, 'Doublon de PRO-QUA-0002'))).toEqual({ ok: true });
    const recalled = `${ID} · ${t.rev_short} B.1 ${t.todo_recalled} manager · ${ECO}`;
    for (const who of ['writer', 'owner'] as const) {
      actAs(who);
      expect((await myActions(await getCtx())).map((a) => [a.kind, a.detail, a.note, a.href]), who).toEqual([
        ['recalled', recalled, `${t.ecr_reason} : Doublon de PRO-QUA-0002`, `/documents/${ID}?tab=versions`],
      ]);
    }
    for (const who of ['head', 'quality'] as const) {
      actAs(who);
      expect(await myActions(await getCtx()), who).toEqual([]);
    }
  });

  it('quotes no reason when there is none, and a long one abridged: the record shows all of it', async () => {
    await running();
    expect(await act('writer', () => recallValidation('W-1', 1))).toEqual({ ok: true });
    actAs('owner');
    expect((await myActions(await getCtx())).map((a) => [a.kind, a.note])).toEqual([['recalled', null]]);

    expect(await act('writer', () => requestValidation(ID, null))).toMatchObject({ ok: true });
    const long = `Voir les remarques ${'détaillées '.repeat(40)}`;
    expect(await act('head', () => decideStep('W-2', false, 1, long))).toEqual({ ok: true });
    actAs('owner');
    const [item] = await myActions(await getCtx());
    expect(item.kind).toBe('rejected');
    expect(item.note).toHaveLength(`${t.ecr_reason} : `.length + 140);
    expect(item.note?.startsWith(`${t.ecr_reason} : Voir les remarques détaillées`)).toBe(true);
    expect(item.note?.endsWith('…')).toBe(true);
    expect((await seenBy('owner', 'W-2')).reason).toBe(long.trim());
  });
});
