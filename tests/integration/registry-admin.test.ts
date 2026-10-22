import { and, asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { GET as registryGET } from '@/app/api/registry/route';
import { schema as s } from '@/db';
import {
  addFunctionHolder, addOrgValue, createDocument, createFamily, createFunction, createProgram, createType, deleteFamily, deleteFunction, deleteProgram, deleteType,
  updateFamily, updateFunction, updateMeta, updateProgram, updateType,
} from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditDetailL, auditTargetL, listAudit } from '@/lib/queries';
import { addDoc, addWorkflow, fixClock, getDoc, setupDb, viewOf } from '../support/db';
import { actAs } from '../support/session';

// Administration of the register (points 58 and 61 of docs/reste-a-faire.md; D-07, D-08, D-10, D-15): types, families,
// functions and research programmes are created and edited in full by whoever has the right to administer; a code
// names one thing in an ID (TYPE-CONTEXTE-SEQ, QMS for templates); an entry something refers to keeps its code and is
// not deleted (a type or a programme is made inactive instead); every change is journaled, before → after, as an
// entry without document. Keystone reads the register by GET /api/registry, which follows at once.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const t = DICT.fr;

/** A form; a list sends a repeated field. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

/** The type dialog, complete: a new internal type without attachment unless `over` says otherwise. */
const typeForm = (over: Record<string, string | string[]> = {}) => form({
  code: 'NOT', labelFr: 'Note interne', labelEn: 'Internal memo', family: 'qualite', origins: ['interne'], attachments: ['none'],
  subtypeFr: ['Note de service'], subtypeEn: ['Service memo'], circuit: ['resp_qualite'], confAllowed: ['restreint', 'interne'], confDefault: 'interne',
  retentionYears: '5', retentionTrigger: 'superseded', retentionDisposition: 'destroy', retentionBasis: 'Usage interne', reviewMonths: '', iso: '', ...over,
});

/** The dialog of a fixture type (tests/support/fixtures.ts) as it stands, with `over`. */
async function fixtureForm(code: string, over: Record<string, string | string[]> = {}) {
  const [x] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, code));
  return form({
    original: code, code, labelFr: x.labelFr, labelEn: x.labelEn, family: x.family, origins: x.origins, attachments: x.attachments, circuit: x.circuit,
    confAllowed: x.confAllowed, confDefault: x.confDefault, retentionYears: String(x.retentionYears ?? ''), retentionTrigger: x.retentionTrigger,
    retentionDisposition: x.retentionDisposition, reviewMonths: '', ...over,
  });
}

const entries = (kind: string, id: string) =>
  db().select().from(s.auditLog).where(and(eq(s.auditLog.targetKind, kind as 'type'), eq(s.auditLog.targetId, id))).orderBy(asc(s.auditLog.id));

describe('the right to administer', () => {
  const everything = async () => ({
    types: await db().select().from(s.docTypes).orderBy(asc(s.docTypes.code)),
    families: await db().select().from(s.families).orderBy(asc(s.families.key)),
    functions: await db().select().from(s.functions).orderBy(asc(s.functions.key)),
    programs: await db().select().from(s.researchPrograms).orderBy(asc(s.researchPrograms.code)),
    holders: await db().select().from(s.functionHolders).orderBy(asc(s.functionHolders.id)),
    journal: await db().select().from(s.auditLog),
  });
  const unusedEntries = async () => {
    await db().insert(s.families).values({ key: 'vide', labelFr: 'Vide', labelEn: 'Empty', grp: 'DI', sort: 9 });
    await db().insert(s.functions).values({ key: 'resp_essai', labelFr: 'Essai', labelEn: 'Trial', scope: 'global', sort: 9 });
  };
  // Each call would go through for an administrator (checked below): only the right stops it.
  const calls: [string, () => Promise<unknown>][] = [
    ['createType', async () => createType(typeForm())],
    ['updateType', async () => updateType(await fixtureForm('COR', { labelFr: 'Courrier' }))],
    ['deleteType', async () => deleteType('COR')],
    ['createFamily', async () => createFamily(form({ key: 'logistique', labelFr: 'Logistique', labelEn: '', grp: 'DI' }))],
    ['updateFamily', async () => updateFamily(form({ original: 'correspondance', key: 'correspondance', labelFr: 'Courriers', labelEn: '', grp: 'DE' }))],
    ['deleteFamily', async () => deleteFamily('vide')],
    ['createFunction', async () => createFunction(form({ key: 'resp_log', labelFr: 'Logistique', labelEn: '', scope: 'global' }))],
    ['updateFunction', async () => updateFunction(form({ original: 'direction', key: 'direction', labelFr: 'Direction générale', labelEn: '', scope: 'global' }))],
    ['deleteFunction', async () => deleteFunction('resp_essai')],
    ['createProgram', async () => createProgram(form({ code: 'R2701', name: 'Hydrogène', managerId: 'researcher' }))],
    ['updateProgram', async () => updateProgram(form({ original: 'R2601', code: 'R2601', name: 'Capteurs', managerId: 'researcher', active: 'off' }))],
    ['deleteProgram', async () => deleteProgram('R2601')],
  ];

  it.each(calls)('%s is refused to whoever may not administer, changing and journaling nothing', async (_name, call) => {
    await unusedEntries();
    const before = await everything();
    for (const who of ['owner', 'researcher', 'auditor'] as const) {
      actAs(who);
      expect(await call(), who).toEqual({ ok: false, error: t.forbidden });
    }
    expect(await everything()).toEqual(before);
    actAs('manager');
    expect(await call()).toMatchObject({ ok: true });
    expect(await db().select().from(s.auditLog)).toHaveLength(1);
  });
});

