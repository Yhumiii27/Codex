import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { addVocabTerm, adoptSubtype, createDocument, mergeVocabTerms, renameVocabTerm, updateMeta } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { importDocument } from '@/lib/importer';
import { vocabOverview, vocabSuggestions } from '@/lib/queries';
import { addDoc, fixClock, getDoc, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Controlled vocabularies (point 59 of docs/reste-a-faire.md, MET-07, G32, G40, A21): the source organisation and the
// keywords read against their terms (a spelling takes the term's, a new value is added only once confirmed, or by the
// import, journaled), administered in Administration › Vocabulaires (add, rename, merge a duplicate; the documents
// follow, but under legal hold); the forms are offered the terms of documents the user may read (D-14); the language is
// fr, en or none; the sub-type list stays open (MET-17) and an administrator adopts a value into it.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();
const t = DICT.fr;

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const letter = (fields: Record<string, string | string[]>, who: Person = 'owner') => {
  actAs(who);
  return createDocument(form({ title: 'Courrier', typeCode: 'COR', origin: 'externe', ...fields }));
};
async function edit(id: string, fields: Record<string, string | string[]>, who: Person = 'owner') {
  actAs(who);
  return updateMeta(form({ docId: id, version: (await viewOf(db(), id)).version, ...fields }));
}
const terms = async (table: typeof s.sourceOrgs | typeof s.keywordTerms) => (await db().select().from(table)).map((x) => ({ name: x.name, key: x.key, aliases: x.aliases })).sort((a, b) => a.name.localeCompare(b.name));
const addTerm = (table: typeof s.sourceOrgs | typeof s.keywordTerms, name: string, key: string, aliases: string[] = []) => db().insert(table).values({ name, key, aliases, createdAt: '2026-10-01' });
const docs = async () => (await db().select().from(s.documents)).map((d) => [d.id, d.sourceOrg, d.keywords]);

describe('forms: terms read against the vocabularies', () => {
  it('asks to confirm a new term, writes nothing until then, and adds it once confirmed, journaled', async () => {
    expect(await letter({ sourceOrg: 'Nordvolt', keywords: 'levage' })).toEqual({
      ok: false, error: t.vocab_confirm_new.replace('{terms}', '« Nordvolt »'), field: 'sourceOrg', confirm: '["Nordvolt"]',
    });
    expect(await letter({ sourceOrg: 'Nordvolt', keywords: 'levage', confirmTerm: 'nordvolt' })).toEqual({
      ok: false, error: t.vocab_confirm_new.replace('{terms}', '« levage »'), field: 'keywords', confirm: '["levage"]',
    });
    expect(await docs()).toEqual([]);
    expect(await terms(s.sourceOrgs)).toEqual([]);
    expect(await letter({ sourceOrg: ' Nordvolt  ', keywords: 'levage, LEVAGE', confirmTerm: ['Nordvolt', 'levage'] })).toMatchObject({ ok: true });
    expect(await docs()).toEqual([['COR-QUA-0001', 'Nordvolt', ['levage']]]);
    expect(await terms(s.sourceOrgs)).toEqual([{ name: 'Nordvolt', key: 'nordvolt', aliases: [] }]);
    const added = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_add'));
    expect(added.map((a) => [a.userId, a.targetKind, a.targetId])).toEqual([['owner', 'source_org', 'Nordvolt'], ['owner', 'keyword', 'levage']]);
  });

  it('writes a known term in its own spelling, an alias as the term it stands for, without asking', async () => {
    await addTerm(s.sourceOrgs, 'Siemens', 'siemens', ['SIEMENS SAS']);
    await addTerm(s.keywordTerms, 'Sécurité', 'securite');
    expect(await letter({ sourceOrg: 'siemens sas', keywords: 'SECURITE, sécurité' })).toMatchObject({ ok: true });
    expect(await docs()).toEqual([['COR-QUA-0001', 'Siemens', ['Sécurité']]]);
    expect((await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_add')))).toEqual([]);
  });

  it('keeps on edit a value the document already carries, without asking', async () => {
    await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR' });
    await db().update(s.documents).set({ origin: 'externe', sourceOrg: 'Ancien fournisseur', keywords: ['hérité'] }).where(eq(s.documents.id, 'COR-QUA-0001'));
    expect(await edit('COR-QUA-0001', { title: 'Courrier repris', origin: 'externe', sourceOrg: 'Ancien fournisseur', keywords: 'hérité' })).toMatchObject({ ok: true });
    expect((await terms(s.sourceOrgs)).map((x) => x.name)).toEqual(['Ancien fournisseur']);
  });

  it('accepts fr, en or no language, and refuses any other, but where the document already has it', async () => {
    expect(await letter({ sourceOrg: 'X', confirmTerm: 'X', lang: 'de' })).toEqual({ ok: false, error: t.lang_invalid, field: 'lang' });
    expect(await letter({ sourceOrg: 'X', confirmTerm: 'X', lang: ' EN ' })).toMatchObject({ ok: true });
    expect((await getDoc(db(), 'COR-QUA-0001')).lang).toBe('en');
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().update(s.documents).set({ lang: 'de' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    expect(await edit('PRO-QUA-0001', { title: 'Procédure', lang: 'de' })).toMatchObject({ ok: true });
    expect(await edit('PRO-QUA-0001', { title: 'Procédure', lang: 'it' })).toEqual({ ok: false, error: t.lang_invalid, field: 'lang' });
  });

  it('writes a sub-type in its type’s spelling, and keeps a value outside the list (the list stays open)', async () => {
    await db().update(s.docTypes).set({ subtypes: [{ fr: 'Procédure opérationnelle', en: 'Operating procedure' }] }).where(eq(s.docTypes.code, 'PRO'));
    actAs('owner');
    expect(await createDocument(form({ title: 'A', typeCode: 'PRO', subtype: 'procedure OPERATIONNELLE' }))).toMatchObject({ ok: true });
    expect(await createDocument(form({ title: 'B', typeCode: 'PRO', subtype: 'Mode  opératoire' }))).toMatchObject({ ok: true });
    expect((await db().select().from(s.documents)).map((d) => d.subtype).sort()).toEqual(['Mode opératoire', 'Procédure opérationnelle']);
  });

  it('bounds the keywords as the import does', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `k${i}`).join(', ');
    expect(await letter({ sourceOrg: 'X', confirmTerm: 'X', keywords: many })).toMatchObject({ ok: false, field: 'keywords' });
  });
});

describe('forms: a term the user is not offered is answered as an unknown one (D-14, revue du lot 9)', () => {
  // A keyword carried only by a draft `writer` may not read: whether it exists must not show in the answer.
  async function hiddenTerm() {
    await addTerm(s.keywordTerms, 'Projet Hélios', 'projet helios');
    await addDoc(db(), { id: 'PRO-QUA-0009', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    await db().update(s.documents).set({ keywords: ['Projet Hélios'] }).where(eq(s.documents.id, 'PRO-QUA-0009'));
  }
  const strip = (r: unknown) => JSON.stringify(r).replace(/PROJET HELIOS|inconnu/g, 'X');

  it('asks the same confirmation for a hidden term as for an unknown one, without adding a duplicate once confirmed', async () => {
    await hiddenTerm();
    const hidden = await letter({ sourceOrg: 'X', confirmTerm: 'X', keywords: 'PROJET HELIOS' }, 'writer');
    const unknown = await letter({ sourceOrg: 'X', confirmTerm: 'X', keywords: 'inconnu' }, 'writer');
    expect(hidden).toEqual({ ok: false, error: t.vocab_confirm_new.replace('{terms}', '« PROJET HELIOS »'), field: 'keywords', confirm: '["PROJET HELIOS"]' });
    expect(strip(hidden)).toBe(strip(unknown));
    expect(await letter({ sourceOrg: 'X', confirmTerm: ['X', 'PROJET HELIOS'], keywords: 'PROJET HELIOS' }, 'writer')).toMatchObject({ ok: true });
    const [made] = (await docs()).filter(([id]) => id !== 'PRO-QUA-0009');
    expect(made[2]).toEqual(['Projet Hélios']);
    expect((await terms(s.keywordTerms)).map((x) => x.name)).toEqual(['Projet Hélios']);
    const added = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_add'));
    expect(added.map((a) => a.targetId)).toEqual(['X']);
  });

  it('takes it without asking from whoever is offered it: the draft’s owner, a records manager', async () => {
    await hiddenTerm();
    expect(await letter({ sourceOrg: 'X', confirmTerm: 'X', keywords: 'projet helios' }, 'owner')).toMatchObject({ ok: true });
    expect(await letter({ sourceOrg: 'X', keywords: 'projet helios' }, 'manager')).toMatchObject({ ok: true });
    expect((await docs()).filter(([id]) => id !== 'PRO-QUA-0009').map(([, , k]) => k)).toEqual([['Projet Hélios'], ['Projet Hélios']]);
  });

  it('asks it on edit too, unless the document already carries it', async () => {
    await hiddenTerm();
    await addDoc(db(), { id: 'PRO-QUA-0001', ownerId: 'writer' });
    expect(await edit('PRO-QUA-0001', { title: 'Procédure', keywords: 'Projet Hélios' }, 'writer')).toEqual({
      ok: false, error: t.vocab_confirm_new.replace('{terms}', '« Projet Hélios »'), field: 'keywords', confirm: '["Projet Hélios"]',
    });
    expect(await edit('PRO-QUA-0001', { title: 'Procédure', keywords: 'Projet Hélios', confirmTerm: 'Projet Hélios' }, 'writer')).toMatchObject({ ok: true });
    expect(await edit('PRO-QUA-0001', { title: 'Procédure bis', keywords: 'Projet Hélios' }, 'writer')).toMatchObject({ ok: true });
    expect((await terms(s.keywordTerms)).map((x) => x.name)).toEqual(['Projet Hélios']);
  });
});

describe('Administration › Vocabulaires', () => {
  it('adds a term, and refuses another spelling of an existing one', async () => {
    actAs('manager');
    expect(await addVocabTerm('source_org', ' Bureau  Veritas ')).toEqual({ ok: true, message: t.vocab_added });
    expect(await addVocabTerm('source_org', 'BUREAU VÉRITAS')).toEqual({ ok: false, error: t.vocab_name_taken, field: 'name' });
    expect(await addVocabTerm('keyword', 'bureau veritas')).toEqual({ ok: true, message: t.vocab_added });
    expect(await addVocabTerm('nope', 'x')).toEqual({ ok: false, error: t.error });
    expect((await terms(s.sourceOrgs)).map((x) => x.name)).toEqual(['Bureau Veritas']);
  });

  it('renames a term: its documents follow, but under legal hold, and the former name stays an alias', async () => {
    await addTerm(s.sourceOrgs, 'Siemens', 'siemens');
    await addDoc(db(), { id: 'COR-QUA-0001', typeCode: 'COR' });
    await addDoc(db(), { id: 'COR-QUA-0002', typeCode: 'COR', legalHold: true });
    await db().update(s.documents).set({ origin: 'externe', sourceOrg: 'SIEMENS' });
    const [term] = await db().select().from(s.sourceOrgs);
    actAs('manager');
    expect(await renameVocabTerm('source_org', term.id, 'Siemens AG')).toEqual({ ok: true, message: `${t.saved_ok} · ${t.vocab_docs_changed.replace('{n}', '1')} · ${t.retention_held_kept.replace('{n}', '1')}` });
    expect(await docs()).toEqual(expect.arrayContaining([['COR-QUA-0001', 'Siemens AG', []], ['COR-QUA-0002', 'SIEMENS', []]]));
    expect(await terms(s.sourceOrgs)).toEqual([{ name: 'Siemens AG', key: 'siemens ag', aliases: ['Siemens'] }]);
    const [applied] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_apply'));
    expect(applied).toMatchObject({ docId: 'COR-QUA-0001', data: { changes: [{ field: 'sourceOrg', before: 'SIEMENS', after: 'Siemens AG' }] } });
    expect((await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_rename')))[0].data?.changes).toEqual([
      { field: 'term', before: 'Siemens', after: 'Siemens AG' }, { field: 'aliases', before: null, after: ['Siemens'] },
    ]);
    // The held document's spelling still resolves to the term: a form or an import gives the new name.
    actAs('owner');
    expect(await createDocument(form({ title: 'C', typeCode: 'COR', origin: 'externe', sourceOrg: 'siemens' }))).toMatchObject({ ok: true });
    expect((await getDoc(db(), 'COR-QUA-0003')).sourceOrg).toBe('Siemens AG');
  });

  it('merges a duplicate into a term: its documents take the term, its spellings become aliases, it is removed', async () => {
    await addTerm(s.keywordTerms, 'soudure', 'soudure');
    await addTerm(s.keywordTerms, 'Soudage', 'soudage');
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await db().update(s.documents).set({ keywords: ['Soudage', 'soudure', 'acier'] });
    const all = await db().select().from(s.keywordTerms);
    const dup = all.find((x) => x.name === 'Soudage')!, into = all.find((x) => x.name === 'soudure')!;
    actAs('manager');
    expect(await mergeVocabTerms('keyword', dup.id, dup.id)).toEqual({ ok: false, error: t.vocab_merge_self });
    expect(await mergeVocabTerms('keyword', dup.id, into.id)).toMatchObject({ ok: true });
    expect((await getDoc(db(), 'PRO-QUA-0001')).keywords).toEqual(['soudure', 'acier']);
    expect(await terms(s.keywordTerms)).toEqual([{ name: 'soudure', key: 'soudure', aliases: ['Soudage'] }]);
    expect(await mergeVocabTerms('keyword', dup.id, into.id)).toEqual({ ok: false, error: t.vocab_not_found });
  });

  it('adopts a sub-type into its type, once', async () => {
    actAs('manager');
    expect(await adoptSubtype('PRO', ' Mode  opératoire ')).toEqual({ ok: true, message: t.subtype_adopted.replace('{value}', 'Mode opératoire').replace('{type}', 'PRO') });
    const [pro] = await db().select().from(s.docTypes).where(eq(s.docTypes.code, 'PRO'));
    expect(pro.subtypes).toEqual([{ fr: 'Mode opératoire', en: 'Mode opératoire' }]);
    expect(await adoptSubtype('PRO', 'MODE OPERATOIRE')).toEqual({ ok: false, error: t.subtype_listed });
    const [entry] = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'type'));
    expect(entry).toMatchObject({ targetKind: 'type', targetId: 'PRO' });
  });

  it('is reserved to the « Administrer » permission', async () => {
    await addTerm(s.keywordTerms, 'a', 'a');
    await addTerm(s.keywordTerms, 'b', 'b');
    const [a, b] = await db().select().from(s.keywordTerms);
    for (const who of ['owner', 'head', 'auditor'] as const) {
      actAs(who);
      expect(await addVocabTerm('keyword', 'c')).toEqual({ ok: false, error: t.forbidden });
      expect(await renameVocabTerm('keyword', a.id, 'c')).toEqual({ ok: false, error: t.forbidden });
      expect(await mergeVocabTerms('keyword', a.id, b.id)).toEqual({ ok: false, error: t.forbidden });
      expect(await adoptSubtype('PRO', 'c')).toEqual({ ok: false, error: t.forbidden });
    }
    expect((await terms(s.keywordTerms)).map((x) => x.name)).toEqual(['a', 'b']);
  });

  it('counts the documents of each term in any spelling, and lists the values and sub-types left out', async () => {
    await addTerm(s.sourceOrgs, 'Siemens', 'siemens', ['SIEMENS SAS']);
    await db().update(s.docTypes).set({ subtypes: [{ fr: 'Courrier entrant', en: 'Incoming mail' }] }).where(eq(s.docTypes.code, 'COR'));
    for (const [id, org, sub] of [['COR-QUA-0001', 'SIEMENS', 'courrier entrant'], ['COR-QUA-0002', 'Siemens SAS', 'Télécopie'], ['COR-QUA-0003', 'Nordvolt', null]] as const) {
      await addDoc(db(), { id, typeCode: 'COR' });
      await db().update(s.documents).set({ origin: 'externe', sourceOrg: org, subtype: sub }).where(eq(s.documents.id, id));
    }
    actAs('manager');
    const o = await vocabOverview(await getCtx());
    expect(o.source_org.terms.map((x) => [x.name, x.uses])).toEqual([['Siemens', 2]]);
    expect(o.source_org.unlisted).toEqual([{ value: 'Nordvolt', uses: 1 }]);
    expect(o.subtypes).toEqual([{ typeCode: 'COR', value: 'Télécopie', uses: 1 }]);
  });

  it('gives the counts to records managers only; another administrator sees the terms, and what is left out of documents they may read (D-14)', async () => {
    // An administrator who is not a records manager: the « Administrer » permission given to the auditors.
    await db().insert(s.rolePermissions).values({ role: 'auditeur', perm: 'admin', granted: true });
    await addTerm(s.keywordTerms, 'secret', 'secret');
    await db().update(s.docTypes).set({ subtypes: [] }).where(eq(s.docTypes.code, 'PRO'));
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    await addDoc(db(), { id: 'PRO-QUA-0003', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    await db().update(s.documents).set({ keywords: ['vu'], subtype: 'Lisible' }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await db().update(s.documents).set({ keywords: ['secret', 'brouillon seul'], subtype: 'Caché' }).where(eq(s.documents.id, 'PRO-QUA-0002'));
    await db().update(s.documents).set({ keywords: ['secret'] }).where(eq(s.documents.id, 'PRO-QUA-0003'));
    actAs('auditor');
    const ctx = await getCtx();
    expect(ctx.screens.admin && !ctx.seesAll).toBe(true);
    const o = await vocabOverview(ctx);
    expect(o.keyword.terms.map((x) => [x.name, x.uses])).toEqual([['secret', null]]);
    expect(o.keyword.unlisted).toEqual([{ value: 'vu', uses: null }]);
    expect(o.subtypes).toEqual([{ typeCode: 'PRO', value: 'Lisible', uses: null }]);
    actAs('manager');
    const m = await vocabOverview(await getCtx());
    expect(m.keyword.terms.map((x) => [x.name, x.uses])).toEqual([['secret', 2]]);
    expect(m.keyword.unlisted).toEqual([{ value: 'brouillon seul', uses: 1 }, { value: 'vu', uses: 1 }]);
    expect(m.subtypes.map((x) => [x.value, x.uses])).toEqual([['Caché', 1], ['Lisible', 1]]);
  });
});

describe('vocabSuggestions: what the forms offer (D-14)', () => {
  it('offers the terms of documents the user may read, and the terms no document carries', async () => {
    await addTerm(s.keywordTerms, 'public', 'public');
    await addTerm(s.keywordTerms, 'secret', 'secret');
    await addTerm(s.keywordTerms, 'brouillon', 'brouillon');
    await addTerm(s.keywordTerms, 'libre', 'libre');
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-HSE-0001', department: 'HSE', conf: 'confidentiel', ownerId: 'director' });
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    await db().update(s.documents).set({ keywords: ['PUBLIC'] }).where(eq(s.documents.id, 'PRO-QUA-0001'));
    await db().update(s.documents).set({ keywords: ['secret'] }).where(eq(s.documents.id, 'PRO-HSE-0001'));
    await db().update(s.documents).set({ keywords: ['brouillon'] }).where(eq(s.documents.id, 'PRO-QUA-0002'));
    const as = async (who: Person) => { actAs(who); return (await vocabSuggestions(await getCtx())).keywords.sort(); };
    expect(await as('writer')).toEqual(['libre', 'public']);
    expect(await as('owner')).toEqual(['brouillon', 'libre', 'public']);
    expect(await as('manager')).toEqual(['brouillon', 'libre', 'public', 'secret']);
    // Who may neither create nor edit a document is offered nothing.
    expect(await as('auditor')).toEqual([]);
  });
});

describe('import: controlled values', () => {
  const meta = (over: Record<string, unknown>) => ({ legacyRef: `GED/${Math.random()}`, title: 'Courrier', typeCode: 'COR', department: 'QUA', ownerId: 'owner', origin: 'externe', sourceOrg: 'Nordvolt', inForceAt: '2026-01-05', ...over });

  it('refuses a language other than fr, en or none', async () => {
    expect(await importDocument(meta({ lang: 'de' }), null)).toMatchObject({ kind: 'invalid', issues: [{ field: 'lang', code: 'invalid_lang' }] });
    expect(await importDocument(meta({ lang: 'FR' }), null)).toMatchObject({ kind: 'created' });
    expect((await db().select().from(s.documents))[0].lang).toBe('fr');
  });

  it('adds an unknown term (journaled under the import, with a warning), and writes a known one in its spelling', async () => {
    await addTerm(s.keywordTerms, 'Sécurité', 'securite');
    const res = await importDocument(meta({ legacyRef: 'GED/1', keywords: ['SECURITE', 'levage'] }), null);
    expect(res).toMatchObject({ kind: 'created', warnings: [{ field: 'sourceOrg', code: 'term_added' }, { field: 'keywords', code: 'term_added', message: 'Terme ajouté au vocabulaire contrôlé : « levage ».' }] });
    expect(await docs()).toEqual([[expect.any(String), 'Nordvolt', ['Sécurité', 'levage']]]);
    const added = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_add'));
    expect(added.map((a) => [a.userId, a.targetId, a.detail])).toEqual([['codex', 'Nordvolt', 'GED/1'], ['codex', 'levage', 'GED/1']]);
    // A second import of the same values adds nothing.
    expect(await importDocument(meta({ legacyRef: 'GED/2', sourceOrg: 'NORDVOLT', keywords: 'levage' }), null)).toMatchObject({ kind: 'created', warnings: [] });
    expect((await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'vocab_add'))).length).toBe(2);
  });

  it('keeps a sub-type outside its type’s list, with a warning', async () => {
    expect(await importDocument(meta({ subtype: 'Télécopie' }), null)).toMatchObject({ kind: 'created', warnings: [{ field: 'subtype', code: 'subtype_unlisted' }, { code: 'term_added' }] });
  });
});
