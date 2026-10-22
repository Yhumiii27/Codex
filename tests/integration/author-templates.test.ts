import { asc, desc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { GET } from '@/app/api/export/search/route';
import { createDocument, deleteType, setTemplateTypes, updateMeta } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditDetailL, listTemplates, registryUsage } from '@/lib/queries';
import { searchHref } from '@/lib/search';
import { addDoc, fixClock, getDoc, journalOf, setupDb, viewOf } from '../support/db';
import type { Person } from '../support/fixtures';
import { searchChecked } from '../support/search';
import { actAs } from '../support/session';

// Points 4 and 6 of docs/reste-a-faire.md. The author of a document (MET-10) is a person of the group, by default its
// creator, or a free text for an external author, chosen at creation and in the metadata, and the record, the search
// facet and the CSV export all show the same one. A template (FRM) is linked to the types it is meant for, by its owner
// or a records manager, journaled; « Nouveau depuis un modèle » offers it first for these types.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const t = DICT.fr;
const TPL = 'FRM-QMS-001';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function create(who: Person, fields: Record<string, string>) {
  actAs(who);
  return createDocument(form({ title: 'Procédure', typeCode: 'PRO', department: 'QUA', ...fields }));
}

async function saveMeta(who: Person, id: string, fields: Record<string, string>) {
  actAs(who);
  return updateMeta(form({ docId: id, version: (await viewOf(db(), id)).version, ...fields }));
}

async function linkTypes(who: Person, codes: string[], id = TPL) {
  actAs(who);
  return setTemplateTypes(id, codes, Number((await viewOf(db(), id)).version));
}

const lastDoc = async () => (await db().select().from(s.documents).orderBy(desc(s.documents.createdAt), desc(s.documents.id)).limit(1))[0];
const linksOf = async (id = TPL) => (await db().select().from(s.templateTypes).where(eq(s.templateTypes.docId, id)).orderBy(asc(s.templateTypes.typeCode))).map((x) => x.typeCode);

describe('author of a document (MET-10)', () => {
  it('is the creator by default, another person or an external author when chosen', async () => {
    expect(await create('writer', {})).toMatchObject({ ok: true });
    expect(await lastDoc()).toMatchObject({ authorId: 'writer', authorText: null });

    expect(await create('writer', { title: 'Pour le chef', authorKind: 'person', authorId: 'head' })).toMatchObject({ ok: true });
    expect(await lastDoc()).toMatchObject({ title: 'Pour le chef', authorId: 'head', authorText: null });

    // A person chosen, then switched to an external author: the list's value is not taken.
    expect(await create('writer', { title: 'Externe', authorKind: 'text', authorId: '__external', authorText: 'Bureau Tartempion' })).toMatchObject({ ok: true });
    expect(await lastDoc()).toMatchObject({ title: 'Externe', authorId: null, authorText: 'Bureau Tartempion' });
  });

  it('refuses an empty choice, a system actor, an unknown person or a text too long, and writes nothing', async () => {
    expect(await create('writer', { authorKind: 'text', authorText: '  ' })).toEqual({ ok: false, error: t.author_required, field: 'authorText' });
    expect(await create('writer', { authorKind: 'person', authorId: '' })).toEqual({ ok: false, error: t.author_required, field: 'authorId' });
    expect(await create('writer', { authorKind: 'person', authorId: 'vigie' })).toEqual({ ok: false, error: t.author_unknown, field: 'authorId' });
    expect(await create('writer', { authorKind: 'person', authorId: 'nobody' })).toEqual({ ok: false, error: t.author_unknown, field: 'authorId' });
    expect(await create('writer', { authorKind: 'text', authorText: 'x'.repeat(201) })).toMatchObject({ ok: false, field: 'authorText' });
    expect(await db().select().from(s.documents)).toEqual([]);
  });

  it('changes in the metadata, one kind replacing the other, journaled, and is kept by an edit that does not send it', async () => {
    const ID = 'PRO-QUA-0001';
    await addDoc(db(), { id: ID });
    expect(await saveMeta('owner', ID, { authorKind: 'text', authorText: 'Cabinet Durand' })).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ authorId: null, authorText: 'Cabinet Durand' });
    // An edit that does not send the author leaves it as it is.
    expect(await saveMeta('owner', ID, { title: 'Nouveau titre' })).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ authorId: null, authorText: 'Cabinet Durand' });
    expect(await saveMeta('owner', ID, { authorKind: 'person', authorId: 'writer2', authorText: 'Cabinet Durand' })).toMatchObject({ ok: true });
    expect(await getDoc(db(), ID)).toMatchObject({ authorId: 'writer2', authorText: null });

    const edits = (await journalOf(db(), ID)).filter((e) => e.action === 'edit');
    expect(edits[0].data?.changes).toEqual([{ field: 'authorId', before: 'owner', after: null }, { field: 'authorText', before: null, after: 'Cabinet Durand' }]);
    expect(edits.at(-1)?.data?.changes).toEqual([{ field: 'authorId', before: null, after: 'writer2' }, { field: 'authorText', before: 'Cabinet Durand', after: null }]);
    actAs('manager');
    expect(auditDetailL(await getCtx(), edits.at(-1)!)).toContain('Auteur : — → writer2');
  });

  it('is the same on the record, in the author facet and in the CSV export', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002' });
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    await saveMeta('owner', 'PRO-QUA-0002', { authorKind: 'person', authorId: 'head' });
    await saveMeta('owner', 'PRO-QUA-0003', { authorKind: 'text', authorText: 'Apave' });
    actAs('auditor');
    const ctx = await getCtx();
    const all = await searchChecked(ctx, {});
    expect(Object.fromEntries(all.results.map((d) => [d.id, d.author]))).toEqual({ 'PRO-QUA-0001': 'owner', 'PRO-QUA-0002': 'head', 'PRO-QUA-0003': 'Apave' });
    expect((await searchChecked(ctx, { facets: { author: ['head'] } })).results.map((d) => d.id)).toEqual(['PRO-QUA-0002']);
    expect((await searchChecked(ctx, { facets: { author: ['Apave'] } })).results.map((d) => d.id)).toEqual(['PRO-QUA-0003']);

    const res = await GET(new Request(`http://codex${searchHref({ sort: 'title' }, '/api/export/search')}`));
    const [head, ...rows] = (await res.text()).replace(/^﻿/, '').split('\r\n').filter(Boolean).map((l) => l.split(';'));
    const col = head.indexOf(t.author_label);
    expect(col).toBe(head.indexOf(t.owner) + 1);
    expect(Object.fromEntries(rows.map((r) => [r[0], r[col]]))).toEqual({ 'PRO-QUA-0001': 'owner', 'PRO-QUA-0002': 'head', 'PRO-QUA-0003': 'Apave' });
  });
});

