import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDb, schema as s, type Db } from '@/db';
import { seed } from '@/db/seed';
import { createDocument, decideStep, requestValidation, updateMeta } from '@/lib/actions';
import { COOKIE_LANG } from '@/lib/context';
import { dateIssues, effectIssue, issueFrom, latestEffect } from '@/lib/dates';
import { todayIso } from '@/lib/format';
import { DICT } from '@/lib/i18n';
import { importDocument } from '@/lib/importer';
import { addDoc, fixClock, getDoc, getRevision, journalOf, revisionStatuses, setClock, setupDb } from '../support/db';
import { actAs, cookieStore } from '../support/session';

// Dates of a document (point 3 of docs/reste-a-faire.md; docs/audit-deck-epc2i.md §4.6, rule 12: issue ≤ effect ≤
// expiry): real calendar days whatever a Server Action is sent, then expiry after the issue and after the revision's
// effective date, review after the issue, reception neither in the future nor after the issue. A document not issued
// yet will be on the day its first revision takes effect, today at the earliest. The metadata form, the request for
// approval and the import refuse what breaks them, write nothing, and say which date to correct.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // addDoc: revision A in force, issued and in force on 10 September 2026

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** The owner submits the metadata form of the document with these fields. */
function edit(fields: Record<string, string>, id = ID) {
  actAs('owner');
  return updateMeta(form({ docId: id, ...fields }));
}

/** The document's dates and its journal entries, to show that a refused edit wrote nothing. */
async function trace(id = ID) {
  const d = await getDoc(db(), id);
  return { dates: [d.reviewDueAt, d.expiresAt, d.receivedAt, d.modifiedAt], journal: (await journalOf(db(), id)).length };
}

describe('updateMeta and createDocument: format of the dates', () => {
  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['text', 'demain'],
    ['a timestamp', '2026-11-30T08:00:00Z'],
    ['a day written the French way', '30/11/2026'],
    ['the year 0000, which Postgres has no day for', '0000-01-01'],
  ])('refuses %s with a translated message on its field, instead of a database error, and writes nothing', async (_, value) => {
    await addDoc(db(), { id: ID, typeCode: 'COR' });
    const before = await trace();
    for (const [field, label] of [['expiresAt', t.expires_at], ['reviewDueAt', t.review_due_at]] as const) {
      expect(await edit({ [field]: value })).toEqual({ ok: false, error: `${label} : ${t.date_malformed}`, field });
    }
    // The received date of an external document.
    expect(await edit({ origin: 'externe', sourceOrg: 'Nordvolt', receivedAt: value })).toEqual({ ok: false, error: `${t.received_at} : ${t.date_malformed}`, field: 'receivedAt' });
    expect(await trace()).toEqual(before);
  });

  it('refuses a malformed date at creation, and creates nothing', async () => {
    actAs('owner');
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', expiresAt: '2026-13-01' }))).toEqual({ ok: false, error: `${t.expires_at} : ${t.date_malformed}`, field: 'expiresAt' });
    expect(await createDocument(form({ title: 'Procédure', typeCode: 'PRO', expiresAt: '0000-01-01' }))).toEqual({ ok: false, error: `${t.expires_at} : ${t.date_malformed}`, field: 'expiresAt' });
    expect(await createDocument(form({ title: 'Courrier', typeCode: 'COR', origin: 'externe', sourceOrg: 'Nordvolt', receivedAt: '0000-01-01' }))).toEqual({ ok: false, error: `${t.received_at} : ${t.date_malformed}`, field: 'receivedAt' });
    expect(await db().select().from(s.documents)).toEqual([]);
  });
});

