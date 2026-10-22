import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { decideStep, renameVocabTerm, requestChange, requestValidation, togglePermission, updateType } from '@/lib/actions';
import { DICT } from '@/lib/i18n';
import { applyChangeDecision, lockDoc, promoteDue } from '@/lib/lifecycle';
import { submitChange } from '@/lib/vigie';
import { addDoc, baseOf, fixClock, getDoc, revisionStatuses, setupDb } from '../support/db';
import { actAs } from '../support/session';

// The transactions that read before they write, under READ COMMITTED (point 51 of docs/reste-a-faire.md,
// docs/postgres.md « Transactions »): each statement sees what was committed when it starts, so two transactions on the
// same document used to decide on what they had both read. They now lock the document's row first (lib/lifecycle.ts
// lockDocs): the second waits for the first, then reads what it wrote. Only a PostgreSQL server shows it (npm run
// test:pg): PGlite runs one transaction at a time, where these tests pass as well (nothing overlaps).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // type PRO: head of the QUA department, then the quality manager
const server = !!process.env.CODEX_TEST_DATABASE_URL?.trim();

/** A promise and the function that settles it: lets a test hold a transaction open until it says so. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((resolve) => (open = resolve));
  return { p, open };
}

async function pendingAfter(p: Promise<unknown>, ms: number): Promise<boolean> {
  const tick = Symbol('pending');
  return (await Promise.race([p.then(() => null, () => null), new Promise((r) => setTimeout(() => r(tick), ms))])) === tick;
}

/** Revision A sent for approval by its owner: circuit W-1 at the step of head, then quality. */
async function inReview() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
  actAs('owner');
  expect(await requestValidation(ID, null, await baseOf(db(), ID))).toMatchObject({ ok: true });
  const [w] = await db().select().from(s.workflows);
  return w.id;
}

const entries = async (action: string) => (await db().select().from(s.auditLog).where(and(eq(s.auditLog.action, action), eq(s.auditLog.docId, ID)))).length;

