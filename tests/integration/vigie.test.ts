import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema as s } from '@/db';
import type { DocState } from '@/db/schema';
import { buildAccessIndex } from '@/lib/access';
import { applyChangeDecision, applyPendingDecision, promoteDue } from '@/lib/lifecycle';
import { submitChange } from '@/lib/vigie';
import { addDoc, addWorkflow, fixClock, getChange, getDoc, getRevision, journalOf, revisionStatuses, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';

// Vigie decisions applied by Codex (D-16, D-17, docs/modele-cible.md §4, docs/api.md "Webhook Vigie"): an accepted
// change opens the next revision in draft for the designated author, an accepted withdrawal makes the document
// obsolete and closes the work in progress; on a locked document an acceptance is recorded and applied when the lock
// lifts (step 3); the designated author must be able to draft the document (step 4).

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

const ID = 'PRO-QUA-0001';
const ECO = 'ECO-2026-010';

/** Asks Vigie for a change of the document (lib/vigie.ts, as requestChange does). */
function ask(kind: 'modification' | 'obsolescence', requesterId: Person = 'writer', docId = ID) {
  return db().transaction((tx) => submitChange(tx, { kind, docId, requesterId, reason: 'r', description: '' }));
}

type Decision = Parameters<typeof applyChangeDecision>[2];
const decide = (id: string, decision: Decision) => db().transaction((tx) => applyChangeDecision(tx, id, decision, 'vigie'));

/** Lifts the document's lock as releaseHold / restoreArchived do, then applies a pending acceptance. */
const unlock = (patch: { legalHold?: boolean; state?: DocState }) =>
  db().transaction(async (tx) => {
    await tx.update(s.documents).set(patch).where(eq(s.documents.id, ID));
    return applyPendingDecision(tx, ID);
  });

const lock = (patch: { legalHold?: boolean; state?: DocState }) => db().update(s.documents).set(patch).where(eq(s.documents.id, ID));

const setRole = (id: Person, role: string) => db().update(s.users).set({ role }).where(eq(s.users.id, id));

describe('accepted change (D-16)', () => {
  it('opens the next revision in draft for the author Vigie names, with the change order', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer2', note: 'CCB' })).toEqual({ status: 'implemented' });
    const b = await getRevision(db(), ID, 'B');
    expect(b).toMatchObject({ status: 'draft', modifierId: 'writer2', changeRef: ECO, createdAt: '2026-10-10' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    // The revision in force stays the one readers see; B is being drafted.
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'active', status: 'in_force', revInForce: 'A', revWorking: 'B' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: ECO, modifierId: 'writer2', decisionNote: 'CCB', decidedAt: '2026-10-10 10:00:00' });
    const entry = (await journalOf(db(), ID)).at(-1);
    expect(entry).toMatchObject({ userId: 'vigie', action: 'ecr', detail: `${ECO} → B`, revisionId: b.id });
  });

  it('falls back on the request reference when Vigie sends no change order', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    await decide(id, { accepted: true });
    expect((await getRevision(db(), ID, 'B')).changeRef).toBe(id);
  });

  it('gives the revision to the requester when Vigie names nobody and the requester may draft the document', async () => {
    await addDoc(db(), { id: ID });
    await decide(await ask('modification', 'writer'), { accepted: true, ecoRef: ECO });
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('writer');
  });

  it('gives it to the owner when the requester may not draft: no upload permission, or no access to the document', async () => {
    await addDoc(db(), { id: ID });
    await decide(await ask('modification', 'auditor'), { accepted: true, ecoRef: ECO });
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('owner');

    // writer2 (ING) cannot read a « très confidentiel » document without being a named reader.
    await addDoc(db(), { id: 'PRO-QUA-0002', conf: 'tres_confidentiel' });
    await decide(await ask('modification', 'writer2', 'PRO-QUA-0002'), { accepted: true });
    expect((await getRevision(db(), 'PRO-QUA-0002', 'B')).modifierId).toBe('owner');
  });

  it('never opens a second revision beside one already open, and writes nothing', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    const id = await ask('modification');
    const before = await journalOf(db(), ID);
    expect(await decide(id, { accepted: true, ecoRef: ECO })).toEqual({ error: 'locked_working' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getChange(db(), id)).status).toBe('submitted');
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('records a refusal and opens nothing', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    expect(await decide(id, { accepted: false, note: 'non' })).toEqual({ status: 'rejected' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'rejected', decisionNote: 'non', decidedAt: '2026-10-10 10:00:00' });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: 'vigie', action: 'ecr', detail: `${id} · ✕` });
  });
});