describe('updateMeta: coherence with the issue and the effective date', () => {
  it('wants the expiry after the issue date, the same day being too early', async () => {
    await addDoc(db(), { id: ID });
    const before = await trace();
    const refused = { ok: false, error: t.expires_before_issued.replace('{date}', '10/09/2026'), field: 'expiresAt' };
    expect(await edit({ expiresAt: '2026-09-01' })).toEqual(refused);
    expect(await edit({ expiresAt: '2026-09-10' })).toEqual(refused);
    expect(await trace()).toEqual(before);
    expect(await edit({ expiresAt: '2026-09-11' })).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).expiresAt).toBe('2026-09-11');
  });

  it('wants the expiry after the effective date of a revision approved or in review, which the error names', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'approved', effectiveAt: '2026-11-15', versions: ['writer'] }] });
    const before = await trace();
    expect(await edit({ expiresAt: '2026-11-15' })).toEqual({ ok: false, error: t.expires_before_effective.replace('{rev}', 'B').replace('{date}', '15/11/2026'), field: 'expiresAt' });
    expect(await trace()).toEqual(before);
    expect(await edit({ expiresAt: '2026-11-16' })).toMatchObject({ ok: true });
  });

  it('ignores the effective date a rejected circuit left on a revision back in drafting', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', effectiveAt: '2026-11-15', versions: ['writer'] }] });
    expect(await edit({ expiresAt: '2026-11-01' })).toMatchObject({ ok: true });
  });

  it('wants the review after the issue date', async () => {
    await addDoc(db(), { id: ID });
    expect(await edit({ reviewDueAt: '2026-09-10' })).toEqual({ ok: false, error: t.review_before_issued.replace('{date}', '10/09/2026'), field: 'reviewDueAt' });
    expect(await edit({ reviewDueAt: '2027-09-10', expiresAt: '2028-09-10' })).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ reviewDueAt: '2027-09-10', expiresAt: '2028-09-10' });
  });

  it('wants the reception of an external document neither in the future nor after the issue date', async () => {
    await addDoc(db(), { id: ID, typeCode: 'COR' });
    const external = (receivedAt: string) => edit({ origin: 'externe', sourceOrg: 'Nordvolt', receivedAt });
    const before = await trace();
    expect(await external('2026-10-11')).toEqual({ ok: false, error: t.received_in_future, field: 'receivedAt' });
    expect(await external('2026-09-11')).toEqual({ ok: false, error: t.received_after_issued.replace('{date}', '10/09/2026'), field: 'receivedAt' });
    expect(await trace()).toEqual(before);
    expect(await external('2026-09-10')).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ origin: 'externe', receivedAt: '2026-09-10' });
  });

  it('refuses a reception in the future at creation, before the document is ever issued', async () => {
    actAs('owner');
    const create = (receivedAt: string) => createDocument(form({ title: 'Courrier', typeCode: 'COR', origin: 'externe', sourceOrg: 'Nordvolt', receivedAt }));
    expect(await create('2026-10-11')).toEqual({ ok: false, error: t.received_in_future, field: 'receivedAt' });
    expect(await db().select().from(s.documents)).toEqual([]);
    expect(await create('2026-10-10')).toMatchObject({ ok: true });
  });

  it('wants a document not issued yet to expire, and to be reviewed, after today, the day it can be issued at the earliest', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] });
    const before = await trace();
    expect(await edit({ expiresAt: '2026-10-10' })).toEqual({ ok: false, error: t.expires_before_first_issue.replace('{date}', '10/10/2026'), field: 'expiresAt' });
    expect(await edit({ reviewDueAt: '2026-01-01' })).toEqual({ ok: false, error: t.review_before_first_issue.replace('{date}', '10/10/2026'), field: 'reviewDueAt' });
    expect(await trace()).toEqual(before);
    expect(await edit({ expiresAt: '2026-10-11', reviewDueAt: '2026-10-11' })).toMatchObject({ ok: true });
  });

  it('wants a document not issued yet to expire, and to be reviewed, after the effective date of the revision that will issue it', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_review', effectiveAt: '2026-11-02', versions: ['writer'] }] });
    expect(await edit({ reviewDueAt: '2026-11-02' })).toEqual({ ok: false, error: t.review_before_first_issue.replace('{date}', '02/11/2026'), field: 'reviewDueAt' });
    expect(await edit({ expiresAt: '2026-11-02' })).toEqual({ ok: false, error: t.expires_before_effective.replace('{rev}', 'A').replace('{date}', '02/11/2026'), field: 'expiresAt' });
    expect(await edit({ expiresAt: '2026-11-03', reviewDueAt: '2026-11-03' })).toMatchObject({ ok: true });
  });

  it('wants an expiry entered during a review without effective date after today: the revision takes effect at its approval', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['writer'] }] });
    await db().update(s.documents).set({ expiresAt: '2027-01-01' }).where(eq(s.documents.id, ID));
    const before = await trace();
    const refused = { ok: false, error: t.expires_before_approval.replace('{rev}', 'B').replace('{date}', '10/10/2026'), field: 'expiresAt' };
    expect(await edit({ expiresAt: '2026-10-05' })).toEqual(refused);
    expect(await edit({ expiresAt: '2026-10-10' })).toEqual(refused);
    expect(await trace()).toEqual(before);
    expect(await edit({ expiresAt: '2026-10-11' })).toMatchObject({ ok: true });
  });

  it('does not hold a date left as it is to what time alone has broken: an expired document under renewal keeps its expiry', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'in_review', versions: ['writer'] }] });
    await db().update(s.documents).set({ expiresAt: '2026-09-30', reviewDueAt: '2026-09-30' }).where(eq(s.documents.id, ID));
    expect(await edit({ title: 'Procédure renommée', expiresAt: '2026-09-30', reviewDueAt: '2026-09-30' })).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ title: 'Procédure renommée', expiresAt: '2026-09-30' });
    // Changed, it is held to the approval of B.
    expect(await edit({ expiresAt: '2026-10-01', reviewDueAt: '2026-09-30' })).toMatchObject({ ok: false, field: 'expiresAt' });
  });

  it('refuses, at creation, an expiry or a review on or before today: the document is issued today at the earliest', async () => {
    actAs('owner');
    const create = (dates: Record<string, string>) => createDocument(form({ title: 'Procédure', typeCode: 'PRO', ...dates }));
    expect(await create({ expiresAt: '2020-06-01' })).toEqual({ ok: false, error: t.expires_before_first_issue.replace('{date}', '10/10/2026'), field: 'expiresAt' });
    expect(await create({ reviewDueAt: '2026-10-10' })).toEqual({ ok: false, error: t.review_before_first_issue.replace('{date}', '10/10/2026'), field: 'reviewDueAt' });
    expect(await db().select().from(s.documents)).toEqual([]);
    expect(await create({ reviewDueAt: '2026-10-11', expiresAt: '2026-10-11' })).toMatchObject({ ok: true });
  });

  it('answers in the language of the interface', async () => {
    await addDoc(db(), { id: ID });
    actAs('owner');
    (await cookieStore()).set(COOKIE_LANG, 'en');
    expect(await updateMeta(form({ docId: ID, expiresAt: '2026-09-01' }))).toEqual({ ok: false, error: 'The expiry date must be after the document’s issue date (10 Sep 2026): choose a later date.', field: 'expiresAt' });
  });
});