describe('transactions that read before they write', () => {
  it('approves a step once when the same approval is sent several times at once', async () => {
    const wf = await inReview();
    actAs('head');
    const res = await Promise.all([1, 2, 3, 4].map(() => decideStep(wf, true, 1)));
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.filter((r) => !r.ok).map((r) => (r as { error: string }).error)).toEqual([t.wrong_step, t.wrong_step, t.wrong_step]);
    expect(await entries('approve')).toBe(1);
    const [w] = await db().select().from(s.workflows);
    expect([w.step, w.outcome]).toEqual([2, null]);
    // The last step, sent twice at once: the revision enters into force once.
    actAs('quality');
    const last = await Promise.all([decideStep(wf, true, 2), decideStep(wf, true, 2)]);
    expect(last.filter((r) => r.ok)).toHaveLength(1);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
    expect(await entries('in_force')).toBe(1);
  });

  it.skipIf(!server)('makes a decision wait for a transaction that holds the document, then read what it committed', async () => {
    const wf = await inReview();
    const hold = gate();
    const held = gate();
    // Another transaction rejects the circuit meanwhile and keeps the document's row until it commits.
    const other = db().transaction(async (tx) => {
      await lockDoc(tx, ID);
      await tx.update(s.workflows).set({ outcome: 'rejected', closedBy: 'head', closedAt: '2026-10-10' }).where(eq(s.workflows.id, wf));
      held.open();
      await hold.p;
    });
    await held.p;
    actAs('head');
    const decision = decideStep(wf, true, 1);
    try {
      expect(await pendingAfter(decision, 300)).toBe(true);
    } finally {
      hold.open();
    }
    await other;
    // It saw the rejection once committed, instead of approving a circuit already ended.
    expect(await decision).toEqual({ ok: false, error: t.wrong_step });
    expect(await entries('approve')).toBe(0);
  });

  // Revue du lot 9 : deux écritures en masse relisaient les documents sans les verrouiller, puis les réécrivaient d'après
  // cette lecture. Sous READ COMMITTED, ce qu'une autre transaction avait engagé entre-temps était écrasé.
  it.skipIf(!server)('leaves alone a document frozen meanwhile when a type rule is applied to its documents', async () => {
    await addDoc(db(), { id: ID });
    const before = await getDoc(db(), ID);
    const hold = gate();
    const held = gate();
    // A hold put by another transaction, which keeps the document's row until it commits.
    const other = db().transaction(async (tx) => {
      await lockDoc(tx, ID);
      await tx.update(s.documents).set({ legalHold: true, legalHoldAt: '2026-10-10' }).where(eq(s.documents.id, ID));
      held.open();
      await hold.p;
    });
    await held.p;
    actAs('manager');
    const [x] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO'));
    const fd = new FormData();
    const fields: Record<string, string | string[]> = {
      original: 'PRO', code: 'PRO', labelFr: x.labelFr, labelEn: x.labelEn, family: x.family, origins: x.origins, attachments: x.attachments, circuit: x.circuit,
      confAllowed: x.confAllowed, confDefault: x.confDefault, retentionYears: '25', retentionTrigger: 'in_force', retentionDisposition: 'archive', reviewMonths: '', applyRetention: 'on',
    };
    for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
    const saving = updateType(fd);
    try {
      await pendingAfter(saving, 300);
    } finally {
      hold.open();
    }
    await other;
    expect(await saving).toMatchObject({ ok: true, message: expect.stringContaining(t.retention_held_kept.replace('{n}', '1')) });
    // The frozen document keeps its class (D-20: a hold freezes the record).
    const after = await getDoc(db(), ID);
    expect([after.retentionYears, after.retentionTrigger, after.retentionDisposition]).toEqual([before.retentionYears, before.retentionTrigger, before.retentionDisposition]);
  });

  it.skipIf(!server)('keeps a keyword added meanwhile when a term is renamed on its documents', async () => {
    await addDoc(db(), { id: ID });
    await db().update(s.documents).set({ keywords: ['Soudage'] }).where(eq(s.documents.id, ID));
    const [term] = await db().insert(s.keywordTerms).values({ name: 'Soudage', key: 'soudage', createdAt: '2026-10-10' }).returning();
    const hold = gate();
    const held = gate();
    // A metadata edit adds a keyword and keeps the document's row until it commits.
    const other = db().transaction(async (tx) => {
      await lockDoc(tx, ID);
      await tx.update(s.documents).set({ keywords: ['Soudage', 'acier'] }).where(eq(s.documents.id, ID));
      held.open();
      await hold.p;
    });
    await held.p;
    actAs('manager');
    const renaming = renameVocabTerm('keyword', term.id, 'Soudage TIG');
    try {
      await pendingAfter(renaming, 300);
    } finally {
      hold.open();
    }
    await other;
    expect(await renaming).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).keywords).toEqual(['Soudage TIG', 'acier']);
  });

  it('puts an approved revision in force once when several promotions run at once', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-10-09' }] });
    const counts = await Promise.all([promoteDue(db()), promoteDue(db()), promoteDue(db())]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect(await entries('in_force')).toBe(1);
  });

  it('sends one change request when the same one is asked several times at once', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }] });
    actAs('owner');
    const res = await Promise.all([1, 2, 3].map(() => requestChange(ID, 'modification', 'Erreur', '')));
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(await db().select().from(s.changeRequests)).toHaveLength(1);
  });

  it("applies Vigie's decision on a request once when it comes twice at once", async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }] });
    const id = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'owner', reason: 'r', description: '' }));
    const res = await Promise.all([1, 2].map(() => db().transaction((tx) => applyChangeDecision(tx, id, { accepted: true, ecoRef: 'ECO-1', modifierId: null }, 'vigie'))));
    expect(res.filter((r) => 'status' in r)).toHaveLength(1);
    expect(res.filter((r) => 'error' in r)).toEqual([{ error: 'not_found' }]);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });

  it('turns a permission back when it is toggled twice at once, each change journaled from what the other left', async () => {
    actAs('manager');
    const [before] = await db().select().from(s.rolePermissions).where(and(eq(s.rolePermissions.role, 'auditeur'), eq(s.rolePermissions.perm, 'edit')));
    const res = await Promise.all([togglePermission('auditeur', 'edit'), togglePermission('auditeur', 'edit')]);
    expect(res.every((r) => r.ok)).toBe(true);
    const [after] = await db().select().from(s.rolePermissions).where(and(eq(s.rolePermissions.role, 'auditeur'), eq(s.rolePermissions.perm, 'edit')));
    expect(after?.granted ?? false).toBe(before?.granted ?? false);
    const log = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'perm'));
    expect(log.map((e) => e.data?.changes?.[0]).map((c) => [c?.before, c?.after])).toEqual([[!!before?.granted, !before?.granted], [!before?.granted, !!before?.granted]]);
  });
});
