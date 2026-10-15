import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { graftChange, requestChange } from '@/lib/actions';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { applyChangeDecision, approveRevision } from '@/lib/lifecycle';
import { listChangeRequests } from '@/lib/queries';
import { submitChange, vigieLinkConfigured, vigieUrl } from '@/lib/vigie';
import { addDoc, fixClock, getRevision, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, cookieStore } from '../support/session';

// Validations › Mes demandes Vigie (G18): each user follows the change and withdrawal requests they sent to Vigie, and
// only theirs, on documents they may still read, as the record shows them to that reader: outside the drafting circle,
// neither the change order, nor the designated author, nor a revision not in force yet (D-14, D-26).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
afterEach(() => {
  vi.unstubAllEnvs();
});
fixClock(); // 10 October 2026, 10:00 in Paris

const t = DICT.fr;
const ID = 'PRO-QUA-0001';
const ECO = 'ECO-2026-020';

/** The requests `who` sent, as « Mes demandes Vigie » lists them. */
async function mine(who: Person) {
  actAs(who);
  return listChangeRequests(await getCtx(), { mine: true });
}

/** Every request `who` may see (records managers: all), as the record lists them. */
async function seen(who: Person, docId?: string) {
  actAs(who);
  return listChangeRequests(await getCtx(), { docId });
}

async function ask(who: Person, docId: string, kind: 'modification' | 'obsolescence' = 'modification') {
  actAs(who);
  const res = await requestChange(docId, kind, `${who} asks`, '');
  expect(res).toMatchObject({ ok: true });
  const [row] = await db().select().from(s.changeRequests).where(eq(s.changeRequests.docId, docId));
  return row.id;
}

const decide = (id: string, accepted: boolean, modifierId: Person | null = null) =>
  db().transaction((tx) => applyChangeDecision(tx, id, { accepted, ecoRef: accepted ? ECO : null, modifierId, note: accepted ? 'CCB' : 'Hors périmètre' }, 'vigie'));

/** Puts revision `letter` of ID in force as its last approval does. */
async function approve(letter: string) {
  const rev = await getRevision(db(), ID, letter);
  await db().update(s.revisions).set({ status: 'in_review' }).where(eq(s.revisions.id, rev.id));
  return db().transaction((tx) => approveRevision(tx, rev.id));
}

