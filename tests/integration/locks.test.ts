import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { releaseHold, restoreArchived, simulateVigieDecision } from '@/lib/actions';
import { DICT } from '@/lib/i18n';
import { promoteDue } from '@/lib/lifecycle';
import { submitChange } from '@/lib/vigie';
import { addDoc, fixClock, getChange, getDoc, getRevision, revisionStatuses, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Locks through the Server Actions (D-16, D-17, step 3, docs/modele-cible.md §4): Vigie's decision simulated by a
// records manager is recorded « Acceptée » on a frozen or archived document, and applied by the action that lifts the
// lock (releaseHold, restoreArchived), which tells who lifted it when the designated author was set aside. The same
// actions bring a past effective date of an approved revision forward to the day the lock lifts (D-11).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

// No Vigie endpoint: decisions are simulated from Codex (lib/vigie.ts, vigieSimulated).
beforeAll(() => {
  vi.stubEnv('VIGIE_API_URL', '');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const t = DICT.fr;
const ID = 'PRO-QUA-0001';

const ask = (kind: 'modification' | 'obsolescence', requesterId: Person = 'writer') =>
  db().transaction((tx) => submitChange(tx, { kind, docId: ID, requesterId, reason: 'r', description: '' }));

async function simulate(id: string, accepted: boolean, modifierId: Person | null = null) {
  actAs('manager');
  return simulateVigieDecision(id, accepted, modifierId);
}

describe('simulated Vigie decision on a locked document', () => {
  it('is recorded under legal hold and applied when the hold is released', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification');
    expect(await simulate(id, true, 'writer2')).toEqual({ ok: true, message: `${t.ecr_accepted_waiting} : ${t.ecr_wait_hold}.` });
    expect(await getChange(db(), id)).toMatchObject({ status: 'accepted', ecoRef: id.replace('ECR', 'ECO'), modifierId: 'writer2' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });

    setClock('2026-10-12T08:00:00Z');
    expect(await releaseHold(ID)).toEqual({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ legalHold: false, revWorking: 'B' });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'draft', modifierId: 'writer2', createdAt: '2026-10-12' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('waits for the hold to be released and the document restored when it is both', async () => {
    await addDoc(db(), { id: ID, legalHold: true, state: 'archived' });
    const id = await ask('modification');
    expect(await simulate(id, true)).toEqual({ ok: true, message: `${t.ecr_accepted_waiting} : ${t.ecr_wait_hold_archived}.` });
    // An archived document under legal hold cannot be restored before the hold is released. What the refused attempt
    // answers is not specified (docs/api.md): only its effect is checked.
    actAs('manager');
    await restoreArchived(ID);
    expect((await getDoc(db(), ID)).state).toBe('archived');
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await releaseHold(ID)).toEqual({ ok: true });
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await restoreArchived(ID)).toEqual({ ok: true });
    expect((await getDoc(db(), ID)).state).toBe('active');
    expect((await getChange(db(), id)).status).toBe('implemented');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
  });

  it('restores a document withdrawn then archived to « Obsolète », where a pending change stays pending', async () => {
    await addDoc(db(), { id: ID, state: 'archived' });
    await db().update(s.documents).set({ obsoleteAt: '2026-09-20' }).where(eq(s.documents.id, ID));
    const id = await ask('modification');
    expect((await simulate(id, true)).ok).toBe(true);
    actAs('manager');
    expect(await restoreArchived(ID)).toEqual({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'obsolete', status: 'obsolete' });
    expect((await getChange(db(), id)).status).toBe('accepted');
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force' });
  });

  it('applies an accepted withdrawal when an archived document is restored', async () => {
    await addDoc(db(), { id: ID, state: 'archived' });
    const id = await ask('obsolescence');
    expect((await simulate(id, true)).ok).toBe(true);
    actAs('manager');
    await restoreArchived(ID);
    expect(await getDoc(db(), ID)).toMatchObject({ state: 'obsolete', obsoleteAt: '2026-10-10' });
    expect((await getChange(db(), id)).status).toBe('implemented');
  });

  it('tells who releases the hold that the designated author, who can no longer draft, was set aside', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await ask('modification', 'writer2');
    await simulate(id, true, 'writer');
    await db().update(s.users).set({ role: 'auditeur' }).where(eq(s.users.id, 'writer'));
    actAs('manager');
    expect(await releaseHold(ID)).toEqual({ ok: true, message: `${t.modifier_set_aside} : writer → writer2` });
    expect((await getRevision(db(), ID, 'B')).modifierId).toBe('writer2');
  });

  it('refuses a designated author who may not draft the document, without falling back on the default one', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    expect(await simulate(id, true, 'auditor')).toEqual({ ok: false, error: `${t.modifier_not_allowed} : auditor` });
    expect(await getChange(db(), id)).toMatchObject({ status: 'submitted', modifierId: null });
  });

  it('is reserved to records managers', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('modification');
    actAs('head');
    expect(await simulateVigieDecision(id, true, null)).toEqual({ ok: false, error: t.vigie_only });
    expect((await getChange(db(), id)).status).toBe('submitted');
  });
});

describe('approved revision waiting for its effective date on a locked document (D-11, docs/modele-cible.md §4)', () => {
  /** A in force, B approved to enter into force on 20 October, the document locked by `lock`. */
  const approvedFor20 = (lock: Partial<Parameters<typeof addDoc>[1]>) =>
    addDoc(db(), { id: ID, ...lock, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-10-20' }] });

  it('enters into force on the day the hold is released, never on its past date', async () => {
    await approvedFor20({ legalHold: true });
    setClock('2026-10-21T08:00:00Z');
    await promoteDue(db());
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });

    setClock('2026-10-25T08:00:00Z');
    actAs('manager');
    expect(await releaseHold(ID)).toEqual({ ok: true });
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'approved', effectiveAt: '2026-10-25' });
    await promoteDue(db());
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', inForceAt: '2026-10-25' });
    expect(await getRevision(db(), ID, 'A')).toMatchObject({ status: 'superseded', supersededAt: '2026-10-25' });
  });

  it('enters into force on the day an archived document is restored, never on its past date', async () => {
    await approvedFor20({ state: 'archived' });
    setClock('2026-10-25T08:00:00Z');
    actAs('manager');
    expect(await restoreArchived(ID)).toEqual({ ok: true });
    expect((await getDoc(db(), ID)).state).toBe('active');
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'approved', effectiveAt: '2026-10-25' });
    await promoteDue(db());
    expect(await getRevision(db(), ID, 'B')).toMatchObject({ status: 'in_force', inForceAt: '2026-10-25' });
  });
});