describe('templates linked to document types (FON-12)', () => {
  it('are linked by the template’s owner or a records manager, journaled, the record’s version raised', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    const before = (await getDoc(db(), TPL)).version;
    expect(await linkTypes('owner', ['PRO', 'COR', 'PRO'])).toEqual({ ok: true, message: t.saved_ok });
    expect(await linksOf()).toEqual(['COR', 'PRO']);
    expect((await getDoc(db(), TPL)).version).toBe(before + 1);
    expect(await linkTypes('manager', ['PRO'])).toMatchObject({ ok: true });
    expect(await linksOf()).toEqual(['PRO']);
    // Saving the same types writes nothing.
    expect(await linkTypes('manager', ['PRO'])).toMatchObject({ ok: true });

    const edits = (await journalOf(db(), TPL)).filter((e) => e.action === 'edit');
    expect(edits.map((e) => [e.userId, e.data?.changes])).toEqual([
      ['owner', [{ field: 'templateTypes', before: null, after: ['COR', 'PRO'] }]],
      ['manager', [{ field: 'templateTypes', before: ['COR', 'PRO'], after: ['PRO'] }]],
    ]);
    expect(auditDetailL(await getCtx(), edits[1])).toBe('A · Types cibles : COR, PRO → PRO');
  });

  it('are refused to anyone else, on a document that is not a template, an unknown type, a locked record or an outdated view', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    expect(await linkTypes('writer', ['PRO'])).toEqual({ ok: false, error: t.not_allowed });
    expect(await linkTypes('auditor', ['PRO'])).toEqual({ ok: false, error: `${t.not_allowed} : ${t.perm_edit}` });
    expect(await linkTypes('owner', ['PRO'], 'PRO-QUA-0001')).toEqual({ ok: false, error: t.template_only });
    expect(await linkTypes('owner', ['XYZ'])).toEqual({ ok: false, error: `${t.template_type_unknown} : XYZ` });
    actAs('owner');
    expect(await setTemplateTypes(TPL, ['PRO'], 0)).toMatchObject({ ok: false, stale: true });
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, TPL));
    expect(await linkTypes('manager', ['PRO'])).toEqual({ ok: false, error: t.locked_hold });
    expect(await linksOf()).toEqual([]);
    expect((await journalOf(db(), TPL)).filter((e) => e.action === 'edit')).toEqual([]);
  });

  it('keep an inactive type where it is set, never add one', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    expect(await linkTypes('owner', ['COR'])).toMatchObject({ ok: true });
    await db().update(s.docTypes).set({ active: false }).where(eq(s.docTypes.code, 'COR'));
    expect(await linkTypes('owner', ['COR', 'PRO'])).toMatchObject({ ok: true });
    expect(await linksOf()).toEqual(['COR', 'PRO']);
    await db().update(s.docTypes).set({ active: false }).where(eq(s.docTypes.code, 'PID'));
    expect(await linkTypes('owner', ['PID'])).toEqual({ ok: false, error: `${t.template_type_unknown} : PID` });
  });

  it('are listed with the templates, make their types in use in the register, and are dropped when the document is no longer a template', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    await addDoc(db(), { id: 'FRM-QMS-002', typeCode: 'FRM' });
    await linkTypes('owner', ['COR', 'PRO']);
    actAs('writer');
    expect(Object.fromEntries((await listTemplates(await getCtx())).map((x) => [x.id, x.types]))).toEqual({ [TPL]: ['PRO', 'COR'], 'FRM-QMS-002': [] });
    // A type a template is meant for is in use: it cannot be deleted, only made inactive.
    expect((await registryUsage()).types.has('COR')).toBe(true);
    actAs('manager');
    expect(await deleteType('COR')).toEqual({ ok: false, error: t.reg_type_in_use });

    expect(await saveMeta('owner', TPL, { typeCode: 'PRO' })).toMatchObject({ ok: true });
    expect(await linksOf()).toEqual([]);
    const [e] = (await journalOf(db(), TPL)).filter((x) => x.action === 'edit').slice(-1);
    expect(e.data?.changes).toContainEqual({ field: 'templateTypes', before: ['COR', 'PRO'], after: null });
  });

  it('a template meant for other types may still be used for any type (offered among the other templates)', async () => {
    await addDoc(db(), { id: TPL, typeCode: 'FRM' });
    await linkTypes('owner', ['COR']);
    expect(await create('writer', { templateId: TPL })).toMatchObject({ ok: true });
    expect((await lastDoc()).typeCode).toBe('PRO');
  });
});