describe('designated author who may not draft the document (D-16, step 4)', () => {
  it.each<[string, Person]>([
    ['a role without the upload permission', 'auditor'],
    ['no access to the document', 'writer2'],
  ])('refuses the decision for %s, and writes nothing', async (_, who) => {
    await addDoc(db(), { id: ID, conf: 'tres_confidentiel' });
    await db().insert(s.documentReaders).values({ docId: ID, userId: 'auditor' });
    const id = await ask('modification');
    const before = await journalOf(db(), ID);
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: who })).toEqual({ error: 'modifier_not_allowed' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'submitted', ecoRef: null, modifierId: null, decidedAt: null });
    expect(await journalOf(db(), ID)).toEqual(before);
  });

  it('refuses a system account', async () => {
    await addDoc(db(), { id: ID });
    expect(await decide(await ask('modification'), { accepted: true, modifierId: 'vigie' })).toEqual({ error: 'modifier_not_allowed' });
  });

  it('accepts the same person once they are a named reader of the confidential document', async () => {
    await addDoc(db(), { id: ID, conf: 'tres_confidentiel' });
    await db().insert(s.documentReaders).values({ docId: ID, userId: 'writer2' });
    expect(await decide(await ask('modification'), { accepted: true, modifierId: 'writer2' })).toEqual({ status: 'implemented' });
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('writer2');
  });

  it('ignores the named author of a withdrawal', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('obsolescence');
    expect(await decide(id, { accepted: true, modifierId: 'auditor' })).toEqual({ status: 'implemented' });
    expect((await getChange(db(), id)).modifierId).toBeNull();
  });
});

describe('accepted withdrawal (D-17)', () => {
  it('makes the document « Obsolète », closes the running circuit and cancels the open revision', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
    const id = await ask('obsolescence', 'owner');
    expect(await decide(id, { accepted: true, ecoRef: 'ECO-2026-011' })).toEqual({ status: 'implemented' });

    expect(await getDoc(db(), ID)).toMatchObject({ state: 'obsolete', status: 'obsolete', obsoleteAt: '2026-10-10', revInForce: 'A', revWorking: null });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });
    const [w] = await db().select().from(s.workflows).where(eq(s.workflows.id, 'W-1'));
    expect(w.outcome).toBe('rejected');
    const comments = await db().select().from(s.workflowComments).where(eq(s.workflowComments.workflowId, 'W-1'));
    expect(comments.map((c) => c.text)).toEqual([{ fr: 'Circuit clos — document retiré (ECO-2026-011).', en: 'Workflow closed — document withdrawn (ECO-2026-011).' }]);
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: 'ECO-2026-011' });
    const journal = (await journalOf(db(), ID)).map((e) => [e.action, e.detail, e.revisionId]);
    expect(journal).toContainEqual(['reject', 'W-1', (await getRevision(db(), ID, 'B')).id]);
    expect(journal.at(-1)).toEqual(['obsolete', 'ECO-2026-011', null]);
  });

  it('cancels an approved revision waiting for its effective date, which then never enters into force', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-10-20' }] });
    await decide(await ask('obsolescence'), { accepted: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });
    setClock('2026-10-21T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });
  });

  it('cancels a revision being drafted under a change order, whose author leaves the drafting circle (D-14)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: ECO, versions: ['writer'] }] });
    expect([...(await buildAccessIndex(db())).modifiers(ID)]).toEqual(['writer']);
    expect(await decide(await ask('obsolescence', 'owner'), { accepted: true })).toEqual({ status: 'implemented' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'cancelled' });
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'obsolete', status: 'obsolete', revInForce: 'A', revWorking: null });
    expect((await buildAccessIndex(db())).modifiers(ID).has('writer')).toBe(false);
  });

  it('leaves the document active when Vigie refuses the withdrawal', async () => {
    await addDoc(db(), { id: ID });
    expect(await decide(await ask('obsolescence'), { accepted: false })).toEqual({ status: 'rejected' });
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'active', status: 'in_force', obsoleteAt: null });
  });
});

