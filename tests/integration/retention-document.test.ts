import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { setRetentionClass, setRetentionEvent, updateMeta, updateType } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { deadlines, listAudit, listDocs, METADATA_ACTIONS, retentionByType } from '@/lib/queries';
import { addDoc, fixClock, getDoc, journalOf, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Points 7 and 18 of docs/reste-a-faire.md (D-20, docs/modele-cible.md §8). The date of an event Codex cannot know (end
// of life of the asset, departure of the employee) is entered on the record by its owner or a records manager and the
// end of retention, the deadlines and Archivage follow it; the end of a project stays unknown (Keystone, O-03). A records
// manager sets a document's class, a derogation the type's rule then leaves as it is; a change of the type's rule is
// applied, when asked, to the documents that follow it. Nothing is ever archived or destroyed by these (O-07).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 2026-10-10

const t = DICT.fr;
const ID = 'PRO-QUA-0001';

/** A document of type PRO whose retention counts from `trigger`, `years` after it. */
async function withTrigger(trigger: 'asset_life' | 'employee_departure' | 'project_end' | 'superseded', years: number | null, spec: Partial<Parameters<typeof addDoc>[1]> = {}) {
  await addDoc(db(), { id: ID, ...spec });
  await db().update(s.documents).set({ retentionTrigger: trigger, retentionYears: years }).where(eq(s.documents.id, spec.id ?? ID));
}

async function setEvent(who: Person, date: string | null, id = ID) {
  actAs(who);
  return setRetentionEvent(id, date, Number((await viewOf(db(), id)).version));
}

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

async function setClass(who: Person, fields: Record<string, string>, id = ID) {
  actAs(who);
  return setRetentionClass(form({ docId: id, version: (await viewOf(db(), id)).version, ...fields }));
}

/** The record as `who` reads it (docView). */
async function viewAs(who: Person, id = ID) {
  actAs(who);
  return (await listDocs(await getCtx())).find((d) => d.id === id);
}

/** The type dialog of PRO as it stands, with `over`. */
async function typeForm(over: Record<string, string | string[]> = {}) {
  const [x] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO'));
  return form({
    original: 'PRO', code: 'PRO', labelFr: x.labelFr, labelEn: x.labelEn, family: x.family, origins: x.origins, attachments: x.attachments, circuit: x.circuit,
    confAllowed: x.confAllowed, confDefault: x.confDefault, retentionYears: String(x.retentionYears ?? ''), retentionTrigger: x.retentionTrigger,
    retentionDisposition: x.retentionDisposition, reviewMonths: '', ...over,
  });
}

const classOf = async (id: string) => {
  const d = await getDoc(db(), id);
  return { years: d.retentionYears, trigger: d.retentionTrigger, disposition: d.retentionDisposition, override: d.retentionOverride };
};

describe('date of the trigger event (asset life, employee departure)', () => {
  it('entered by the owner, it gives the end of retention, which falls due in Archivage; nothing is archived', async () => {
    await withTrigger('employee_departure', 5);
    expect((await viewAs('owner'))).toMatchObject({ retainUntil: null, untilF: t.until_event_missing, eventTrigger: true });
    expect(await setEvent('owner', '2021-11-02')).toMatchObject({ ok: true });
    const d = await getDoc(db(), ID);
    expect(d).toMatchObject({ retentionEventAt: '2021-11-02', state: 'active', archivedAt: null });
    const view = await viewAs('manager');
    expect(view?.retainUntil).toBe('2026-11-02');
    // Within 90 days: the end of retention is a deadline of Archivage, with the action the class proposes.
    const due = deadlines(await getCtx(), (await listDocs(await getCtx())));
    expect(due.filter((x) => x.id === ID).map((x) => [x.kind, x.end, x.action])).toEqual([['retention', '2026-11-02', 'destroy']]);
    // Journaled, before → after, in the record's metadata history.
    const [e] = (await journalOf(db(), ID)).filter((x) => x.action === 'retention_event');
    expect(e.data?.changes).toEqual([{ field: 'retentionEventAt', before: null, after: '2021-11-02' }]);
    actAs('auditor');
    const metadata = new Set<string>(METADATA_ACTIONS);
    const history = (await listAudit(await getCtx(), { docId: ID, consultations: 'without' })).filter((x) => metadata.has(x.action));
    expect(history.map((x) => x.detail)).toEqual([expect.stringContaining('2021-11-02')]);
  });

  it('asset life without a duration (O-07): the date is kept, the end stays to be set', async () => {
    await withTrigger('asset_life', null);
    expect(await setEvent('owner', '2026-01-15')).toMatchObject({ ok: true });
    expect(await viewAs('owner')).toMatchObject({ retainUntil: null, untilF: t.until_no_duration, retentionEventAt: '2026-01-15' });
    // A records manager may give this document a duration: the end follows the date entered.
    expect(await setClass('manager', { retentionYears: '0', retentionTrigger: 'asset_life', retentionDisposition: 'review' })).toMatchObject({ ok: true });
    expect((await viewAs('manager'))?.retainUntil).toBe('2026-01-15');
  });

  it('is a real day no later than today, and only for a trigger that waits for one; it may be cleared', async () => {
    await withTrigger('asset_life', 10);
    expect(await setEvent('owner', '2026-10-11')).toEqual({ ok: false, error: t.retention_event_future, field: 'eventAt' });
    expect(await setEvent('owner', '2026-02-30')).toEqual({ ok: false, error: t.retention_event_invalid, field: 'eventAt' });
    expect(await setEvent('owner', '1899-12-31')).toEqual({ ok: false, error: t.retention_event_invalid, field: 'eventAt' });
    expect(await setEvent('owner', '2026-10-10')).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).retentionEventAt).toBe('2026-10-10');
    // The trigger changes (records manager): a date can no longer be entered, the one left may still be cleared.
    await db().update(s.documents).set({ retentionTrigger: 'superseded' }).where(eq(s.documents.id, ID));
    expect(await setEvent('owner', '2026-10-01')).toEqual({ ok: false, error: t.retention_event_not_needed });
    expect(await setEvent('owner', null)).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).retentionEventAt).toBeNull();
  });

  it('the end of a project is not entered: it waits for Keystone (O-03)', async () => {
    await withTrigger('project_end', 5);
    expect(await setEvent('owner', '2026-01-15')).toEqual({ ok: false, error: t.retention_event_not_needed });
    expect(await viewAs('owner')).toMatchObject({ retainUntil: null, eventTrigger: false, untilF: '—' });
  });

  it('by the owner of an editable record or a records manager, never on a frozen one', async () => {
    await withTrigger('asset_life', 10, { ownerId: 'owner' });
    expect(await setEvent('writer', '2026-01-15')).toEqual({ ok: false, error: t.not_allowed });
    expect(await setEvent('manager', '2026-01-15')).toMatchObject({ ok: true });
    // Archived: the owner may no longer edit the record, a records manager still enters the date.
    await db().update(s.documents).set({ state: 'archived', archivedAt: '2026-10-01' }).where(eq(s.documents.id, ID));
    expect(await setEvent('owner', '2026-02-01')).toEqual({ ok: false, error: t.locked_archived });
    expect(await setEvent('manager', '2026-02-01')).toMatchObject({ ok: true });
    expect((await getDoc(db(), ID)).state).toBe('archived');
    await db().update(s.documents).set({ legalHold: true, legalHoldAt: '2026-10-05' }).where(eq(s.documents.id, ID));
    expect(await setEvent('manager', '2026-03-01')).toEqual({ ok: false, error: t.locked_hold });
    expect((await getDoc(db(), ID)).retentionEventAt).toBe('2026-02-01');
  });

  it('refuses an outdated view', async () => {
    await withTrigger('asset_life', 10);
    actAs('owner');
    const r = await setRetentionEvent(ID, '2026-01-15', 99);
    expect(r).toMatchObject({ ok: false, stale: true });
    expect((await getDoc(db(), ID)).retentionEventAt).toBeNull();
  });
});