describe('Mes demandes Vigie', () => {
  it('lists the requests the user sent and no one else’s, newest first, with their document', async () => {
    await addDoc(db(), { id: ID });
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    const first = await ask('writer2', ID);
    setClock('2026-10-10T09:00:00Z');
    const other = await ask('engineer', 'PRO-QUA-0002', 'obsolescence');
    setClock('2026-10-10T10:00:00Z');
    const last = await ask('writer2', 'PRO-QUA-0003', 'obsolescence');

    const list = await mine('writer2');
    expect(list.map((c) => c.id)).toEqual([last, first]);
    expect(list[1]).toMatchObject({
      docId: ID, docTitle: ID, docHref: `/documents/${ID}`, kind: 'modification', kindL: t.kind_modification,
      status: 'submitted', statusL: t.ecr_submitted, requesterId: 'writer2', when: '10/10 10:00', sentDayF: '10/10/2026', sentF: '10/10/2026 10:00',
      decidedF: null, waitL: null, carrier: null,
    });
    expect(list[0]).toMatchObject({ kindL: t.kind_obsolescence, sentF: '10/10/2026 12:00' });
    expect((await mine('engineer')).map((c) => c.id)).toEqual([other]);
    // A records manager sees every request on the record, but « Mes demandes » are only the ones they sent.
    expect(await mine('manager')).toEqual([]);
    expect((await seen('manager')).map((c) => c.id)).toEqual([last, other, first]);
    // The filter is what keeps the others out: writer2 reads these documents and their requests on the record.
    expect((await seen('writer2', 'PRO-QUA-0002')).map((c) => c.id)).toEqual([other]);
  });

  it('leaves out a request on a document the user may no longer read', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('writer2', ID);
    expect((await mine('writer2')).map((c) => c.id)).toEqual([id]);
    // Very confidential now, writer2 not among its named readers: the request no longer exists for him.
    await db().update(s.documents).set({ conf: 'tres_confidentiel' }).where(eq(s.documents.id, ID));
    expect(await mine('writer2')).toEqual([]);
    expect((await seen('manager')).map((c) => c.id)).toEqual([id]);
  });

  it('shows a refusal with Vigie’s note and date', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('writer2', ID);
    setClock('2026-10-11T07:30:00Z');
    expect(await decide(id, false)).toEqual({ status: 'rejected' });
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'rejected', statusL: t.ecr_rejected, decisionNote: 'Hors périmètre', decidedF: '11/10/2026 09:30', waitL: null, carrier: null });
  });

  it('keeps the year of a request sent long ago, in the interface language', async () => {
    await addDoc(db(), { id: ID });
    setClock('2025-10-06T12:20:00Z');
    const id = await ask('writer2', ID);
    setClock('2026-10-06T12:20:00Z');
    expect(await decide(id, false)).toEqual({ status: 'rejected' });
    expect((await mine('writer2'))[0]).toMatchObject({ id, when: '06/10 14:20', sentDayF: '06/10/2025', sentF: '06/10/2025 14:20', decidedF: '06/10/2026 14:20' });
    actAs('writer2');
    (await cookieStore()).set(COOKIE_LANG, 'en');
    expect((await listChangeRequests(await getCtx(), { mine: true }))[0]).toMatchObject({ sentDayF: '6 Oct 2025', decidedF: '6 Oct 2026 14:20' });
  });

  it('follows an applied change: no change order, author nor revision for a requester outside the drafting circle until it is in force (D-14)', async () => {
    await addDoc(db(), { id: ID });
    const id = await ask('writer2', ID);
    // Vigie names the owner to write it: writer2 stays outside the drafting circle.
    setClock('2026-10-11T07:30:00Z');
    expect(await decide(id, true, 'owner')).toEqual({ status: 'implemented' });
    const b = await getRevision(db(), ID, 'B');
    // Nor the decision date: applied at once, it is when B opened, which his journal does not show either.
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'implemented', statusL: t.ecr_implemented, ecoRef: null, modifierId: null, modifier: null, revisionId: null, carrier: null, waitL: null, decidedAt: null, decidedF: null });
    // The drafting circle sees which revision it opened, and when.
    expect((await seen('owner', ID))[0]).toMatchObject({ id, ecoRef: ECO, modifier: 'owner', revisionId: b.id, carrier: { letter: 'B', grafted: false }, decidedF: '11/10/2026 09:30' });

    expect(await approve('B')).toBe(true);
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'implemented', ecoRef: ECO, modifier: 'owner', revisionId: b.id, carrier: { letter: 'B', grafted: false }, decidedF: '11/10/2026 09:30' });
  });

  it('says what an accepted request waits for, in words the requester may be given', async () => {
    await addDoc(db(), { id: ID });
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    const change = await ask('writer2', ID);
    const withdrawal = await ask('writer2', 'PRO-QUA-0002', 'obsolescence');
    // Frozen after the requests were sent: Vigie's acceptance is recorded and waits for the hold to be released.
    await db().update(s.documents).set({ legalHold: true });
    expect(await decide(change, true, 'owner')).toMatchObject({ status: 'accepted' });
    expect(await decide(withdrawal, true)).toMatchObject({ status: 'accepted' });
    const list = await mine('writer2');
    // Outside the drafting circle, a change is never promised to apply when the hold is lifted (acceptedWaitL).
    expect(list.find((c) => c.id === change)).toMatchObject({ status: 'accepted', statusL: t.ecr_accepted, ecoRef: null, modifier: null, waitL: t.ecr_wait_no_earlier_hold });
    expect(list.find((c) => c.id === withdrawal)).toMatchObject({ status: 'accepted', ecoRef: ECO, waitL: t.ecr_wait_hold });
  });

  it('keeps a change grafted onto a revision the requester does not see « Acceptée », without saying why (D-26)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: 'ECO-2026-010', versions: ['writer'] }] });
    // writer2 asks after B was opened: his request does not tell him so.
    const id = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer2', reason: 'r', description: '' }));
    expect(await decide(id, true, 'writer')).toMatchObject({ status: 'accepted', revision: 'B' });
    // The acceptance date, as for any accepted change: his journal shows it.
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'accepted', ecoRef: null, modifier: null, waitL: null, carrier: null, decidedF: '10/10/2026 10:00' });

    actAs('writer');
    setClock('2026-10-11T07:30:00Z');
    expect(await graftChange(id)).toMatchObject({ ok: true });
    // Unchanged by the graft, the date included.
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'accepted', ecoRef: null, modifier: null, waitL: null, carrier: null, decidedF: '10/10/2026 10:00' });
    expect((await seen('writer', ID))[0]).toMatchObject({ id, status: 'implemented', ecoRef: ECO, carrier: { letter: 'B', grafted: true } });

    expect(await approve('B')).toBe(true);
    expect((await mine('writer2'))[0]).toMatchObject({ id, status: 'implemented', ecoRef: ECO, modifier: 'writer', carrier: { letter: 'B', grafted: true } });
  });

  it('links to Vigie only when its address is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_VIGIE_URL', '');
    expect(vigieLinkConfigured()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_VIGIE_URL', 'https://vigie.example.org/');
    expect(vigieLinkConfigured()).toBe(true);
    expect(vigieUrl('ECR-2026-004')).toBe('https://vigie.example.org/changements/ECR-2026-004');
  });
});