describe('acceptance on a locked document (D-16, D-17, step 3)', () => {
  it('is recorded « Acceptée » under legal hold, with its change order, author and note, and applied when the hold lifts', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer2', note: 'CCB' })).toEqual({ status: 'accepted', state: 'active', legalHold: true });
    expect(await getChange(db(), id)).toMatchObject({ status: 'accepted', ecoRef: ECO, modifierId: 'writer2', decisionNote: 'CCB', decidedAt: '2026-10-10 10:00:00' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: 'vigie', action: 'ecr', detail: `${id} · ✓` });

    setClock('2026-10-14T08:00:00Z');
    expect(await unlock({ legalHold: false })).toBeNull();
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'draft', modifierId: 'writer2', changeRef: ECO, createdAt: '2026-10-14' });
    // The request keeps the date of Vigie's decision, not the day it could apply.
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: ECO, modifierId: 'writer2', decisionNote: 'CCB', decidedAt: '2026-10-10 10:00:00' });
  });

  it('waits as long as the document stays locked', async () => {
    await addDoc(db(), { id: ID, legalHold: true, state: 'archived' });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, ecoRef: ECO })).toMatchObject({ status: 'accepted', state: 'archived', legalHold: true });
    // Hold lifted, still archived: nothing yet.
    expect(await unlock({ legalHold: false })).toBeNull();
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    // Restored: it applies.
    await unlock({ state: 'active' });
    expect((await getChange(db(), id)).status).toBe('implemented');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });

  it('applies an accepted withdrawal when an archived document is restored: it becomes obsolete', async () => {
    await addDoc(db(), { id: ID, state: 'archived' });
    const id = await ask('obsolescence');
    expect(await decide(id, { accepted: true })).toMatchObject({ status: 'accepted', state: 'archived' });
    expect((await getDoc(db(), ID)).state).toBe('archived');
    await unlock({ state: 'active' });
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'obsolete', obsoleteAt: '2026-10-10' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  // The lock is checked before the open revision: the acceptance is recorded, then waits while B is open. Nothing applies
  // it later when B closes (only lifting a lock does): reported, not encoded.
  it('never opens a second revision beside one already open when the hold lifts: the acceptance stays pending', async () => {
    await addDoc(db(), { id: ID, legalHold: true, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, ecoRef: ECO })).toEqual({ status: 'accepted', state: 'active', legalHold: true });
    expect(await unlock({ legalHold: false })).toBeNull();
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect(await getDoc(db(), ID)).toMatchObject({ legalHold: false, revWorking: 'B' });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });

  it('never applies a change to an obsolete document: the acceptance stays pending', async () => {
    await addDoc(db(), { id: ID, state: 'obsolete' });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, ecoRef: ECO })).toMatchObject({ status: 'accepted', state: 'obsolete' });
    expect(await db().transaction((tx) => applyPendingDecision(tx, ID))).toBeNull();
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
  });

  it('applies a refusal at once, lock or not', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification');
    expect(await decide(id, { accepted: false })).toEqual({ status: 'rejected' });
    expect((await getChange(db(), id)).status).toBe('rejected');
  });

  it('checks the named author on receipt, lock or not', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification');
    expect(await decide(id, { accepted: true, modifierId: 'auditor' })).toEqual({ error: 'modifier_not_allowed' });
    expect((await getChange(db(), id)).status).toBe('submitted');
  });

  it('chooses the default author when the decision applies, not when it is received', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification', 'writer');
    await decide(id, { accepted: true, ecoRef: ECO });
    expect((await getChange(db(), id)).modifierId).toBeNull();
    await setRole('writer', 'auditeur'); // the requester loses the upload permission meanwhile
    expect(await unlock({ legalHold: false })).toBeNull(); // nobody was named: nobody is set aside
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('owner');
    expect((await getChange(db(), id)).modifierId).toBe('owner');
  });
});