describe('types', () => {
  it('are created by an administrator with every setting, journaled from nothing to their values', async () => {
    actAs('manager');
    expect(await createType(typeForm({ code: 'not', clientDeliverable: 'on', iso: '7.5' }))).toEqual({ ok: true, message: t.reg_created });
    const [x] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'NOT'));
    expect(x).toMatchObject({
      labelFr: 'Note interne', labelEn: 'Internal memo', family: 'qualite', origins: ['interne'], attachments: ['none'],
      subtypes: [{ fr: 'Note de service', en: 'Service memo' }], circuit: ['resp_qualite'], confAllowed: ['restreint', 'interne'], confDefault: 'interne',
      retentionYears: 5, retentionBasis: 'Usage interne', iso: '7.5', clientDeliverable: true, active: true, source: 'codex', sort: 5,
    });
    const [entry] = await entries('type', 'NOT');
    expect(entry).toMatchObject({ action: 'type_add', userId: 'manager', docId: null });
    expect(entry.data?.changes).toContainEqual({ field: 'code', before: null, after: 'NOT' });
    expect(entry.data?.changes).toContainEqual({ field: 'subtypes', before: null, after: ['Note de service / Service memo'] });
    const ctx = await getCtx();
    expect(auditTargetL(ctx, 'type', 'NOT')).toBe(`${t.type} · NOT · Note interne`);
    expect(auditDetailL(ctx, entry)).toContain(`${t.origin} : — → ${t.or_interne}`);
    expect(auditDetailL(ctx, entry)).toContain(`${t.client_deliverable} : — → ${t.yes}`);
  });

  it('are the administrators’ only', async () => {
    actAs('owner');
    expect(await createType(typeForm())).toEqual({ ok: false, error: t.forbidden });
    expect(await deleteType('COR')).toEqual({ ok: false, error: t.forbidden });
    expect(await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'NOT'))).toEqual([]);
  });

  it('take a code no type, department, programme or QMS has (point 1 of the open questions)', async () => {
    actAs('manager');
    expect(await createType(typeForm({ code: 'PRO' }))).toEqual({ ok: false, error: t.reg_code_taken, field: 'code' });
    expect(await createType(typeForm({ code: 'QUA' }))).toEqual({ ok: false, error: t.reg_code_department, field: 'code' });
    expect(await createType(typeForm({ code: 'QMS' }))).toEqual({ ok: false, error: t.reg_code_qms, field: 'code' });
    expect(await createType(typeForm({ code: 'NOTE' }))).toEqual({ ok: false, error: t.reg_type_code_format, field: 'code' });
    expect(await createType(typeForm({ family: 'inconnue' }))).toEqual({ ok: false, error: t.reg_family_required, field: 'family' });
    expect(await db().select().from(s.auditLog)).toEqual([]);
  });

  it('change code, labels and every setting while unused; one in use keeps its code and is not deleted', async () => {
    actAs('manager');
    expect(await updateType(await fixtureForm('COR', { code: 'CRR', labelFr: 'Courrier', subtypeFr: ['Lettre'], subtypeEn: [''] }))).toEqual({ ok: true, message: t.saved_ok });
    const [x] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'CRR'));
    expect(x).toMatchObject({ labelFr: 'Courrier', subtypes: [{ fr: 'Lettre', en: 'Lettre' }] });
    const [entry] = await entries('type', 'CRR');
    expect(entry.action).toBe('type');
    expect(entry.data?.changes).toEqual([
      { field: 'code', before: 'COR', after: 'CRR' }, { field: 'labelFr', before: 'COR', after: 'Courrier' }, { field: 'subtypes', before: null, after: ['Lettre'] },
    ]);

    await addDoc(db(), { id: 'PRO-QUA-0001' });
    expect(await updateType(await fixtureForm('PRO', { code: 'PRC' }))).toEqual({ ok: false, error: t.reg_type_in_use, field: 'code' });
    expect(await deleteType('PRO')).toEqual({ ok: false, error: t.reg_type_in_use });
    // Made inactive instead: still the type of its documents.
    expect(await updateType(await fixtureForm('PRO', { active: 'off' }))).toMatchObject({ ok: true });
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO')))[0].active).toBe(false);
    expect((await getDoc(db(), 'PRO-QUA-0001')).typeCode).toBe('PRO');
  });

  it('the type of templates keeps its code and stays, even without documents (D-10: FRM, context QMS)', async () => {
    actAs('manager');
    expect(await db().select().from(s.documents)).toEqual([]);
    expect(await updateType(await fixtureForm('FRM', { code: 'MOD' }))).toEqual({ ok: false, error: t.reg_type_in_use, field: 'code' });
    expect(await deleteType('FRM')).toEqual({ ok: false, error: t.reg_type_in_use });
    expect(await updateType(await fixtureForm('FRM', { labelFr: 'Modèle' }))).toMatchObject({ ok: true });
  });

  it('the type of templates stays without attachment: a template attached to a project would take its context, not QMS', async () => {
    actAs('manager');
    for (const attachments of [['none', 'project'], ['research']]) {
      expect(await updateType(await fixtureForm('FRM', { attachments })), attachments.join()).toEqual({ ok: false, error: t.reg_template_attachments });
    }
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'FRM')))[0].attachments).toEqual(['none']);
    expect(await entries('type', 'FRM')).toEqual([]);
    // Hence no template gets a project's ID.
    expect(await createDocument(form({ title: 'Modèle', typeCode: 'FRM', attachment: 'project', projectCode: 'HLT-026' }))).toMatchObject({ ok: false });
    expect(await db().select().from(s.documents)).toEqual([]);
  });

  it('a type a project expects keeps its code too', async () => {
    await db().insert(s.projectExpected).values({ projectCode: 'HLT-026', label: 'P&ID', typeCode: 'PID' });
    actAs('manager');
    expect(await updateType(await fixtureForm('PID', { code: 'PIX' }))).toEqual({ ok: false, error: t.reg_type_in_use, field: 'code' });
    expect(await deleteType('PID')).toEqual({ ok: false, error: t.reg_type_in_use });
  });

  it('are deleted when unused, journaled from their values to nothing', async () => {
    actAs('manager');
    expect(await deleteType('COR')).toEqual({ ok: true, message: t.reg_deleted });
    expect(await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'COR'))).toEqual([]);
    const [entry] = await entries('type', 'COR');
    expect(entry.action).toBe('type_remove');
    expect(entry.data?.changes).toContainEqual({ field: 'code', before: 'COR', after: null });
    expect(await deleteType('COR')).toEqual({ ok: false, error: t.reg_not_found });
  });

  it('move their documents along when their family changes', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    actAs('manager');
    expect(await updateType(await fixtureForm('PRO', { family: 'projet' }))).toMatchObject({ ok: true });
    expect((await getDoc(db(), 'PRO-QUA-0001')).family).toBe('projet');
    expect((await entries('type', 'PRO'))[0].data?.changes).toEqual([{ field: 'family', before: 'qualite', after: 'projet' }]);
  });

  it('ask before leaving out an origin, attachment or confidentiality some documents have; they keep theirs', async () => {
    await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR' });
    await addDoc(db(), { id: 'COR-HLT-026-001', typeCode: 'COR', projectCode: 'HLT-026' });
    await addDoc(db(), { id: 'COR-QUA-0002', typeCode: 'COR', conf: 'confidentiel' });
    actAs('manager');
    const narrower = { attachments: ['none'], confAllowed: ['restreint', 'interne'], confDefault: 'interne' };
    const asked = await updateType(await fixtureForm('COR', narrower));
    // Records managers read which documents (drafts included, D-14).
    expect(asked).toEqual({ ok: false, error: `${t.reg_out_of_type.replace('{n}', '2')} COR-HLT-026-001, COR-QUA-0002`, field: 'confirmOut', confirm: expect.any(String) });
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'COR')))[0].attachments).toEqual(['none', 'project']);

    const token = (asked as { confirm: string }).confirm;
    expect(await updateType(await fixtureForm('COR', { ...narrower, confirmOut: token }))).toMatchObject({ ok: true });
    expect((await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'COR')))[0]).toMatchObject({ attachments: ['none'], confAllowed: ['restreint', 'interne'] });
    expect(await getDoc(db(), 'COR-HLT-026-001')).toMatchObject({ attachment: 'project', projectCode: 'HLT-026' });
    // Their next metadata edit asks to reclassify them (validateFields).
    const view = await viewOf(db(), 'COR-QUA-0002');
    expect(await updateMeta(form({ docId: 'COR-QUA-0002', version: view.version, title: 'Lettre' }))).toEqual({ ok: false, error: t.conf_not_allowed });
    // Widening asks nothing.
    expect(await updateType(await fixtureForm('COR', { attachments: ['none', 'project'] }))).toMatchObject({ ok: true });
  });

  it('a confirmation covers the documents it was shown and no other', async () => {
    await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR' });
    await addDoc(db(), { id: 'COR-HLT-026-001', typeCode: 'COR', projectCode: 'HLT-026' });
    await addDoc(db(), { id: 'COR-QUA-0002', typeCode: 'COR', conf: 'confidentiel' });
    actAs('manager');
    const cor = async () => (await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'COR')))[0];
    const outOf = (n: number, ids: string) => ({ ok: false, error: `${t.reg_out_of_type.replace('{n}', String(n))} ${ids}`, field: 'confirmOut', confirm: expect.any(String) });
    // Asked about leaving out projects: one document.
    const projectOnly = { attachments: ['none'] };
    const first = await updateType(await fixtureForm('COR', projectOnly));
    expect(first).toEqual(outOf(1, 'COR-HLT-026-001'));
    const token = (first as { confirm: string }).confirm;

    // The same confirmation for a narrower setting, which also leaves out the confidential one: asked again, with both.
    const narrower = { attachments: ['none'], confAllowed: ['restreint', 'interne'], confDefault: 'interne' };
    const again = await updateType(await fixtureForm('COR', { ...narrower, confirmOut: token }));
    expect(again).toEqual(outOf(2, 'COR-HLT-026-001, COR-QUA-0002'));
    expect((again as { confirm: string }).confirm).not.toBe(token);
    // Nor does a bare « yes » confirm anything.
    expect(await updateType(await fixtureForm('COR', { ...narrower, confirmOut: '1' }))).toEqual(outOf(2, 'COR-HLT-026-001, COR-QUA-0002'));
    // A document the setting leaves out, added between the question and the answer, is counted: asked again.
    await addDoc(db(), { id: 'COR-HLT-026-002', typeCode: 'COR', projectCode: 'HLT-026' });
    expect(await updateType(await fixtureForm('COR', { ...projectOnly, confirmOut: token }))).toEqual(outOf(2, 'COR-HLT-026-001, COR-HLT-026-002'));
    expect(await cor()).toMatchObject({ attachments: ['none', 'project'], confAllowed: ['public', 'restreint', 'interne', 'confidentiel', 'tres_confidentiel'] });
    expect(await entries('type', 'COR')).toEqual([]);

    // Its own answer goes through.
    const last = await updateType(await fixtureForm('COR', projectOnly));
    expect(await updateType(await fixtureForm('COR', { ...projectOnly, confirmOut: (last as { confirm: string }).confirm }))).toMatchObject({ ok: true });
    expect(await cor()).toMatchObject({ attachments: ['none'] });
  });

  it('name the documents left out to records managers only (D-14)', async () => {
    await db().insert(s.rolePermissions).values({ role: 'validateur', perm: 'admin', granted: true });
    await addDoc(db(), { id: 'COR-HLT-026-001', typeCode: 'COR', projectCode: 'HLT-026', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    actAs('head');
    expect(await updateType(await fixtureForm('COR', { attachments: ['none'] }))).toEqual({ ok: false, error: t.reg_out_of_type.replace('{n}', '1'), field: 'confirmOut', confirm: expect.any(String) });
  });
});

