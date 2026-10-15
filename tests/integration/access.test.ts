import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema as s, type Db } from '@/db';
import { buildAccessIndex, canRead, inDraftingCircle, type Viewer } from '@/lib/access';
import type { Perm } from '@/lib/i18n';
import { applyChangeDecision, approveRevision, defaultPerms, promoteDue } from '@/lib/lifecycle';
import { submitChange } from '@/lib/vigie';
import { addDoc, addWorkflow, fixClock, getDoc, getRevision, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';

// The drafting circle built from the database (D-14, docs/modele-cible.md §5): owner, designated author of an open
// revision, approvers of the running circuit and records managers see drafts; approvers leave it when the circuit ends.

const db = setupDb();
fixClock();

const ID = 'PRO-QUA-0001';

/** A person as access.ts sees them: their row, their default role's permissions, records managers see everything. */
async function viewer(id: Person): Promise<Viewer> {
  const [user] = await db().select().from(s.users).where(eq(s.users.id, id));
  const perms = await defaultPerms(db(), user.role);
  return { user, seesAll: user.role === 'gestionnaire', can: (p: Perm) => perms.has(p) };
}

/** Who of `people` is in the drafting circle of the document, read from the database now. */
async function circle(docId: string, people: Person[]): Promise<Person[]> {
  const [ix, d] = [await buildAccessIndex(db()), await getDoc(db(), docId)];
  const out: Person[] = [];
  for (const p of people) if (inDraftingCircle(await viewer(p), d, ix)) out.push(p);
  return out;
}

const finish = (w: string, outcome: 'approved' | 'rejected') => db().update(s.workflows).set({ outcome }).where(eq(s.workflows.id, w));
const everyone: Person[] = ['manager', 'owner', 'writer', 'writer2', 'auditor', 'head', 'quality', 'quality2', 'director', 'pm', 'engineer'];

describe('buildAccessIndex: drafting circle (D-14)', () => {
  it('holds the owner, the designated author, every approver of the running circuit and the records managers', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
    const ix = await buildAccessIndex(db());
    expect([...ix.modifiers(ID)]).toEqual(['writer']);
    expect([...ix.approvers(ID)].sort()).toEqual(['head', 'quality', 'writer']);
    expect(await circle(ID, everyone)).toEqual(['manager', 'owner', 'writer', 'head', 'quality']);
  });

  it('includes approvers of steps not reached yet', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality', 'director'], step: 1 });
    expect(await circle(ID, ['head', 'quality', 'director'])).toEqual(['head', 'quality', 'director']);
  });

  it.each(['approved', 'rejected'] as const)('lets the approvers of a %s circuit out', async (outcome) => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head', 'quality'] });
    await finish('W-1', outcome);
    expect((await buildAccessIndex(db())).approvers(ID).size).toBe(0);
    expect(await circle(ID, everyone)).toEqual(['manager', 'owner', 'writer']);
  });

  it('keeps an approver of the running circuit while an earlier circuit of the document is over', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head'], outcome: 'rejected' });
    await addWorkflow(db(), { id: 'W-2', docId: ID, letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['quality'] });
    expect(await circle(ID, ['head', 'quality'])).toEqual(['quality']);
  });

  it('is per document: the approver or the author of another document stays outside', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft' }] });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0002', letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head'] });
    expect(await circle(ID, everyone)).toEqual(['manager', 'owner']);
  });

  it('keeps the designated author while the revision waits for its effective date, and lets them out once it is in force', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', effectiveAt: '2026-10-20', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head'] });
    const b = await getRevision(db(), ID, 'B');
    // Last approval (lib/actions.ts, decideStep): the circuit ends, the revision is approved for 20 October.
    await finish('W-1', 'approved');
    await db().transaction((tx) => approveRevision(tx, b.id));
    expect(await circle(ID, ['writer', 'head'])).toEqual(['writer']);
    setClock('2026-10-20T08:00:00Z');
    await promoteDue(db());
    expect((await getRevision(db(), ID, 'B')).status).toBe('in_force');
    expect(await circle(ID, ['writer', 'head'])).toEqual([]);
  });

  it('lets the designated author out when a withdrawal cancels the revision', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: ID, letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['head'] });
    const req = await db().transaction((tx) => submitChange(tx, { kind: 'obsolescence', docId: ID, requesterId: 'owner', reason: 'r', description: '' }));
    await db().transaction((tx) => applyChangeDecision(tx, req, { accepted: true }, 'vigie'));
    expect(await circle(ID, everyone)).toEqual(['manager', 'owner']);
  });

  it('brings the author an accepted change designates into the circle of the revision it opens', async () => {
    await addDoc(db(), { id: ID });
    expect(await circle(ID, ['writer2'])).toEqual([]);
    const req = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer', reason: 'r', description: '' }));
    await db().transaction((tx) => applyChangeDecision(tx, req, { accepted: true, modifierId: 'writer2' }, 'vigie'));
    expect(await circle(ID, ['writer', 'writer2'])).toEqual(['writer2']);
  });
});

describe('drafts outside the circle (D-14)', () => {
  /** A document never in force, under review: approvers see it, then lose it when the circuit is rejected. */
  async function neverInForce(db: Db) {
    await addDoc(db, { id: ID, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db, { id: 'W-1', docId: ID, letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
  }

  it('shows a draft that never entered into force to its circle only', async () => {
    await neverInForce(db());
    const [ix, d] = [await buildAccessIndex(db()), await getDoc(db(), ID)];
    expect(canRead(await viewer('head'), d, ix)).toBe(true);
    expect(canRead(await viewer('writer'), d, ix)).toBe(false); // same department, read permission: not enough
    expect(canRead(await viewer('director'), d, ix)).toBe(false);
  });

  it('hides it again from an approver once the circuit is over', async () => {
    await neverInForce(db());
    await finish('W-1', 'rejected');
    await db().update(s.revisions).set({ status: 'draft' }).where(eq(s.revisions.docId, ID));
    const [ix, d] = [await buildAccessIndex(db()), await getDoc(db(), ID)];
    expect(canRead(await viewer('head'), d, ix)).toBe(false);
    expect(canRead(await viewer('quality'), d, ix)).toBe(false);
    expect(canRead(await viewer('owner'), d, ix)).toBe(true);
    expect(canRead(await viewer('manager'), d, ix)).toBe(true);
  });
});

describe('named readers and project teams', () => {
  it('reads named readers, and the project team: its manager and the holders of a function scoped to the project', async () => {
    await addDoc(db(), { id: 'PID-HLT-026-001', typeCode: 'PID', projectCode: 'HLT-026', conf: 'confidentiel' });
    await db().insert(s.documentReaders).values({ docId: 'PID-HLT-026-001', userId: 'writer2' });
    await db().insert(s.functionHolders).values({ functionKey: 'chef_projet', scopeValue: 'HLT-026', userId: 'engineer' });
    const ix = await buildAccessIndex(db());
    expect([...ix.readers('PID-HLT-026-001')]).toEqual(['writer2']);
    expect([...ix.team('HLT-026')].sort()).toEqual(['engineer', 'pm']);
    expect(ix.team(null).size).toBe(0);
    // A confidential project document: the department, the project team and named readers read it; nobody else.
    const d = await getDoc(db(), 'PID-HLT-026-001');
    const readers: Person[] = [];
    for (const p of ['writer', 'writer2', 'pm', 'engineer', 'director'] as Person[]) if (canRead(await viewer(p), d, ix)) readers.push(p);
    expect(readers).toEqual(['writer', 'writer2', 'pm', 'engineer']);
  });
});
