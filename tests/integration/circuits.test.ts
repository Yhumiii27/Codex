import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { buildAccessIndex } from '@/lib/access';
import { decideStep, delegateStep, requestValidation } from '@/lib/actions';
import { DICT } from '@/lib/i18n';
import { promoteDue } from '@/lib/lifecycle';
import { addDoc, baseOf, fixClock, getDoc, getRevision, revisionStatuses, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Approval circuits through the Server Actions (D-15, docs/modele-cible.md §6): steps by function, resolved at launch
// for the document; the requester, the designated author (otherwise the owner) and the authors of the working versions
// never approve the revision (proposed, not confirmed: docs/decisions.md "Circuits").

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const ID = 'PRO-QUA-0001'; // type PRO: Responsable du département, then Responsable qualité
const t = DICT.fr;

/** Replaces the holders of a function (for one scope, null: the whole group) by `people`, looked up in that order. */
async function holders(fn: string, scope: string | null, people: Person[]) {
  const rows = await db().select().from(s.functionHolders).where(eq(s.functionHolders.functionKey, fn));
  for (const r of rows.filter((x) => x.scopeValue === scope)) await db().delete(s.functionHolders).where(eq(s.functionHolders.id, r.id));
  if (people.length) await db().insert(s.functionHolders).values(people.map((userId) => ({ functionKey: fn, scopeValue: scope, userId })));
}

/** Assignees of the circuit's steps, the author's step first. */
async function steps(workflowId: string): Promise<string[]> {
  const rows = await db().select().from(s.workflowSteps).where(eq(s.workflowSteps.workflowId, workflowId)).orderBy(asc(s.workflowSteps.idx));
  return rows.map((r) => r.assigneeId);
}

async function workflow(id: string) {
  const [w] = await db().select().from(s.workflows).where(eq(s.workflows.id, id));
  return w;
}

/** Revision A in draft, its working versions written by `authors`. */
const draft = (authors: Person[] = ['owner'], over: Partial<Parameters<typeof addDoc>[1]> = {}) =>
  addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: authors }], ...over });

/** Revision A in force, B in draft opened by an ECO for `modifier`, its working versions written by `authors`. */
const change = (modifier: Person, authors: Person[]) =>
  addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: modifier, changeRef: 'ECO-2026-010', versions: authors }] });

async function launch(by: Person) {
  actAs(by);
  return requestValidation(ID, null, await baseOf(db(), ID));
}