describe('retention class of one document', () => {
  it('a records manager sets a derogation, journaled with the type rule; putting the type rule back ends it', async () => {
    await addDoc(db(), { id: ID });
    expect(await setClass('manager', { retentionYears: '30', retentionTrigger: 'creation', retentionDisposition: 'archive' })).toMatchObject({ ok: true });
    expect(await classOf(ID)).toEqual({ years: 30, trigger: 'creation', disposition: 'archive', override: true });
    const [e] = (await journalOf(db(), ID)).filter((x) => x.action === 'retention');
    expect(e.data?.changes).toEqual([
      { field: 'retention', before: { years: 10, trigger: 'superseded', disposition: 'destroy' }, after: { years: 30, trigger: 'creation', disposition: 'archive' } },
      { field: 'retentionOverride', before: false, after: true },
      { field: 'typeRetention', after: { years: 10, trigger: 'superseded', disposition: 'destroy' } },
    ]);
    expect((await viewAs('manager'))?.retainUntil).toBe('2056-09-01');
    expect(await setClass('manager', { mode: 'type' })).toMatchObject({ ok: true });
    expect(await classOf(ID)).toEqual({ years: 10, trigger: 'superseded', disposition: 'destroy', override: false });
  });

  it('the type rule itself entered by hand is no derogation', async () => {
    await addDoc(db(), { id: ID });
    expect(await setClass('manager', { retentionYears: '10', retentionTrigger: 'superseded', retentionDisposition: 'destroy' })).toMatchObject({ ok: true });
    expect(await classOf(ID)).toMatchObject({ override: false });
    expect((await journalOf(db(), ID)).filter((x) => x.action === 'retention')).toEqual([]);
  });

  it('reserved to the archive permission; refused under legal hold, on an outdated view, with an invalid duration', async () => {
    await addDoc(db(), { id: ID });
    const rule = { retentionYears: '3', retentionTrigger: 'creation', retentionDisposition: 'destroy' };
    expect(await setClass('owner', rule)).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_archive}` });
    expect(await setClass('head', rule)).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_archive}` });
    expect(await setClass('manager', { ...rule, retentionYears: '201' })).toEqual({ ok: false, error: t.reg_years_invalid, field: 'retentionYears' });
    actAs('manager');
    expect(await setRetentionClass(form({ docId: ID, version: '99', ...rule }))).toMatchObject({ ok: false, stale: true });
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, ID));
    expect(await setClass('manager', rule)).toEqual({ ok: false, error: t.locked_hold });
    expect(await classOf(ID)).toEqual({ years: 10, trigger: 'superseded', disposition: 'destroy', override: false });
  });

  it('a change of type brings the new type rule and ends the derogation', async () => {
    await addDoc(db(), { id: ID });
    await setClass('manager', { retentionYears: '30', retentionTrigger: 'creation', retentionDisposition: 'archive' });
    await db().update(s.docTypes).set({ retentionYears: 2, retentionTrigger: 'creation' }).where(eq(s.docTypes.code, 'COR'));
    actAs('manager');
    expect(await updateMeta(form({ docId: ID, version: (await viewOf(db(), ID)).version, typeCode: 'COR' }))).toMatchObject({ ok: true });
    expect(await classOf(ID)).toEqual({ years: 2, trigger: 'creation', disposition: 'destroy', override: false });
  });
});