describe('families', () => {
  const familyForm = (over: Record<string, string> = {}) => form({ key: 'logistique', labelFr: 'Logistique', labelEn: 'Logistics', grp: 'DI', ...over });

  it('are created, renamed and deleted while unused; one with types keeps its key', async () => {
    actAs('manager');
    expect(await createFamily(familyForm())).toEqual({ ok: true, message: t.reg_created });
    expect(await createFamily(familyForm())).toEqual({ ok: false, error: t.reg_code_taken, field: 'key' });
    expect(await createFamily(familyForm({ key: 'Logi-stique' }))).toEqual({ ok: false, error: t.reg_key_format, field: 'key' });
    expect(await updateFamily(familyForm({ original: 'logistique', key: 'supply', grp: 'DE' }))).toMatchObject({ ok: true });
    expect(await db().select().from(s.families).where(eq(s.families.key, 'supply'))).toMatchObject([{ labelFr: 'Logistique', grp: 'DE' }]);
    expect((await entries('family', 'supply'))[0].data?.changes).toEqual([{ field: 'key', before: 'logistique', after: 'supply' }, { field: 'grp', before: 'DI', after: 'DE' }]);
    const ctx = await getCtx();
    expect(auditDetailL(ctx, (await entries('family', 'supply'))[0])).toBe(`${t.key_label} : logistique → supply ; ${t.family_group} : ${t.grp_DI} → ${t.grp_DE}`);

    expect(await updateFamily(familyForm({ original: 'qualite', key: 'qualite_qhse', labelFr: 'Qualité' }))).toEqual({ ok: false, error: t.reg_family_in_use, field: 'key' });
    expect(await updateFamily(familyForm({ original: 'qualite', key: 'qualite', labelFr: 'Qualité' }))).toMatchObject({ ok: true });
    expect(await deleteFamily('qualite')).toEqual({ ok: false, error: t.reg_family_in_use });
    expect(await deleteFamily('supply')).toEqual({ ok: true, message: t.reg_deleted });
    expect((await entries('family', 'supply')).map((e) => e.action)).toEqual(['family', 'family_remove']);
  });
});

