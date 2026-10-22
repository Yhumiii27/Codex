import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { reassignStep, transferHoldings } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { listAudit, transferView } from '@/lib/queries';
import { submitChange } from '@/lib/vigie';
import { addDoc, addWorkflow, fixClock, getDoc, getRevision, journalOf, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Holdings of a person who leaves (point 19 of docs/reste-a-faire.md, A15): Administration › Reprise simulates the transfer
// (the transfer itself, rolled back), then a records manager confirms that very plan (its digest) and everything goes in
// one operation, each object journaled, then the whole. Pending steps keep delegateStep's checks; a records manager may
// also reassign one step held by someone else (reassignStep). No replacement is proposed, no account disabled (O-02).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();
const t = DICT.fr;

async function simulate(from: Person, to: Person | null) {
  actAs('manager');
  const plan = await transferView(await getCtx(), from, to);
  if (!plan) throw new Error('no plan');
  return plan;
}
const statuses = (plan: Awaited<ReturnType<typeof simulate>>) => plan.items.map((i) => [i.kind, i.ref, i.ok, i.reason ?? null]);
const entries = async (action: string) => db().select().from(s.auditLog).where(eq(s.auditLog.action, action));

describe('transferHoldings', () => {
  it('lists what a person holds, and simulates without writing anything', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer' });
    const before = await db().select().from(s.auditLog);
    const listed = await simulate('writer', null);
    expect(statuses(listed)).toEqual([['owner', 'PRO-QUA-0001', null, null]]);
    const plan = await simulate('writer', 'writer2');
    expect(statuses(plan)).toEqual([['owner', 'PRO-QUA-0001', true, null]]);
    // Rolled back: the document, the journal and the counters are as they were.
    expect((await getDoc(db(), 'PRO-QUA-0001')).ownerId).toBe('writer');
    expect(await db().select().from(s.auditLog)).toEqual(before);
  });

  it('hands documents (locked ones included), processes, readers and authors over in one operation, journaled', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer' });
    await addDoc(db(), { id: 'PRO-QUA-0002', ownerId: 'writer', legalHold: true });
    await addDoc(db(), { id: 'PRO-QUA-0003', conf: 'confidentiel' });
    await db().update(s.documents).set({ processOwnerId: 'writer' }).where(eq(s.documents.id, 'PRO-QUA-0003'));
    await db().insert(s.documentReaders).values([{ docId: 'PRO-QUA-0003', userId: 'writer' }]);
    await addDoc(db(), { id: 'PRO-QUA-0004', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const versionBefore = (await getDoc(db(), 'PRO-QUA-0003')).version;
    const plan = await simulate('writer', 'writer2');
    const revB = await getRevision(db(), 'PRO-QUA-0004', 'B');
    expect(statuses(plan)).toEqual([
      ['owner', 'PRO-QUA-0001', true, null],
      ['owner', 'PRO-QUA-0002', true, null],
      ['process_owner', 'PRO-QUA-0003', true, null],
      ['reader', 'PRO-QUA-0003', true, null],
      ['modifier', String(revB.id), true, null],
    ]);
    expect(await transferHoldings('writer', 'writer2', plan.digest)).toEqual({ ok: true, message: t.transfer_done.replace('{n}', '5').replace('{to}', 'writer2') });
    expect((await getDoc(db(), 'PRO-QUA-0001')).ownerId).toBe('writer2');
    expect(await getDoc(db(), 'PRO-QUA-0002')).toMatchObject({ ownerId: 'writer2', legalHold: true });
    const doc3 = await getDoc(db(), 'PRO-QUA-0003');
    expect(doc3.processOwnerId).toBe('writer2');
    expect(doc3.version).toBeGreaterThan(versionBefore);
    expect(await db().select().from(s.documentReaders)).toEqual([{ docId: 'PRO-QUA-0003', userId: 'writer2' }]);
    expect((await getRevision(db(), 'PRO-QUA-0004', 'B')).modifierId).toBe('writer2');
    // One entry per object, before → after, then the whole on the person.
    const each = await entries('transfer');
    expect(each.map((e) => [e.docId, e.data?.changes?.[0]])).toEqual([
      ['PRO-QUA-0001', { field: 'ownerId', before: 'writer', after: 'writer2' }],
      ['PRO-QUA-0002', { field: 'ownerId', before: 'writer', after: 'writer2' }],
      ['PRO-QUA-0003', { field: 'processOwnerId', before: 'writer', after: 'writer2' }],
      ['PRO-QUA-0003', { field: 'reader', before: 'writer', after: 'writer2' }],
      ['PRO-QUA-0004', { field: 'modifierId', before: 'writer', after: 'writer2' }],
    ]);
    expect(each.every((e) => e.userId === 'manager')).toBe(true);
    // The author's entry follows its revision (D-14), the others concern the documents as a whole.
    expect(each.map((e) => e.revisionId)).toEqual([null, null, null, null, revB.id]);
    const [summary] = await entries('transfer_summary');
    expect(summary).toMatchObject({ targetKind: 'user', targetId: 'writer', data: { transfer: { to: 'writer2', done: { owner: 2, process_owner: 1, reader: 1, modifier: 1 }, skipped: 0 } } });
    // A reader of the confidential document outside its drafting circle (same department) reads who owns its process,
    // as on the record, but not who its named readers are (setReaders journals only their number).
    actAs('head');
    const seen = (await listAudit(await getCtx(), { docId: 'PRO-QUA-0003' })).filter((e) => e.action === 'transfer').map((e) => e.data?.changes);
    expect(seen).toEqual(expect.arrayContaining([[{ field: 'reader', scope: undefined }], [{ field: 'processOwnerId', before: 'writer', after: 'writer2' }]]));
    // Nothing left: a second confirmation has nothing to hand over.
    const again = await simulate('writer', 'writer2');
    expect(again.items).toEqual([]);
    expect(await transferHoldings('writer', 'writer2', again.digest)).toEqual({ ok: false, error: t.transfer_nothing });
  });

  it('a replacement already reader of a document keeps one row', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0003', conf: 'confidentiel' });
    await db().insert(s.documentReaders).values([{ docId: 'PRO-QUA-0003', userId: 'writer' }, { docId: 'PRO-QUA-0003', userId: 'writer2' }]);
    const plan = await simulate('writer', 'writer2');
    expect(await transferHoldings('writer', 'writer2', plan.digest)).toMatchObject({ ok: true });
    expect(await db().select().from(s.documentReaders)).toEqual([{ docId: 'PRO-QUA-0003', userId: 'writer2' }]);
  });

  it('hands pending steps and holderships over with the checks of a delegation, and says why the others stay', async () => {
    // Step 2 (quality) waits on a circuit whose step 1 (head) is current; a frozen circuit; a circuit quality2 requested.
    await addDoc(db(), { id: 'PRO-QUA-0005', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0005', letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
    await addDoc(db(), { id: 'PRO-QUA-0006', legalHold: true, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-2', docId: 'PRO-QUA-0006', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['quality'] });
    await addDoc(db(), { id: 'PRO-QUA-0007', revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-3', docId: 'PRO-QUA-0007', letter: 'A', requesterId: 'quality2', author: 'owner', approvers: ['quality'] });
    const [holder] = await db().select().from(s.functionHolders).where(eq(s.functionHolders.userId, 'quality'));
    const plan = await simulate('quality', 'quality2');
    expect(statuses(plan)).toEqual([
      ['step', 'W-1:2', true, null],
      ['step', 'W-2:1', false, 'locked_hold'],
      ['step', 'W-3:1', false, 'self_approval'],
      ['holder', String(holder.id), true, null],
    ]);
    expect(await transferHoldings('quality', 'quality2', plan.digest)).toEqual({
      ok: true, message: `${t.transfer_done.replace('{n}', '2').replace('{to}', 'quality2')} · ${t.transfer_skipped_n.replace('{n}', '2')}`,
    });
    const assignee = async (w: string, idx: number) => (await db().select().from(s.workflowSteps).where(and(eq(s.workflowSteps.workflowId, w), eq(s.workflowSteps.idx, idx))))[0].assigneeId;
    expect([await assignee('W-1', 2), await assignee('W-2', 1), await assignee('W-3', 1)]).toEqual(['quality2', 'quality', 'quality']);
    // quality2 already held the function for the whole group: one holdership left.
    expect((await db().select().from(s.functionHolders).where(eq(s.functionHolders.functionKey, 'resp_qualite'))).map((h) => h.userId)).toEqual(['quality2']);
    const [summary] = await entries('transfer_summary');
    expect(summary.data?.transfer).toEqual({ to: 'quality2', done: { step: 1, holder: 1 }, skipped: 2 });
    const [step] = (await entries('transfer')).filter((e) => e.docId === 'PRO-QUA-0005');
    expect(step).toMatchObject({ detail: 'W-1 · step 2', revisionId: (await getRevision(db(), 'PRO-QUA-0005', 'B')).id });
  });

  it('keeps steps and holderships from a replacement whose role cannot approve, and authors from one who cannot draft', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0005', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0005', letter: 'B', requesterId: 'owner', author: 'owner', approvers: ['head', 'quality'] });
    const [holder] = await db().select().from(s.functionHolders).where(eq(s.functionHolders.userId, 'quality'));
    expect(statuses(await simulate('quality', 'writer2'))).toEqual([['step', 'W-1:2', false, 'cannot_approve'], ['holder', String(holder.id), false, 'cannot_approve']]);
    await addDoc(db(), { id: 'PRO-QUA-0004', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const revB = await getRevision(db(), 'PRO-QUA-0004', 'B');
    expect(statuses(await simulate('writer', 'auditor'))).toEqual([['modifier', String(revB.id), false, 'cannot_draft']]);
  });

  it('never makes a replacement judge of their own revision', async () => {
    // owner writes revision B (nobody designated) and head approves it: head cannot become its owner while the step is his.
    await addDoc(db(), { id: 'PRO-QUA-0005', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0005', letter: 'B', requesterId: 'writer', author: 'owner', approvers: ['head', 'quality'] });
    expect(statuses(await simulate('owner', 'head'))).toEqual([['owner', 'PRO-QUA-0005', false, 'owner_approves']]);
    // A designated author likewise.
    await addDoc(db(), { id: 'PRO-QUA-0006', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', modifierId: 'writer', versions: ['writer'] }] });
    await addWorkflow(db(), { id: 'W-2', docId: 'PRO-QUA-0006', letter: 'B', requesterId: 'writer', author: 'writer', approvers: ['quality'] });
    const revB = await getRevision(db(), 'PRO-QUA-0006', 'B');
    expect(statuses(await simulate('writer', 'quality'))).toEqual([['modifier', String(revB.id), false, 'modifier_approves']]);
  });

  it('refuses a plan that changed since it was shown, and writes nothing', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer' });
    const plan = await simulate('writer', 'writer2');
    await addDoc(db(), { id: 'PRO-QUA-0002', ownerId: 'writer' });
    expect(await transferHoldings('writer', 'writer2', plan.digest)).toEqual({ ok: false, error: t.transfer_changed, stale: true });
    expect((await getDoc(db(), 'PRO-QUA-0001')).ownerId).toBe('writer');
    expect(await entries('transfer')).toEqual([]);
    expect(await entries('transfer_summary')).toEqual([]);
    // A forged digest is refused the same way.
    expect(await transferHoldings('writer', 'writer2', 'x')).toMatchObject({ ok: false, stale: true });
  });

  it('is reserved to records managers with access to Administration, whatever is sent', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer' });
    const plan = await simulate('writer', 'writer2');
    for (const [who, role] of [['owner', undefined], ['head', undefined], ['manager', 'validateur']] as const) {
      actAs(who, role);
      expect(await transferHoldings('writer', 'writer2', plan.digest)).toEqual({ ok: false, error: t.forbidden });
    }
    actAs('manager');
    expect(await transferHoldings('writer', 'writer', plan.digest)).toEqual({ ok: false, error: t.transfer_to_invalid });
    expect(await transferHoldings('writer', 'vigie', plan.digest)).toEqual({ ok: false, error: t.transfer_to_invalid });
    expect(await transferHoldings('codex', 'writer2', plan.digest)).toEqual({ ok: false, error: t.transfer_from_unknown });
    expect((await getDoc(db(), 'PRO-QUA-0001')).ownerId).toBe('writer');
  });

  it('lists what it leaves to Vigie, Keystone and the programmes, without touching it', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    const id = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: 'PRO-QUA-0001', requesterId: 'owner', reason: 'r', description: '' }));
    await db().update(s.changeRequests).set({ status: 'accepted', modifierId: 'pm' }).where(eq(s.changeRequests.id, id));
    const plan = await simulate('pm', 'head');
    expect(plan.items).toEqual([]);
    expect(plan.notes).toEqual([{ kind: 'vigie', ref: id, docId: 'PRO-QUA-0001' }, { kind: 'project', ref: 'HLT-026', label: 'Harbor Line' }]);
    expect(statuses(await simulate('researcher', 'head'))).toEqual([]);
    expect((await simulate('researcher', 'head')).notes).toEqual([{ kind: 'program', ref: 'R2601', label: 'Capteurs' }]);
  });

  it('keeps the transfer of a draft’s author within its drafting circle (D-14)', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0004', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    const plan = await simulate('writer', 'writer2');
    await transferHoldings('writer', 'writer2', plan.digest);
    actAs('auditor');
    expect((await listAudit(await getCtx(), { docId: 'PRO-QUA-0004' })).filter((e) => e.action === 'transfer')).toEqual([]);
    actAs('writer2');
    expect((await listAudit(await getCtx(), { docId: 'PRO-QUA-0004' })).filter((e) => e.action === 'transfer')).toHaveLength(1);
  });
});

describe('reassignStep', () => {
  async function circuit() {
    await addDoc(db(), { id: 'PRO-QUA-0005', revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0005', letter: 'B', requesterId: 'writer', author: 'owner', approvers: ['head', 'quality'] });
  }
  const current = async () => (await db().select().from(s.workflowSteps).where(and(eq(s.workflowSteps.workflowId, 'W-1'), eq(s.workflowSteps.idx, 1))))[0].assigneeId;

  it('lets a records manager hand on a step someone else holds, journaled on the revision', async () => {
    await circuit();
    actAs('manager');
    expect(await reassignStep('W-1', 'quality2', 1)).toEqual({ ok: true, message: t.reassign_done });
    expect(await current()).toBe('quality2');
    const [e] = (await journalOf(db(), 'PRO-QUA-0005')).filter((x) => x.action === 'reassign');
    expect(e).toMatchObject({ userId: 'manager', detail: 'W-1 · step 1 : head → quality2', revisionId: (await getRevision(db(), 'PRO-QUA-0005', 'B')).id });
  });

  it('keeps delegateStep’s checks', async () => {
    await circuit();
    actAs('manager');
    expect(await reassignStep('W-1', 'writer', 1)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await reassignStep('W-1', 'owner', 1)).toEqual({ ok: false, error: t.no_self_approval });
    expect(await reassignStep('W-1', 'writer2', 1)).toEqual({ ok: false, error: t.delegate_no_approve });
    expect(await reassignStep('W-1', 'head', 1)).toEqual({ ok: false, error: t.error });
    expect(await reassignStep('W-1', 'codex', 1)).toEqual({ ok: false, error: t.error });
    expect(await reassignStep('W-1', 'quality2', 2)).toEqual({ ok: false, error: t.wrong_step });
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, 'PRO-QUA-0005'));
    expect(await reassignStep('W-1', 'quality2', 1)).toEqual({ ok: false, error: t.locked_hold });
    expect(await current()).toBe('head');
  });

  it('is reserved to records managers', async () => {
    await circuit();
    for (const [who, role] of [['head', undefined], ['writer', undefined], ['manager', 'validateur']] as const) {
      actAs(who, role);
      expect(await reassignStep('W-1', 'quality2', 1)).toEqual({ ok: false, error: t.forbidden });
    }
    expect(await current()).toBe('head');
  });
});