describe('a change of the type rule, applied to its documents', () => {
  const NEW_RULE = { retentionYears: '25', retentionTrigger: 'in_force', retentionDisposition: 'archive' };

  async function three() {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    await addDoc(db(), { id: 'PRO-QUA-0003', legalHold: true });
    await addDoc(db(), { id: 'FRM-QMS-001', typeCode: 'FRM' });
    await setClass('manager', { retentionYears: '30', retentionTrigger: 'creation', retentionDisposition: 'archive' }, 'PRO-QUA-0002');
  }

  it('previews how many documents follow the rule, how many derogate, how many are frozen', async () => {
    await three();
    const pro = (await retentionByType()).get('PRO');
    expect(pro?.overrides).toBe(1);
    expect(pro?.following.map((g) => [g.retentionYears, g.held, g.n]).sort()).toEqual([[10, false, 1], [10, true, 1]]);
  });

  it('not applied unless asked: the documents keep their class', async () => {
    await three();
    actAs('manager');
    expect(await updateType(await typeForm(NEW_RULE))).toEqual({ ok: true, message: t.saved_ok });
    expect(await classOf('PRO-QUA-0001')).toEqual({ years: 10, trigger: 'superseded', disposition: 'destroy', override: false });
    expect((await viewAs('manager', 'PRO-QUA-0001'))?.retentionOverride).toBe(false);
  });

  it('applied when asked: to those that follow it, not to derogations, frozen documents or other types; journaled', async () => {
    await three();
    actAs('manager');
    const r = await updateType(await typeForm({ ...NEW_RULE, applyRetention: 'on' }));
    expect(r).toEqual({ ok: true, message: `${t.saved_ok} · ${t.retention_applied.replace('{n}', '1')} · ${t.retention_overrides_kept.replace('{n}', '1')} · ${t.retention_held_kept.replace('{n}', '1')}` });
    expect(await classOf('PRO-QUA-0001')).toEqual({ years: 25, trigger: 'in_force', disposition: 'archive', override: false });
    expect(await classOf('PRO-QUA-0002')).toEqual({ years: 30, trigger: 'creation', disposition: 'archive', override: true });
    expect(await classOf('PRO-QUA-0003')).toEqual({ years: 10, trigger: 'superseded', disposition: 'destroy', override: false });
    expect(await classOf('FRM-QMS-001')).toEqual({ years: 10, trigger: 'superseded', disposition: 'destroy', override: false });
    // Retention counted per document from its entry into force (§8): its revisions follow it.
    expect((await viewAs('manager', 'PRO-QUA-0001'))?.retainUntil).toBe('2051-09-10');
    // Nothing archived or destroyed.
    expect((await db().select().from(s.documents)).map((d) => d.state)).toEqual(['active', 'active', 'active', 'active']);
    const [e] = (await journalOf(db(), 'PRO-QUA-0001')).filter((x) => x.action === 'retention_type');
    expect(e).toMatchObject({ detail: 'PRO', data: { changes: [{ field: 'retention', before: { years: 10, trigger: 'superseded', disposition: 'destroy' }, after: { years: 25, trigger: 'in_force', disposition: 'archive' } }] } });
    expect((await journalOf(db(), 'PRO-QUA-0002')).filter((x) => x.action === 'retention_type')).toEqual([]);
    const typeEntries = await db().select().from(s.auditLog).where(and(eq(s.auditLog.targetKind, 'type'), eq(s.auditLog.targetId, 'PRO'))).orderBy(asc(s.auditLog.id));
    expect(typeEntries.map((x) => x.action)).toEqual(['type', 'retention_applied']);
    expect(typeEntries[1].data?.changes).toContainEqual({ field: 'retentionDocs', after: '1' });
    // Saved again with the same rule: nothing left to apply.
    expect(await updateType(await typeForm({ ...NEW_RULE, applyRetention: 'on' }))).toMatchObject({ ok: true, message: expect.stringContaining(t.retention_applied.replace('{n}', '0')) });
  });

  it('the frozen document, once released, takes the type rule back from its record', async () => {
    await three();
    actAs('manager');
    await updateType(await typeForm({ ...NEW_RULE, applyRetention: 'on' }));
    await db().update(s.documents).set({ legalHold: false }).where(eq(s.documents.id, 'PRO-QUA-0003'));
    expect(await setClass('manager', { mode: 'type' }, 'PRO-QUA-0003')).toMatchObject({ ok: true });
    expect(await classOf('PRO-QUA-0003')).toEqual({ years: 25, trigger: 'in_force', disposition: 'archive', override: false });
  });
});
