import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema as s } from '@/db';
import { approveRevision, catchUpEffectiveDates, openRevision, promoteDue, putInForce } from '@/lib/lifecycle';
import { addDoc, fixClock, getDoc, getRevision, journalOf, revisionStatuses, setClock, setupDb } from '../support/db';

// Revision lifecycle on a real database (D-11, docs/modele-cible.md §4): Brouillon → En révision → Approuvé → En vigueur
// at the effective date or at once, the previous revision « Remplacé », same ID throughout; locks stop the clock.

const db = setupDb();
fixClock(); // 10 October 2026, Paris

const ID = 'PRO-QUA-0001';
const TODAY = '2026-10-10';

/** Revision A in force, B under review (effective date `effectiveAt`). */
async function underReview(effectiveAt: string | null = null) {
  return addDoc(db(), {
    id: ID,
    revisions: [
      { letter: 'A', status: 'in_force', versions: ['owner'] },
      { letter: 'B', status: 'in_review', effectiveAt, versions: ['writer'] },
    ],
  });
}

const approve = async (letter: string) => {
  const rev = await getRevision(db(), ID, letter);
  return db().transaction((tx) => approveRevision(tx, rev.id));
};

describe('approval without effective date (D-11)', () => {
  it('puts the first revision in force today and the document in force', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    expect(await approve('A')).toBe(true);
    const a = await getRevision(db(), ID, 'A');
    expect(a).toMatchObject({ status: 'in_force', approvedAt: TODAY, inForceAt: TODAY });
    expect(await getDoc(db(), ID)).toMatchObject({ id: ID, status: 'in_force', revInForce: 'A', revWorking: null, issuedAt: TODAY, modifiedAt: TODAY });
    // Entry into force is journalled by Codex, on the revision it concerns (D-14, readerMaySeeEntry).
    expect((await journalOf(db(), ID)).map((e) => [e.userId, e.action, e.detail, e.revisionId])).toEqual([['codex', 'in_force', 'A', a.id]]);
  });

  it('puts the next revision in force under the same ID and makes the previous one « Remplacé », never « Obsolète »', async () => {
    await underReview();
    expect(await approve('B')).toBe(true);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect((await getRevision(db(), ID, 'A')).supersededAt).toBe(TODAY);
    // The document keeps its ID and stays active: « Obsolète » belongs to the withdrawal of the whole document (D-17).
    expect(await getDoc(db(), ID)).toMatchObject({ id: ID, state: 'active', status: 'in_force', revInForce: 'B', revWorking: null, issuedAt: '2026-09-10' });
  });

  it('refuses to approve a revision that is not under review, and changes nothing', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', versions: ['writer'] }] });
    expect(await approve('B')).toBe(false);
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });

  it('leaves a revision already in force alone (two requests promoting it at once)', async () => {
    await underReview();
    await approve('B');
    const b = await getRevision(db(), ID, 'B');
    await db().transaction((tx) => putInForce(tx, b, '2026-10-11'));
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', inForceAt: TODAY });
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'in_force')).toHaveLength(1);
  });

  it('never holds two revisions in force for one document (database constraint)', async () => {
    await underReview();
    const b = await getRevision(db(), ID, 'B');
    await expect(db().update(s.revisions).set({ status: 'in_force' }).where(eq(s.revisions.id, b.id))).rejects.toThrow();
  });
});

describe('effective date (D-11, proposed: in force on its effective date)', () => {
  it('keeps an approved revision with a future effective date « Approuvé », the previous one still in force', async () => {
    await underReview('2026-10-20');
    await approve('B');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    expect(await getDoc(db(), ID)).toMatchObject({ status: 'in_force', revInForce: 'A', revWorking: 'B' });
  });

  it('puts it in force when its date comes (promoteDue), not before', async () => {
    await underReview('2026-10-20');
    await approve('B');
    setClock('2026-10-19T20:00:00Z'); // 19 October, 22:00 in Paris
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    setClock('2026-10-19T22:30:00Z'); // 20 October, 00:30 in Paris
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ inForceAt: '2026-10-20', effectiveAt: '2026-10-20' });
    expect(await getRevision(db(), ID, 'A')).toMatchObject({ supersededAt: '2026-10-20' });
    expect(await getDoc(db(), ID)).toMatchObject({ revInForce: 'B', revWorking: null });
  });

  it('dates the entry into force from the effective date when promoteDue only runs days later', async () => {
    await underReview('2026-10-20');
    await approve('B');
    setClock('2026-10-23T08:00:00Z');
    await promoteDue(db());
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', inForceAt: '2026-10-20' });
  });

  it('puts in force today a revision approved after its effective date, which becomes today', async () => {
    await underReview('2026-10-12');
    setClock('2026-10-15T08:00:00Z');
    await approve('B');
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', approvedAt: '2026-10-15', inForceAt: '2026-10-15', effectiveAt: '2026-10-15' });
  });

  it.each([
    ['under legal hold', { legalHold: true }],
    ['archived', { state: 'archived' as const }],
    ['obsolete', { state: 'obsolete' as const }],
  ])('never puts in force an approved revision of a document %s', async (_, lock) => {
    await underReview('2026-10-20');
    await approve('B');
    await db().update(s.documents).set(lock).where(eq(s.documents.id, ID));
    setClock('2026-10-21T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
  });

  it('puts it in force today at the earliest once the lock lifts, never on a past date (catchUpEffectiveDates)', async () => {
    await underReview('2026-10-20');
    await approve('B');
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    setClock('2026-10-25T08:00:00Z');
    await promoteDue(db());
    // Hold released on 25 October, as releaseHold does (lib/actions.ts); the actions themselves: locks.test.ts.
    await db().transaction(async (tx) => {
      await tx.update(s.documents).set({ legalHold: false }).where(eq(s.documents.id, ID));
      await catchUpEffectiveDates(tx, ID);
    });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'approved', effectiveAt: '2026-10-25' });
    await promoteDue(db());
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', inForceAt: '2026-10-25' });
  });

  it('leaves a future effective date alone when a lock lifts', async () => {
    await underReview('2026-11-02');
    await approve('B');
    await db().transaction((tx) => catchUpEffectiveDates(tx, ID));
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'approved', effectiveAt: '2026-11-02' });
  });
});

describe('openRevision (D-11)', () => {
  it('opens the next letter as a draft for the designated author, under the same ID', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'superseded' }, { letter: 'B', status: 'in_force' }] });
    const rev = await db().transaction((tx) => openRevision(tx, ID, { modifierId: 'writer', changeRef: 'ECO-2026-010' }));
    expect(rev).toMatchObject({ docId: ID, letter: 'C', status: 'draft', modifierId: 'writer', changeRef: 'ECO-2026-010', createdAt: TODAY });
    expect(await getDoc(db(), ID)).toMatchObject({ id: ID, status: 'in_force', revInForce: 'B', revWorking: 'C' });
  });

  it('goes on from Z to AA: letters only, no major/minor index', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'Z', status: 'in_force' }] });
    expect((await db().transaction((tx) => openRevision(tx, ID, {}))).letter).toBe('AA');
  });
});
