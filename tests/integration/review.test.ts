import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { recordReview, updateMeta, updateType } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { approveRevision, promoteDue } from '@/lib/lifecycle';
import { auditDetailL, deadlines, listAudit, listDocs } from '@/lib/queries';
import { addDoc, fixClock, getDoc, getRevision, journalOf, revisionStatuses, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { searchChecked } from '../support/search';
import { actAs } from '../support/session';

// Expiry and periodic review (point 13 of docs/reste-a-faire.md, G36, G37): « Revue effectuée » through its Server
// Action, the periodicity of a type in the register and its use at entry into force, and the indicators « Expiré » and
// « Revue en retard » on what each reader already sees (D-14), without a new status (D-17).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // addDoc: owned by `owner`, revision A in force since 10 September 2026

type Meta = Partial<typeof s.documents.$inferInsert>;

/** A document (revision A in force by default) with these metadata. */
async function doc(meta: Meta = {}, spec: Omit<Parameters<typeof addDoc>[1], 'id'> = {}, id = ID) {
  await addDoc(db(), { id, ...spec });
  if (Object.keys(meta).length) await db().update(s.documents).set(meta).where(eq(s.documents.id, id));
}

function review(who: Person, next: string | null, comment = '', id = ID) {
  actAs(who);
  return recordReview(id, next, comment);
}

/** The review date, the modification date, the revisions and the size of the journal: what a refused review leaves alone. */
async function trace(id = ID) {
  const d = await getDoc(db(), id);
  return { reviewDueAt: d.reviewDueAt, modifiedAt: d.modifiedAt, revisions: await revisionStatuses(db(), id), journal: (await journalOf(db(), id)).length };
}

const setMonths = (code: string, reviewMonths: number | null) => db().update(s.docTypes).set({ reviewMonths }).where(eq(s.docTypes.code, code));

describe('recordReview (« Revue effectuée »)', () => {
  it('the owner sets the next review date: no revision is created, the journal keeps the comment and the dates', async () => {
    await doc({ reviewDueAt: '2026-09-30', processOwnerId: 'writer' });
    expect(await review('owner', '2027-09-30', '  Toujours applicable.  ')).toEqual({ ok: true, message: `${t.review_recorded} 30/09/2027` });
    expect(await trace()).toEqual({ reviewDueAt: '2027-09-30', modifiedAt: '2026-10-10', revisions: { A: 'in_force' }, journal: 1 });
    expect((await journalOf(db(), ID)).at(-1)).toMatchObject({
      userId: 'owner', action: 'reviewed', detail: 'Toujours applicable.', revisionId: null,
      data: { changes: [{ field: 'reviewDueAt', before: '2026-09-30', after: '2027-09-30' }], doc: { conf: 'interne', inForce: true } },
    });
  });

  it('the process owner and a records manager may record it too', async () => {
    await doc({ reviewDueAt: '2026-09-30', processOwnerId: 'writer' });
    expect(await review('writer', '2027-03-31')).toMatchObject({ ok: true });
    expect(await review('manager', '2027-06-30')).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2027-06-30');
    expect((await journalOf(db(), ID)).map((e) => [e.userId, e.action])).toEqual([['writer', 'reviewed'], ['manager', 'reviewed']]);
  });

  it('refuses anyone else who reads the document, an approver included, and writes nothing', async () => {
    await doc({ reviewDueAt: '2026-09-30', processOwnerId: 'writer' });
    const before = await trace();
    for (const who of ['writer2', 'head', 'quality'] as const) expect(await review(who, '2027-09-30'), who).toEqual({ ok: false, error: t.review_reserved });
    expect(await trace()).toEqual(before);
  });

  it('wants the edit permission, even from the owner', async () => {
    await doc({ reviewDueAt: '2026-09-30' });
    actAs('owner', 'auditeur');
    expect(await recordReview(ID, '2027-09-30')).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_edit}` });
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2026-09-30');
  });

  it('answers « not found » on a document the user cannot read, before anything else (D-13)', async () => {
    // writer2 (ING) owns the process of a confidential QUA document he cannot read.
    await doc({ conf: 'confidentiel', processOwnerId: 'writer2', reviewDueAt: '2026-09-30' });
    expect(await review('writer2', '2027-09-30')).toEqual({ ok: false, error: t.not_found });
  });

  it('refuses on a document frozen, archived or obsolete', async () => {
    await doc({}, { legalHold: true }, 'PRO-QUA-0001');
    await doc({}, { state: 'archived' }, 'PRO-QUA-0002');
    await doc({}, { state: 'obsolete' }, 'PRO-QUA-0003');
    expect(await review('owner', '2027-09-30', '', 'PRO-QUA-0001')).toEqual({ ok: false, error: t.locked_hold });
    expect(await review('owner', '2027-09-30', '', 'PRO-QUA-0002')).toEqual({ ok: false, error: t.locked_archived });
    expect(await review('owner', '2027-09-30', '', 'PRO-QUA-0003')).toEqual({ ok: false, error: t.locked_obsolete });
  });

  it('refuses without a revision in force: a draft is reviewed by its approval circuit', async () => {
    await doc({}, { revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect(await review('owner', '2027-09-30')).toEqual({ ok: false, error: t.review_need_in_force });
  });

  it('wants a next date after today, a real day, under the field', async () => {
    await doc({ reviewDueAt: '2026-09-30' });
    const before = await trace();
    expect(await review('owner', '2026-10-10')).toEqual({ ok: false, error: t.review_next_past, field: 'next' });
    expect(await review('owner', '2026-01-01')).toEqual({ ok: false, error: t.review_next_past, field: 'next' });
    expect(await review('owner', '2027-02-30')).toEqual({ ok: false, error: `${t.review_next} : ${t.date_malformed}`, field: 'next' });
    expect(await review('owner', 'x'.repeat(10))).toEqual({ ok: false, error: `${t.review_next} : ${t.date_malformed}`, field: 'next' });
    expect(await trace()).toEqual(before);
    expect(await review('owner', '2026-10-11')).toMatchObject({ ok: true });
  });

  it('without a date entered, counts the type’s periodicity from today; without periodicity, asks for the date', async () => {
    await doc({ reviewDueAt: '2026-09-30' });
    expect(await review('owner', null)).toEqual({ ok: false, error: t.review_next_required, field: 'next' });
    expect(await review('owner', '  ')).toEqual({ ok: false, error: t.review_next_required, field: 'next' });
    await setMonths('PRO', 36);
    expect(await review('owner', null)).toEqual({ ok: true, message: `${t.review_recorded} 10/10/2029` });
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2029-10-10');
  });

  it('keeps a comment of 2,000 characters at most', async () => {
    await doc({ reviewDueAt: '2026-09-30' });
    expect(await review('owner', '2027-09-30', 'x'.repeat(2001))).toEqual({ ok: false, error: t.review_comment_too_long, field: 'comment' });
    expect(await review('owner', '2027-09-30', 'x'.repeat(2000))).toMatchObject({ ok: true });
  });

  it('is read by every reader of the record, values included, even while a revision is being drafted (D-14)', async () => {
    await doc({ reviewDueAt: '2026-09-30' }, { revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    expect(await review('owner', '2027-09-30', 'RAS')).toMatchObject({ ok: true });
    actAs('writer2');
    const ctx = await getCtx();
    const entries = await listAudit(ctx, { docId: ID });
    expect(entries.map((e) => [e.action, e.detail])).toEqual([['reviewed', `RAS · ${t.review_due_at} : 2026-09-30 → 2027-09-30`]]);
    // The record is dated by the review, the last change this reader sees.
    expect((await listDocs(ctx)).find((d) => d.id === ID)).toMatchObject({ modifiedAt: '2026-10-10', revWorking: null });
  });
});

describe('periodicity of a type (Administration › Registre des types)', () => {
  /** The type dialog of PRO as the fixtures set it, with this periodicity. */
  function typeForm(reviewMonths: string) {
    const fd = new FormData();
    fd.set('code', 'PRO');
    for (const k of ['resp_departement', 'resp_qualite']) fd.append('circuit', k);
    for (const c of ['restreint', 'interne', 'confidentiel', 'tres_confidentiel']) fd.append('confAllowed', c);
    fd.set('confDefault', 'interne');
    fd.set('retentionYears', '10');
    fd.set('retentionTrigger', 'superseded');
    fd.set('retentionDisposition', 'destroy');
    fd.set('reviewMonths', reviewMonths);
    return fd;
  }
  const months = async () => (await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO')))[0].reviewMonths;
  const typeJournal = () => db().select().from(s.auditLog).where(and(eq(s.auditLog.targetKind, 'type'), eq(s.auditLog.targetId, 'PRO')));

  it('is empty by default, set in months, refused out of bounds, journaled', async () => {
    expect(await months()).toBeNull();
    actAs('manager');
    expect(await updateType(typeForm('36'))).toMatchObject({ ok: true });
    expect(await months()).toBe(36);
    for (const v of ['0', '241', '12.5', 'trois']) expect(await updateType(typeForm(v)), v).toEqual({ ok: false, error: t.review_months_invalid, field: 'reviewMonths' });
    expect(await months()).toBe(36);
    expect(await updateType(typeForm(''))).toMatchObject({ ok: true });
    expect(await months()).toBeNull();
    const entries = await typeJournal();
    expect(entries.map((e) => e.data?.changes)).toEqual([[{ field: 'reviewMonths', before: null, after: '36' }], [{ field: 'reviewMonths', before: '36', after: null }]]);
    const ctx = await getCtx();
    expect(auditDetailL(ctx, entries[0])).toBe(`${t.review_months} : ${t.review_months_none} → 36 ${t.months_short}`);
  });

  it('is the administrators’ only', async () => {
    actAs('owner');
    expect(await updateType(typeForm('12'))).toEqual({ ok: false, error: t.forbidden });
    expect(await months()).toBeNull();
  });
});

describe('entry into force: the review date from the type’s periodicity', () => {
  /** Revision A in force, B in review: approving B puts it in force today. */
  async function inReview(meta: Meta = {}) {
    await doc(meta, { revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', versions: ['owner'] }] });
    return getRevision(db(), ID, 'B');
  }

  it('sets it when there is none, counted from the entry into force, and journals it for every reader', async () => {
    await setMonths('PRO', 36);
    const rev = await inReview();
    expect(await db().transaction((tx) => approveRevision(tx, rev.id))).toBe(true);
    expect(await getDoc(db(), ID)).toMatchObject({ revInForce: 'B', reviewDueAt: '2029-10-10' });
    expect((await journalOf(db(), ID)).map((e) => [e.userId, e.action, e.revisionId])).toEqual([['codex', 'in_force', rev.id], ['codex', 'review_planned', null]]);
    expect((await journalOf(db(), ID)).at(-1)?.data).toEqual({ changes: [{ field: 'reviewDueAt', before: null, after: '2029-10-10' }], doc: { conf: 'interne', inForce: true } });
  });

  it('counts from the effective date of an approved revision entering into force on it', async () => {
    await setMonths('PRO', 12);
    await doc({}, { revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-10-05', versions: ['owner'] }] });
    await promoteDue(db());
    expect(await getDoc(db(), ID)).toMatchObject({ revInForce: 'B', reviewDueAt: '2027-10-05' });
  });

  it('leaves a review date already set as it is, even past', async () => {
    await setMonths('PRO', 36);
    const rev = await inReview({ reviewDueAt: '2026-09-30' });
    await db().transaction((tx) => approveRevision(tx, rev.id));
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2026-09-30');
    expect((await journalOf(db(), ID)).map((e) => e.action)).toEqual(['in_force']);
  });

  it('is not applied when the metadata empty the date of a document in force: no review until the next revision', async () => {
    // What the metadata dialog says under the date of a document in force (lib/review.ts reviewDueHint).
    await setMonths('PRO', 36);
    const rev = await inReview({ reviewDueAt: '2026-11-30' });
    actAs('owner');
    const fd = new FormData();
    fd.set('docId', ID);
    fd.set('version', (await viewOf(db(), ID)).version);
    fd.set('reviewDueAt', '');
    expect(await updateMeta(fd)).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).reviewDueAt).toBeNull();
    await db().transaction((tx) => approveRevision(tx, rev.id));
    expect((await getDoc(db(), ID)).reviewDueAt).toBe('2029-10-10');
  });

  it('sets nothing without a periodicity (the register leaves them empty, O-05)', async () => {
    const rev = await inReview();
    await db().transaction((tx) => approveRevision(tx, rev.id));
    expect((await getDoc(db(), ID)).reviewDueAt).toBeNull();
    expect((await journalOf(db(), ID)).map((e) => e.action)).toEqual(['in_force']);
  });
});

describe('indicators « Expiré » and « Revue en retard » (no new status, D-17)', () => {
  async function dated() {
    await doc({ expiresAt: '2026-10-01' }, {}, 'PRO-QUA-0001');
    await doc({ reviewDueAt: '2026-09-30' }, {}, 'PRO-QUA-0002');
    await doc({ expiresAt: '2026-10-10', reviewDueAt: '2026-10-10' }, {}, 'PRO-QUA-0003'); // due today: not yet past
    await doc({ expiresAt: '2026-01-01', reviewDueAt: '2026-01-01' }, { state: 'obsolete' }, 'PRO-QUA-0004');
    // A draft never in force: its drafting circle only (D-14).
    await doc({ expiresAt: '2026-01-01' }, { ownerId: 'writer', revisions: [{ letter: 'A', status: 'draft', versions: ['writer'] }] }, 'PRO-QUA-0005');
  }
  async function flags(who: Person) {
    actAs(who);
    return Object.fromEntries((await listDocs(await getCtx())).map((d) => [d.id, [d.expired, d.reviewOverdue, d.status]]));
  }

  it('on the documents the reader sees, as the explorer, the search and the record read them', async () => {
    await dated();
    expect(await flags('writer2')).toEqual({
      'PRO-QUA-0001': [true, false, 'in_force'],
      'PRO-QUA-0002': [false, true, 'in_force'],
      'PRO-QUA-0003': [false, false, 'in_force'],
      'PRO-QUA-0004': [false, false, 'obsolete'],
    });
    expect((await flags('writer'))['PRO-QUA-0005']).toEqual([true, false, 'draft']);
  });

  it('a facet of the search, counted on the documents the reader may read only', async () => {
    await dated();
    actAs('auditor');
    const outside = await searchChecked(await getCtx(), { facets: { overdue: ['expired'] } });
    expect(outside.results.map((d) => d.id)).toEqual(['PRO-QUA-0001']);
    expect(Object.fromEntries(outside.tally('overdue'))).toEqual({ expired: 1, review: 1 });
    actAs('writer');
    const circle = await searchChecked(await getCtx(), { facets: { overdue: ['expired'] } });
    expect(circle.results.map((d) => d.id).sort()).toEqual(['PRO-QUA-0001', 'PRO-QUA-0005']);
  });

  it('the deadlines of Archivage and « À traiter » say the same, with the words of the record', async () => {
    await dated();
    actAs('manager');
    const ctx = await getCtx();
    const due = deadlines(ctx, await listDocs(ctx)).filter((x) => x.kind !== 'retention').map((x) => [x.id, x.kind, x.overdue, x.dueL]);
    expect(due).toEqual([
      ['PRO-QUA-0005', 'expiry', true, t.dl_expired],
      ['PRO-QUA-0002', 'review', true, t.dl_review_late],
      ['PRO-QUA-0001', 'expiry', true, t.dl_expired],
      ['PRO-QUA-0003', 'expiry', false, t.dl_expiry],
      ['PRO-QUA-0003', 'review', false, t.dl_review],
    ]);
  });
});