describe('requestValidation: the revision takes effect before the document expires', () => {
  /** Revision A in force, B drafted by the writer; the document expires on `expiresAt`. */
  async function drafted(expiresAt: string) {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['writer'] }] });
    await db().update(s.documents).set({ expiresAt }).where(eq(s.documents.id, ID));
  }
  const request = (effectiveAt: string | null) => {
    actAs('owner');
    return requestValidation(ID, effectiveAt);
  };
  const nothingWritten = async () => {
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect(await db().select().from(s.workflows)).toEqual([]);
  };

  it.each([['the expiry day', '2026-12-01'], ['a later day', '2027-01-15']])('refuses %s as effective date, and writes nothing', async (_, date) => {
    await drafted('2026-12-01');
    expect(await request(date)).toEqual({ ok: false, error: t.effective_after_expiry.replace('{date}', '01/12/2026'), field: 'effectiveAt' });
    await nothingWritten();
  });

  it('accepts an effective date before the expiry', async () => {
    await drafted('2026-12-01');
    expect(await request('2026-11-30')).toEqual({ ok: true, href: '/validations?f=requested&r=W-1' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'in_review' });
  });

  it('without an effective date, accepts a document that expires later', async () => {
    await drafted('2026-10-11');
    expect(await request(null)).toMatchObject({ ok: true });
  });

  it('without an effective date, accepts the renewal of an expired document: its expiry is moved once the new revision is in force', async () => {
    await drafted('2026-09-30');
    expect(await request(null)).toMatchObject({ ok: true });
    // During the circuit, readers still see the expiry of A; a change of title keeps it.
    expect(await edit({ title: 'Certificat', expiresAt: '2026-09-30' })).toMatchObject({ ok: true });
    actAs('head');
    expect(await decideStep('W-1', true, 1)).toEqual({ ok: true });
    actAs('quality');
    expect(await decideStep('W-1', true, 2)).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    // B in force today, after the expiry: the metadata dialog asks for it to be moved.
    expect(await edit({ title: 'Certificat', expiresAt: '2026-09-30' })).toEqual({ ok: false, error: t.expires_before_effective.replace('{rev}', 'B').replace('{date}', '10/10/2026'), field: 'expiresAt' });
    expect(await edit({ title: 'Certificat', expiresAt: '2027-09-30' })).toMatchObject({ ok: true });
  });

  it('says to the author of the revision, who may not edit the metadata, who can move the expiry', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', versions: ['writer'] }] });
    await db().update(s.documents).set({ expiresAt: '2026-12-01' }).where(eq(s.documents.id, ID));
    actAs('writer');
    const res = await requestValidation(ID, '2026-12-15');
    expect(res).toEqual({ ok: false, error: t.effective_after_expiry.replace('{date}', '01/12/2026'), field: 'effectiveAt' });
    expect(t.effective_after_expiry).toContain('par le propriétaire du document ou un gestionnaire documentaire');
    expect(await updateMeta(form({ docId: ID, expiresAt: '2027-12-01' }))).toMatchObject({ ok: false });
  });
});