describe('functions', () => {
  const fnForm = (over: Record<string, string> = {}) => form({ key: 'resp_log', labelFr: 'Responsable logistique', labelEn: 'Logistics manager', scope: 'global', ...over });

  it('are created and edited; one in a circuit or with holders keeps its key, one with holders its scope', async () => {
    actAs('manager');
    expect(await createFunction(fnForm())).toEqual({ ok: true, message: t.reg_created });
    expect(await updateFunction(fnForm({ original: 'resp_log', key: 'resp_logistique', scope: 'department' }))).toMatchObject({ ok: true });
    expect(await db().select().from(s.functions).where(eq(s.functions.key, 'resp_logistique'))).toMatchObject([{ scope: 'department' }]);

    // In PRO's circuit and held: its key stays, its scope too.
    expect(await updateFunction(fnForm({ original: 'resp_qualite', key: 'qualite', labelFr: 'Qualité' }))).toEqual({ ok: false, error: t.reg_function_in_use, field: 'key' });
    expect(await updateFunction(fnForm({ original: 'resp_qualite', key: 'resp_qualite', labelFr: 'Responsable qualité', scope: 'department' }))).toEqual({ ok: false, error: t.reg_function_scope_locked, field: 'scope' });
    expect(await updateFunction(fnForm({ original: 'resp_qualite', key: 'resp_qualite', labelFr: 'Responsable qualité', labelEn: 'Quality manager' }))).toMatchObject({ ok: true });
    expect(await deleteFunction('resp_qualite')).toEqual({ ok: false, error: t.reg_function_in_use });
    expect(await deleteFunction('resp_logistique')).toEqual({ ok: true, message: t.reg_deleted });
  });

  it('a function the rules of Codex name keeps its key, even out of every circuit and without holders', async () => {
    actAs('manager');
    await db().delete(s.functionHolders).where(eq(s.functionHolders.functionKey, 'chef_projet'));
    await db().update(s.docTypes).set({ circuit: [] }).where(eq(s.docTypes.code, 'PID'));
    expect(await updateFunction(fnForm({ original: 'chef_projet', key: 'chef_affaire', labelFr: 'Chef d’affaire', scope: 'project' }))).toEqual({ ok: false, error: t.reg_function_in_use, field: 'key' });
    expect(await deleteFunction('chef_projet')).toEqual({ ok: false, error: t.reg_function_in_use });
  });

  it('a function the rules of Codex name keeps its scope, even without holders (project manager, client approval, head of department)', async () => {
    actAs('manager');
    await db().delete(s.functionHolders).where(inArray(s.functionHolders.functionKey, ['chef_projet', 'resp_departement']));
    expect(await updateFunction(fnForm({ original: 'chef_projet', key: 'chef_projet', labelFr: 'Chef de projet', scope: 'global' }))).toEqual({ ok: false, error: t.reg_scope_built_in, field: 'scope' });
    expect(await updateFunction(fnForm({ original: 'resp_departement', key: 'resp_departement', labelFr: 'Responsable', scope: 'global' }))).toEqual({ ok: false, error: t.reg_scope_built_in, field: 'scope' });
    expect(await db().select({ key: s.functions.key, scope: s.functions.scope }).from(s.functions).where(inArray(s.functions.key, ['chef_projet', 'resp_departement'])).orderBy(asc(s.functions.key)))
      .toEqual([{ key: 'chef_projet', scope: 'project' }, { key: 'resp_departement', scope: 'department' }]);
    // Created when a base lacks it, it takes its scope too; neither may another function take its key with another scope.
    expect(await createFunction(fnForm({ key: 'validation_client', labelFr: 'Validation client', scope: 'global' }))).toEqual({ ok: false, error: t.reg_scope_built_in, field: 'scope' });
    expect(await updateFunction(fnForm({ original: 'direction', key: 'validation_client', labelFr: 'Validation client', scope: 'global' }))).toEqual({ ok: false, error: t.reg_scope_built_in, field: 'scope' });
    expect(await entries('function', 'chef_projet')).toEqual([]);
    expect(await createFunction(fnForm({ key: 'validation_client', labelFr: 'Validation client', scope: 'project' }))).toMatchObject({ ok: true });
    // Its labels still change.
    expect(await updateFunction(fnForm({ original: 'chef_projet', key: 'chef_projet', labelFr: 'Chef de projet', scope: 'project' }))).toMatchObject({ ok: true });
  });

  it('a holder is named for a department or project that exists, or for the whole group', async () => {
    actAs('manager');
    const before = await db().select().from(s.functionHolders);
    expect(await addFunctionHolder('resp_departement', 'XYZ', 'engineer')).toEqual({ ok: false, error: t.holder_scope_invalid });
    expect(await addFunctionHolder('chef_projet', 'NOP-001', 'engineer')).toEqual({ ok: false, error: t.holder_scope_invalid });
    expect(await db().select().from(s.functionHolders)).toEqual(before);
    expect(await entries('function', 'resp_departement')).toEqual([]);
    expect(await addFunctionHolder('resp_departement', 'ING', 'engineer')).toEqual({ ok: true });
    expect(await addFunctionHolder('chef_projet', 'HLT-026', 'engineer')).toEqual({ ok: true });
    expect(await addFunctionHolder('resp_departement', null, 'engineer')).toEqual({ ok: true });
    // A function of the whole group ignores the value sent.
    expect(await addFunctionHolder('resp_qualite', 'XYZ', 'engineer')).toEqual({ ok: true });
    expect(await db().select({ key: s.functionHolders.functionKey, scope: s.functionHolders.scopeValue }).from(s.functionHolders).where(eq(s.functionHolders.userId, 'engineer')).orderBy(asc(s.functionHolders.id)))
      .toEqual([{ key: 'resp_departement', scope: 'ING' }, { key: 'chef_projet', scope: 'HLT-026' }, { key: 'resp_departement', scope: null }, { key: 'resp_qualite', scope: null }]);
  });

  it('a function a started circuit named keeps its key, even out of every circuit and without holders', async () => {
    actAs('manager');
    expect(await createFunction(fnForm({ key: 'resp_essai' }))).toMatchObject({ ok: true });
    await addDoc(db(), { id: 'PRO-QUA-0001', revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0001', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['quality'] });
    await db().update(s.workflowSteps).set({ functionKey: 'resp_essai' }).where(eq(s.workflowSteps.idx, 1));
    expect(await deleteFunction('resp_essai')).toEqual({ ok: false, error: t.reg_function_in_use });
  });
});

describe('research programmes', () => {
  const programForm = (over: Record<string, string> = {}) => form({ code: 'R2701', name: 'Hydrogène portuaire', managerId: 'researcher', ...over });

  it('are created with a code that is no other context of an ID, and a person as manager', async () => {
    actAs('manager');
    expect(await createProgram(programForm({ code: 'r2701' }))).toEqual({ ok: true, message: t.reg_created });
    expect(await db().select().from(s.researchPrograms).where(eq(s.researchPrograms.code, 'R2701'))).toEqual([{ code: 'R2701', name: 'Hydrogène portuaire', managerId: 'researcher', active: true }]);
    expect(await createProgram(programForm({ code: 'R2601' }))).toEqual({ ok: false, error: t.reg_code_taken, field: 'code' });
    expect(await createProgram(programForm({ code: 'QUA' }))).toEqual({ ok: false, error: t.reg_code_department, field: 'code' });
    expect(await createProgram(programForm({ code: 'PRO' }))).toEqual({ ok: false, error: t.reg_code_type, field: 'code' });
    expect(await createProgram(programForm({ code: 'QMS' }))).toEqual({ ok: false, error: t.reg_code_qms, field: 'code' });
    expect(await createProgram(programForm({ code: 'R-27' }))).toEqual({ ok: false, error: t.reg_program_code_format, field: 'code' });
    expect(await createProgram(programForm({ code: 'R2702', managerId: 'vigie' }))).toEqual({ ok: false, error: t.reg_manager_invalid, field: 'managerId' });
    actAs('researcher');
    expect(await createProgram(programForm({ code: 'R2703' }))).toEqual({ ok: false, error: t.forbidden });
  });

  it('closed: no longer offered to a new document, kept by those that have it; its code stays, it is not deleted', async () => {
    actAs('researcher');
    expect(await createDocument(form({ title: 'Rapport', typeCode: 'PRT', attachment: 'research', programCode: 'R2601' }))).toMatchObject({ ok: true });
    const [d] = await db().select().from(s.documents).where(eq(s.documents.programCode, 'R2601'));
    expect(d.id).toBe('PRT-R2601-001');

    actAs('manager');
    expect(await updateProgram(programForm({ original: 'R2601', code: 'R2600', name: 'Capteurs' }))).toEqual({ ok: false, error: t.reg_program_in_use, field: 'code' });
    expect(await deleteProgram('R2601')).toEqual({ ok: false, error: t.reg_program_in_use });
    expect(await updateProgram(programForm({ original: 'R2601', code: 'R2601', name: 'Capteurs connectés', managerId: 'director', active: 'off' }))).toEqual({ ok: true, message: t.saved_ok });
    const [entry] = await entries('program', 'R2601');
    expect(entry.data?.changes).toEqual([
      { field: 'name', before: 'Capteurs', after: 'Capteurs connectés' }, { field: 'managerId', before: 'researcher', after: 'director' }, { field: 'active', before: true, after: false },
    ]);
    const ctx = await getCtx();
    expect(auditTargetL(ctx, 'program', 'R2601')).toBe(`${t.program} · R2601 · Capteurs connectés`);
    expect(auditDetailL(ctx, entry)).toBe(`${t.program_name} : Capteurs → Capteurs connectés ; ${t.manager} : researcher → director ; ${t.active_label} → ${t.inactive}`);

    // Nor to a new holder, checked by the server too (a dialog opened before the programme closed still lists it).
    expect(await addFunctionHolder('resp_programme', 'R2601', 'director')).toEqual({ ok: false, error: t.holder_scope_invalid });
    expect(await db().select().from(s.functionHolders).where(eq(s.functionHolders.scopeValue, 'R2601'))).toEqual([]);

    actAs('researcher');
    expect(await createDocument(form({ title: 'Rapport 2', typeCode: 'PRT', attachment: 'research', programCode: 'R2601' }))).toEqual({ ok: false, error: t.program_required });
    const view = await viewOf(db(), d.id);
    expect(await updateMeta(form({ docId: d.id, version: view.version, title: 'Rapport final', attachment: 'research', programCode: 'R2601' }))).toMatchObject({ ok: true });
  });

  it('a holder is named for a programme that exists: an unknown code would make a programme created later born in use', async () => {
    actAs('manager');
    expect(await addFunctionHolder('resp_programme', 'R2799', 'director')).toEqual({ ok: false, error: t.holder_scope_invalid });
    expect(await createProgram(programForm({ code: 'R2799' }))).toMatchObject({ ok: true });
    expect(await deleteProgram('R2799')).toEqual({ ok: true, message: t.reg_deleted });
    expect(await addFunctionHolder('resp_programme', 'R2601', 'director')).toEqual({ ok: true });
  });

  it('a programme a holder is named for keeps its code; an unused one is renamed and deleted', async () => {
    actAs('manager');
    expect(await createProgram(programForm())).toMatchObject({ ok: true });
    await db().insert(s.functionHolders).values({ functionKey: 'resp_programme', scopeValue: 'R2701', userId: 'director' });
    expect(await deleteProgram('R2701')).toEqual({ ok: false, error: t.reg_program_in_use });
    await db().delete(s.functionHolders).where(eq(s.functionHolders.scopeValue, 'R2701'));
    expect(await updateProgram(programForm({ original: 'R2701', code: 'H2701' }))).toMatchObject({ ok: true });
    expect(await deleteProgram('H2701')).toEqual({ ok: true, message: t.reg_deleted });
    expect((await entries('program', 'H2701')).map((e) => e.action)).toEqual(['program', 'program_remove']);
  });
});

describe('departments', () => {
  it('take no code a type or a programme has, nor QMS', async () => {
    actAs('manager');
    expect(await addOrgValue('department', 'pro', 'Procédures', '')).toEqual({ ok: false, error: t.reg_code_type, field: 'code' });
    expect(await addOrgValue('department', 'QMS', 'Qualité', '')).toEqual({ ok: false, error: t.reg_code_qms, field: 'code' });
    await db().insert(s.researchPrograms).values({ code: 'LOG', name: 'Logistique', managerId: 'researcher' });
    expect(await addOrgValue('department', 'LOG', 'Logistique', '')).toEqual({ ok: false, error: t.reg_code_program, field: 'code' });
    expect(await addOrgValue('department', 'ACH', 'Achats', 'Purchasing')).toEqual({ ok: true });
  });
});

describe('the journal of the register', () => {
  it('is read in Administration only, like every entry without document', async () => {
    actAs('manager');
    await createFamily(form({ key: 'logistique', labelFr: 'Logistique', labelEn: '', grp: 'DI' }));
    expect((await listAudit(await getCtx())).map((a) => a.action)).toEqual(['family_add']);
    actAs('auditor');
    expect(await listAudit(await getCtx())).toEqual([]);
  });
});

describe('GET /api/registry (Keystone)', () => {
  const get = (etag?: string) => registryGET(new Request('http://localhost/api/registry', { headers: etag ? { 'If-None-Match': etag } : {} }));

  it('follows the register at once: a new family and type, a function renamed, a type deleted', async () => {
    const before = await get();
    const etag = before.headers.get('etag')!;
    expect((await get(etag)).status).toBe(304);

    actAs('manager');
    await createFamily(form({ key: 'logistique', labelFr: 'Logistique', labelEn: 'Logistics', grp: 'DI' }));
    await createType(typeForm({ family: 'logistique' }));
    await updateFunction(form({ original: 'resp_qualite', key: 'resp_qualite', labelFr: 'Responsable qualité', labelEn: 'Quality manager', scope: 'global' }));
    await deleteType('COR');

    const after = await get(etag);
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(etag);
    const body = await after.json();
    expect(body.families).toContainEqual({ key: 'logistique', labels: { fr: 'Logistique', en: 'Logistics' }, group: 'DI', types: ['NOT'] });
    const note = body.types.find((x: { code: string }) => x.code === 'NOT');
    expect(note).toMatchObject({
      labels: { fr: 'Note interne', en: 'Internal memo' }, family: 'logistique', origins: ['interne'], attachments: ['none'],
      subtypes: [{ fr: 'Note de service', en: 'Service memo' }], confAllowed: ['restreint', 'interne'], confDefault: 'interne', active: true, source: 'codex',
      circuit: [{ function: 'resp_qualite', labels: { fr: 'Responsable qualité', en: 'Quality manager' }, scope: 'global' }],
    });
    expect(body.types.map((x: { code: string }) => x.code)).not.toContain('COR');
  });
});