describe('requestValidation: resolving the circuit (D-15)', () => {
  it('resolves each function for the document: author first, then the head of its department and the quality manager', async () => {
    await draft(['owner']);
    expect(await launch('owner')).toEqual({ ok: true, href: '/validations?f=requested&r=W-1' });
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
    expect(await workflow('W-1')).toMatchObject({ requesterId: 'owner', step: 1, outcome: null, revisionId: (await getRevision(db(), ID, 'A')).id });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_review' });
    expect((await getDoc(db(), ID)).status).toBe('in_review');
  });

  it('never gives a step to the requester', async () => {
    await draft(['owner']);
    await holders('resp_qualite', null, ['manager', 'quality']);
    expect((await launch('manager')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
  });

  it('never gives a step to the designated author of the revision, whose is the author step', async () => {
    await change('head', ['head']);
    expect((await launch('owner')).ok).toBe(true);
    // head is the department's own holder: the group-level holder takes the step.
    expect(await steps('W-1')).toEqual(['head', 'director', 'quality']);
  });

  it('lets the owner approve a revision someone else was designated to write', async () => {
    await addDoc(db(), { id: ID, ownerId: 'head', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    expect((await launch('manager')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['writer', 'head', 'quality']);
  });

  it('never gives a step to the owner when nobody was designated to write the revision', async () => {
    await draft(['writer'], { ownerId: 'head' });
    expect((await launch('manager')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['writer', 'director', 'quality']);
  });

  it('never gives a step to an author of a working version', async () => {
    await draft(['quality', 'owner']);
    expect((await launch('owner')).ok).toBe(true);
    // The author step goes to the author of the last working version.
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality2']);
  });

  it('excludes the authors of the revision being approved only, not those of earlier revisions', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['quality'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    expect((await launch('owner')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
  });

  it('never gives a step to a holder whose role cannot approve', async () => {
    await draft(['owner']);
    await holders('resp_qualite', null, ['writer', 'quality']);
    expect((await launch('owner')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
  });

  it('refuses to launch when every holder of a function is excluded, and writes nothing', async () => {
    await draft(['quality']);
    await holders('resp_qualite', null, ['quality']);
    expect(await launch('owner')).toEqual({ ok: false, error: `${t.no_holder} : resp_qualite` });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect(await db().select().from(s.workflows)).toEqual([]);
  });

  it('puts in force at once a type without approval step, for someone who may publish', async () => {
    await draft(['owner'], { typeCode: 'COR' });
    expect(await launch('owner')).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_publish}` });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect((await launch('manager')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['owner']);
    expect((await workflow('W-1')).outcome).toBe('approved');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
  });
});

describe('deciding and delegating a step (D-15)', () => {
  /** Circuit W-1 launched by the owner on A, versions by owner and quality2: steps owner, head, quality. */
  async function running() {
    await draft(['quality2', 'owner']);
    expect((await launch('owner')).ok).toBe(true);
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
  }

  const decide = (who: Person, approve: boolean, step: number, reason?: string) => {
    actAs(who);
    return decideStep('W-1', approve, step, reason);
  };

  it('goes through the steps in order and puts the revision in force at the last approval', async () => {
    await running();
    expect(await decide('quality', true, 1)).toEqual({ ok: false, error: t.not_allowed });
    expect(await decide('head', true, 1)).toEqual({ ok: true });
    expect(await workflow('W-1')).toMatchObject({ step: 2, outcome: null });
    expect(await decide('head', true, 1)).toEqual({ ok: false, error: t.wrong_step });
    expect(await decide('quality', true, 2)).toEqual({ ok: true });
    expect(await workflow('W-1')).toMatchObject({ step: 3, outcome: 'approved' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    // The circuit is over: its approvers leave the drafting circle (D-14).
    expect((await buildAccessIndex(db())).approvers(ID).size).toBe(0);
  });

  it('sends the revision back to drafting on a rejection', async () => {
    await running();
    expect(await decide('head', false, 1, 'Section 3 incomplète')).toEqual({ ok: true });
    expect((await workflow('W-1')).outcome).toBe('rejected');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'draft' });
    expect((await buildAccessIndex(db())).approvers(ID).size).toBe(0);
  });

  it('refuses a decision from an author of the revision who came to hold the step (holders changed since the launch)', async () => {
    await running();
    await db().update(s.workflowSteps).set({ assigneeId: 'quality2' }).where(and(eq(s.workflowSteps.workflowId, 'W-1'), eq(s.workflowSteps.idx, 1)));
    expect(await decide('quality2', true, 1)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await workflow('W-1')).toMatchObject({ step: 1, outcome: null });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_review' });
  });

  it('refuses a decision from the requester who came to hold the step', async () => {
    await draft(['owner']);
    expect((await launch('manager')).ok).toBe(true);
    await db().update(s.workflowSteps).set({ assigneeId: 'manager' }).where(and(eq(s.workflowSteps.workflowId, 'W-1'), eq(s.workflowSteps.idx, 2)));
    expect(await decide('head', true, 1)).toEqual({ ok: true });
    expect(await decide('manager', true, 2)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_review' });
  });

  it('refuses to delegate a step to the requester, an author of the revision, or someone who cannot approve', async () => {
    await running();
    actAs('head');
    expect(await delegateStep('W-1', 'quality2', 1)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await delegateStep('W-1', 'owner', 1)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await delegateStep('W-1', 'writer', 1)).toEqual({ ok: false, error: t.delegate_no_approve });
    expect(await steps('W-1')).toEqual(['owner', 'head', 'quality']);
    expect(await delegateStep('W-1', 'director', 1)).toEqual({ ok: true });
    expect(await steps('W-1')).toEqual(['owner', 'director', 'quality']);
  });
});

describe('effective date chosen at launch (D-11, docs/modele-cible.md §4)', () => {
  it('keeps the revision « Approuvé » after the last approval until its effective date, then puts it in force', async () => {
    await change('writer', ['writer']);
    actAs('owner');
    expect((await requestValidation(ID, '2026-10-20', await baseOf(db(), ID))).ok).toBe(true);
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_review', effectiveAt: '2026-10-20' });
    expect(await steps('W-1')).toEqual(['writer', 'head', 'quality']);
    actAs('head');
    expect(await decideStep('W-1', true, 1)).toEqual({ ok: true });
    setClock('2026-10-12T08:00:00Z');
    actAs('quality');
    expect(await decideStep('W-1', true, 2)).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ approvedAt: '2026-10-12', effectiveAt: '2026-10-20', inForceAt: null });
    expect(await getDoc(db(), ID)).toMatchObject({ status: 'in_force', revInForce: 'A' });

    setClock('2026-10-20T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ inForceAt: '2026-10-20' });
  });

  it.each([
    ['a past day', '2026-10-09'],
    ['a day that does not exist', '2026-02-30'],
    ['text that is not a date', 'demain'],
  ])('refuses %s as effective date, and writes nothing', async (_, date) => {
    await change('writer', ['writer']);
    actAs('owner');
    expect(await requestValidation(ID, date, await baseOf(db(), ID))).toEqual({ ok: false, error: t.invalid_date });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await getRevision(db(), ID, 'B')).effectiveAt).toBeNull();
    expect(await db().select().from(s.workflows)).toEqual([]);
  });
});