describe('requestValidation: a document not issued yet is issued by this revision, and expires and is reviewed after', () => {
  const COR = 'COR-QUA-0001'; // no approval step: in force as soon as requested, by someone who may publish
  async function drafted(dates: { expiresAt?: string; reviewDueAt?: string }) {
    await addDoc(db(), { id: COR, typeCode: 'COR', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    if (Object.keys(dates).length) await db().update(s.documents).set(dates).where(eq(s.documents.id, COR));
  }
  const request = (effectiveAt: string | null) => {
    actAs('manager');
    return requestValidation(COR, effectiveAt);
  };
  const nothingWritten = async () => {
    expect(await revisionStatuses(db(), COR)).toEqual({ A: 'draft' });
    expect(await db().select().from(s.workflows)).toEqual([]);
  };

  it('refuses an effective date on or after the review date, and says the issue would follow it', async () => {
    await drafted({ reviewDueAt: '2026-11-01' });
    expect(await request('2026-12-01')).toEqual({ ok: false, error: t.effective_after_review.replace('{date}', '01/11/2026'), field: 'effectiveAt' });
    expect(await request('2026-11-01')).toMatchObject({ ok: false, field: 'effectiveAt' });
    await nothingWritten();
    expect(await request('2026-10-31')).toMatchObject({ ok: true });
    expect(await getRevision(db(), COR, 'A')).toMatchObject({ status: 'approved', effectiveAt: '2026-10-31' });
  });

  it('without an effective date, refuses a review or an expiry on or before today, when the revision is approved at the earliest', async () => {
    await drafted({ reviewDueAt: '2026-10-10' });
    expect(await request(null)).toEqual({ ok: false, error: t.approval_after_review.replace('{date}', '10/10/2026'), field: 'effectiveAt' });
    await db().update(s.documents).set({ reviewDueAt: null, expiresAt: '2026-10-01' }).where(eq(s.documents.id, COR));
    expect(await request(null)).toEqual({ ok: false, error: t.approval_after_expiry.replace('{date}', '01/10/2026'), field: 'effectiveAt' });
    await nothingWritten();
  });

  it('from creation to entry into force, never leaves the review before the issue', async () => {
    await drafted({});
    // The owner sets the review date; the request with a later effective date is refused, an earlier one is accepted.
    expect(await edit({ reviewDueAt: '2026-11-01' }, COR)).toMatchObject({ ok: true });
    expect(await request('2026-12-01')).toMatchObject({ ok: false, field: 'effectiveAt' });
    expect(await request(null)).toMatchObject({ ok: true });
    expect(await getDoc(db(), COR)).toMatchObject({ issuedAt: '2026-10-10', reviewDueAt: '2026-11-01' });
    // Issued before its review: a later edit is accepted.
    setClock('2026-10-20T08:00:00Z');
    expect(await edit({ title: 'Courrier', reviewDueAt: '2026-11-01' }, COR)).toMatchObject({ ok: true });
  });
});

describe('importDocument: coherence of the dates (docs/api.md)', () => {
  const meta = (legacyRef: string, over: Record<string, unknown> = {}) => ({ legacyRef, title: `Doc ${legacyRef}`, typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12', ...over });
  const external = { typeCode: 'COR', origin: 'externe', sourceOrg: 'Nordvolt' };

  /** field → code of every issue of a refused import, which created nothing. */
  async function refused(raw: unknown) {
    const res = await importDocument(raw, null);
    if (res.kind !== 'invalid') throw new Error(`expected a refusal, got ${res.kind}`);
    expect(await db().select().from(s.documents)).toEqual([]);
    for (const i of res.issues) expect(i.message, i.code).not.toMatch(/[{}]/);
    return Object.fromEntries(res.issues.map((i) => [i.field, i.code]));
  }

  it('wants the expiry after the issue date and after the revision’s entry into force', async () => {
    expect(await refused(meta('L-1', { issuedAt: '2023-01-10', expiresAt: '2023-01-10' }))).toEqual({ expiresAt: 'expires_before_issued' });
    expect(await refused(meta('L-1', { issuedAt: '2023-01-10', expiresAt: '2025-03-12' }))).toEqual({ expiresAt: 'expires_before_effective' });
    const res = await importDocument(meta('L-1', { issuedAt: '2023-01-10', expiresAt: '2024-01-01' }), null);
    expect(res).toMatchObject({ kind: 'invalid', issues: [{ field: 'expiresAt', code: 'expires_before_effective', message: t.expires_before_effective.replace('{rev}', 'C').replace('{date}', '12/03/2025') }] });
  });

  it('checks the dates as they will be recorded: the issue date defaults to the entry into force, then to the day of the import', async () => {
    expect(await refused(meta('L-1', { expiresAt: '2025-03-12' }))).toEqual({ expiresAt: 'expires_before_issued' });
    expect(await refused(meta('L-1', { inForceAt: undefined, expiresAt: '2026-10-10' }))).toEqual({ expiresAt: 'expires_before_issued' });
    // A date still to come: approved until then, never issued yet, its effective date bounds the expiry.
    expect(await refused(meta('L-1', { inForceAt: '2026-10-15', expiresAt: '2026-10-15' }))).toEqual({ expiresAt: 'expires_before_effective' });
  });

  it('wants the revision in force on the issue date at the earliest', async () => {
    expect(await refused(meta('L-1', { issuedAt: '2025-04-01' }))).toEqual({ inForceAt: 'effective_before_issued' });
  });

  it('wants the review after the issue date', async () => {
    expect(await refused(meta('L-1', { issuedAt: '2023-01-10', reviewDueAt: '2023-01-10' }))).toEqual({ reviewDueAt: 'review_before_issued' });
  });

  it('wants the reception neither in the future nor after the issue date', async () => {
    expect(await refused(meta('L-1', { ...external, issuedAt: '2025-03-01', receivedAt: '2026-10-11' }))).toEqual({ receivedAt: 'received_in_future' });
    expect(await refused(meta('L-1', { ...external, issuedAt: '2025-03-01', receivedAt: '2025-03-02' }))).toEqual({ receivedAt: 'received_after_issued' });
  });

  it('wants a document not issued yet reviewed after its entry into force still to come, or after today for a draft', async () => {
    expect(await refused(meta('L-1', { inForceAt: '2026-12-01', reviewDueAt: '2026-11-01' }))).toEqual({ reviewDueAt: 'review_before_first_issue' });
    expect(await refused(meta('L-1', { status: 'draft', inForceAt: undefined, reviewDueAt: '2026-01-01', expiresAt: '2026-10-10' }))).toEqual({ reviewDueAt: 'review_before_first_issue', expiresAt: 'expires_before_first_issue' });
    expect(await importDocument(meta('L-1', { inForceAt: '2026-12-01', reviewDueAt: '2026-12-02', expiresAt: '2027-12-01' }), null)).toMatchObject({ kind: 'created' });
  });

  it('refuses the year 0000 as an invalid date, instead of a database error', async () => {
    expect(await refused(meta('L-1', { ...external, issuedAt: '2020-01-01', receivedAt: '0000-01-01' }))).toEqual({ receivedAt: 'invalid_date' });
  });

  it('reports every issue at once, the format ones with the others', async () => {
    expect(await refused(meta('L-1', { issuedAt: '2023-01-10', expiresAt: '2026-02-30', reviewDueAt: '2022-12-01' }))).toEqual({ expiresAt: 'invalid_date', reviewDueAt: 'review_before_issued' });
  });

  it('imports coherent dates as given', async () => {
    const res = await importDocument(meta('L-1', { ...external, issuedAt: '2023-01-10', receivedAt: '2023-01-10', reviewDueAt: '2027-03-12', expiresAt: '2028-03-12' }), null);
    expect(res).toMatchObject({ kind: 'created', id: 'COR-QUA-0001' });
    expect(await getDoc(db(), 'COR-QUA-0001')).toMatchObject({ issuedAt: '2023-01-10', receivedAt: '2023-01-10', reviewDueAt: '2027-03-12', expiresAt: '2028-03-12' });
  });
});

describe('demo data (src/db/seed.ts)', () => {
  let demo: Db;
  beforeAll(async () => {
    demo = await openDb();
    await seed(demo);
  });
  afterAll(async () => {
    await demo.$client.close();
  });

  it('keeps every document’s dates coherent, and lets every draft be sent for approval', async () => {
    const today = todayIso();
    const docs = await demo.select().from(s.documents).orderBy(asc(s.documents.id));
    const revs = await demo.select().from(s.revisions);
    expect(docs.length).toBeGreaterThan(50);
    const issues = docs.flatMap((d) => {
      const own = revs.filter((r) => r.docId === d.id);
      const ahead = latestEffect(own, today);
      const found = [
        ...dateIssues({ ...d, effective: latestEffect(own) }, today),
        ...dateIssues({ ...d, issueFrom: issueFrom(d.issuedAt, ahead, today), effective: ahead }, today),
      ].map((i) => `${d.id} ${i.rule}`);
      const late = own.some((r) => r.status === 'draft') ? effectIssue(d, null, today) : null;
      return late ? [...found, `${d.id} ${late.rule}`] : found;
    });
    expect(issues).toEqual([]);
  });
});