describe('designated author who can no longer draft when a pending acceptance applies (step 4)', () => {
  /** An acceptance naming `writer`, recorded under legal hold; requester `requester`. */
  async function pending(requester: Person = 'writer2') {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification', requester);
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer' })).toMatchObject({ status: 'accepted' });
    return id;
  }

  it('opens the revision for the default author, and the journal records the substitution', async () => {
    const id = await pending('writer2');
    await setRole('writer', 'auditeur');
    expect(await unlock({ legalHold: false })).toEqual({ setAside: 'writer', modifierId: 'writer2', mayDraft: true });
    const b = await getRevision(db(), ID, 'B');
    expect(b).toMatchObject({ status: 'draft', modifierId: 'writer2', changeRef: ECO });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', modifierId: 'writer2' });
    const entries = (await journalOf(db(), ID)).filter((e) => e.revisionId === b.id).map((e) => [e.userId, e.action, e.detail]);
    expect(entries).toEqual([
      ['vigie', 'ecr', `${ECO} → B`],
      ['codex', 'ecr', `${ECO} · writer → writer2`],
    ]);
  });

  it('does the same when the author lost access to the document (confidentiality raised)', async () => {
    await pending('writer2');
    await db().update(s.documents).set({ conf: 'tres_confidentiel' }).where(eq(s.documents.id, ID));
    await db().insert(s.documentReaders).values({ docId: ID, userId: 'writer2' });
    expect(await unlock({ legalHold: false })).toEqual({ setAside: 'writer', modifierId: 'writer2', mayDraft: true });
  });

  it('opens it for the owner even when the owner cannot draft either, and says so in the journal', async () => {
    await pending('auditor');
    await setRole('writer', 'auditeur');
    await setRole('owner', 'auditeur');
    expect(await unlock({ legalHold: false })).toEqual({ setAside: 'writer', modifierId: 'owner', mayDraft: false });
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('owner');
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({ userId: 'codex', action: 'ecr', detail: `${ECO} · writer → owner (Droit requis : Déposer)` });
  });

  it('keeps the named author who can still draft: no substitution', async () => {
    await pending();
    expect(await unlock({ legalHold: false })).toBeNull();
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('writer');
  });
});

describe('replayed decision', () => {
  it('applies a decision once: a replay finds nothing to do and writes nothing', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer' });
    const journal = await journalOf(db(), ID);
    expect(await decide(id, { accepted: true, ecoRef: ECO, modifierId: 'writer' })).toEqual({ error: 'not_found' });
    expect(await decide(id, { accepted: false })).toEqual({ error: 'not_found' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', modifierId: 'writer' });
    expect(await journalOf(db(), ID)).toEqual(journal);
  });

  it('records a pending acceptance once', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification');
    await decide(id, { accepted: true, ecoRef: ECO });
    expect(await decide(id, { accepted: true, ecoRef: 'ECO-2026-099' })).toEqual({ error: 'not_found' });
    expect(await getChange(db(), id)).toMatchObject({ status: 'accepted', ecoRef: ECO });
  });

  it('applies a pending acceptance once, however many times the lock is lifted', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    await decide(await ask('modification'), { accepted: true, ecoRef: ECO });
    await unlock({ legalHold: false });
    await lock({ legalHold: true });
    await unlock({ legalHold: false });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });
});
