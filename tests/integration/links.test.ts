import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { addDocLink, removeDocLink, requestChange, simulateVigieDecision, updateMeta } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { applyChangeDecision, applyPendingDecision, approveRevision } from '@/lib/lifecycle';
import { listAudit, listChangeRequests, listDocLinks } from '@/lib/queries';
import { addDoc, fixClock, getChange, getDoc, getRevision, journalOf, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Links between documents (point 16 of docs/reste-a-faire.md, docs/modele-cible.md §4): a withdrawal request may propose
// the replacement, which becomes « remplacé par » once Vigie's acceptance applies (D-17), if it still may; the owner of
// both documents or a records manager links them from a record. One link per pair, journaled on both ends; a legal hold
// on either freezes it; a linked document the reader may not read is not shown, nor is the journal entry naming it
// (D-14); a reclassification carries the links along.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

// No Vigie endpoint: decisions are simulated from Codex (lib/vigie.ts, vigieSimulated).
beforeAll(() => {
  vi.stubEnv('VIGIE_API_URL', '');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const t = DICT.fr;
const OLD = 'PRO-QUA-0001';
const NEW = 'PRO-QUA-0002';
const ECO = 'ECO-2026-030';

/** `who` asks Vigie to withdraw `docId`, proposing `replacement`. */
function withdraw(who: Person, docId: string, replacement: string | null) {
  actAs(who);
  return requestChange(docId, 'obsolescence', 'Remplacée', '', replacement);
}

/** The request on `docId` (one per document in these tests). */
async function pendingRequest(docId: string) {
  const [row] = await db().select().from(s.changeRequests).where(eq(s.changeRequests.docId, docId));
  return row;
}

const decide = (id: string, accepted: boolean, eco = ECO) => db().transaction((tx) => applyChangeDecision(tx, id, { accepted, ecoRef: accepted ? eco : null }, 'vigie'));

const hold = (id: string, on: boolean) => db().update(s.documents).set({ legalHold: on }).where(eq(s.documents.id, id));

const links = () => db().select({ sourceId: s.documentLinks.sourceId, targetId: s.documentLinks.targetId, kind: s.documentLinks.kind }).from(s.documentLinks);

/** The links of `docId` as `who` sees them on its record: [what it is to the other, the other]. */
async function seenLinks(who: Person, docId: string) {
  actAs(who);
  return (await listDocLinks(await getCtx(), docId)).map((l) => [l.rel, l.doc.id]);
}

/** Journal entries of `docId` about links, as `who` reads them on its record. */
async function linkEntries(who: Person, docId: string) {
  actAs(who);
  return (await listAudit(await getCtx(), { docId })).filter((e) => ['link', 'unlink', 'link_skipped'].includes(e.action)).map((e) => [e.action, e.detail]);
}

/** Puts the draft revision A of `docId` in force, as its last approval does. */
async function approveA(docId: string) {
  const a = await getRevision(db(), docId, 'A');
  await db().update(s.revisions).set({ status: 'in_review' }).where(eq(s.revisions.id, a.id));
  await db().transaction((tx) => approveRevision(tx, a.id));
}

describe('replacement proposed with a withdrawal request', () => {
  it('is kept on the request, and becomes « remplacé par » once Vigie accepts the withdrawal', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, ownerId: 'writer' });
    expect(await withdraw('writer', OLD, NEW)).toMatchObject({ ok: true });
    const req = await pendingRequest(OLD);
    expect(req).toMatchObject({ kind: 'obsolescence', status: 'submitted', replacementId: NEW });
    // Nothing is linked while Vigie has not decided: the document is still in force.
    expect(await links()).toEqual([]);

    actAs('manager');
    expect(await simulateVigieDecision(req.id, true, null)).toEqual({ ok: true });
    expect(await getDoc(db(), OLD)).toMatchObject({ state: 'obsolete' });
    expect(await links()).toEqual([{ sourceId: NEW, targetId: OLD, kind: 'replaces' }]);
    // Journaled on both documents, by Vigie, with its change order, about the documents as a whole.
    const onOld = (await journalOf(db(), OLD)).at(-1);
    expect(onOld).toMatchObject({ userId: 'vigie', action: 'link', detail: req.id.replace('ECR', 'ECO'), revisionId: null, data: { link: { rel: 'replaced_by', other: NEW } } });
    expect((await journalOf(db(), NEW)).at(-1)).toMatchObject({ userId: 'vigie', action: 'link', data: { link: { rel: 'replaces', other: OLD } } });
    // Read from either record, by a reader of both.
    expect(await seenLinks('auditor', OLD)).toEqual([['replaced_by', NEW]]);
    expect(await seenLinks('auditor', NEW)).toEqual([['replaces', OLD]]);
    expect(await linkEntries('auditor', OLD)).toEqual([['link', `${req.id.replace('ECR', 'ECO')} · ${t.link_replaced_by} ${NEW}`]]);

    // The owner of the replacement does not take « remplacé par » off a withdrawn document that is not theirs.
    const [link] = await db().select().from(s.documentLinks);
    actAs('writer');
    expect(await removeDocLink(NEW, link.id)).toEqual({ ok: false, error: t.link_reserved });
    actAs('owner');
    expect(await removeDocLink(OLD, link.id)).toEqual({ ok: false, error: t.link_reserved });
    expect(await seenLinks('auditor', OLD)).toEqual([['replaced_by', NEW]]);
  });

  it('links nothing when Vigie refuses the withdrawal', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    await withdraw('writer', OLD, NEW);
    expect(await decide((await pendingRequest(OLD)).id, false)).toEqual({ status: 'rejected' });
    expect(await links()).toEqual([]);
    expect(await getDoc(db(), OLD)).toMatchObject({ state: 'active' });
  });

  it('links once the acceptance applies, when it waited for a legal hold to be released', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    await withdraw('writer', OLD, NEW);
    await db().update(s.documents).set({ legalHold: true }).where(eq(s.documents.id, OLD));
    const id = (await pendingRequest(OLD)).id;
    expect(await decide(id, true)).toMatchObject({ status: 'accepted' });
    expect(await links()).toEqual([]);
    await db().transaction(async (tx) => {
      await tx.update(s.documents).set({ legalHold: false }).where(eq(s.documents.id, OLD));
      await applyPendingDecision(tx, OLD);
    });
    expect((await getChange(db(), id)).status).toBe('implemented');
    expect(await links()).toEqual([{ sourceId: NEW, targetId: OLD, kind: 'replaces' }]);
  });

  it('turns a « voir aussi » link between the two into « remplace », journaled', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    actAs('owner');
    expect(await addDocLink(OLD, 'see_also', NEW)).toEqual({ ok: true, message: t.link_added });
    await withdraw('writer', OLD, NEW);
    await decide((await pendingRequest(OLD)).id, true);
    expect(await links()).toEqual([{ sourceId: NEW, targetId: OLD, kind: 'replaces' }]);
    expect((await journalOf(db(), OLD)).filter((e) => e.userId === 'vigie' && e.data?.link).map((e) => [e.action, e.data!.link!.rel])).toEqual([['unlink', 'see_also'], ['link', 'replaced_by']]);
  });

  it('touches no link when the replacement is under legal hold as the withdrawal applies, and says so on the withdrawn one', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    actAs('owner');
    expect(await addDocLink(OLD, 'see_also', NEW)).toMatchObject({ ok: true });
    await withdraw('owner', OLD, NEW);
    await hold(NEW, true);
    const before = (await journalOf(db(), NEW)).length;
    await decide((await pendingRequest(OLD)).id, true);
    expect(await getDoc(db(), OLD)).toMatchObject({ state: 'obsolete' });
    // The « voir aussi » of the frozen document stays, and nothing is written about it on its journal.
    expect(await links()).toEqual([{ sourceId: OLD, targetId: NEW, kind: 'see_also' }]);
    expect(await journalOf(db(), NEW)).toHaveLength(before);
    expect((await journalOf(db(), OLD)).at(-1)).toMatchObject({ userId: 'vigie', action: 'link_skipped', detail: ECO, data: { link: { rel: 'replaced_by', other: NEW, skipped: 'hold' } } });
    expect((await linkEntries('auditor', OLD))[0]).toEqual(['link_skipped', `${ECO} · ${t.link_replaced_by} ${NEW} : ${t.link_skip_hold}`]);
    expect(await seenLinks('auditor', OLD)).toEqual([['see_also', NEW]]);
  });

  it('checks the replacement again when the withdrawal applies: one withdrawn since is not linked, and the journal says so', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    // Two crossed requests, each proposing a document then active.
    expect(await withdraw('owner', OLD, NEW)).toMatchObject({ ok: true });
    expect(await withdraw('owner', NEW, OLD)).toMatchObject({ ok: true });
    await decide((await pendingRequest(NEW)).id, true, 'ECO-2026-031');
    expect(await links()).toEqual([{ sourceId: OLD, targetId: NEW, kind: 'replaces' }]);
    await decide((await pendingRequest(OLD)).id, true, 'ECO-2026-032');
    expect(await getDoc(db(), OLD)).toMatchObject({ state: 'obsolete' });
    // NEW is obsolete: it replaces nothing, and the link already there is not reversed.
    expect(await links()).toEqual([{ sourceId: OLD, targetId: NEW, kind: 'replaces' }]);
    expect((await journalOf(db(), OLD)).at(-1)).toMatchObject({ userId: 'vigie', action: 'link_skipped', data: { link: { rel: 'replaced_by', other: NEW, skipped: 'inactive' } } });
    expect((await linkEntries('auditor', OLD))[0]).toEqual(['link_skipped', `ECO-2026-032 · ${t.link_replaced_by} ${NEW} : ${t.link_skip_inactive}`]);
    expect(await seenLinks('auditor', OLD)).toEqual([['replaces', NEW]]);
  });

  it('does not link a replacement archived before the acceptance', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    await withdraw('owner', OLD, NEW);
    await db().update(s.documents).set({ state: 'archived', archivedAt: '2026-10-05' }).where(eq(s.documents.id, NEW));
    await decide((await pendingRequest(OLD)).id, true);
    expect(await links()).toEqual([]);
    expect((await journalOf(db(), OLD)).at(-1)).toMatchObject({ action: 'link_skipped', data: { link: { skipped: 'inactive' } } });
  });

  it('refuses a replacement the requester may not read as one that does not exist, an inactive one, the document itself', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, conf: 'tres_confidentiel' }); // writer is no named reader
    await addDoc(db(), { id: 'PRO-QUA-0003', state: 'obsolete' });
    const notFound = { ok: false, error: t.replacement_not_found, field: 'replacement' };
    expect(await withdraw('writer', OLD, NEW)).toEqual(notFound);
    expect(await withdraw('writer', OLD, 'PRO-QUA-0099')).toEqual(notFound);
    expect(await withdraw('writer', OLD, 'PRO-QUA-0003')).toEqual({ ok: false, error: t.replacement_inactive, field: 'replacement' });
    expect(await withdraw('writer', OLD, OLD)).toEqual({ ok: false, error: t.link_self, field: 'replacement' });
    // A change request carries no replacement.
    actAs('writer');
    expect(await requestChange(OLD, 'modification', 'r', '', 'PRO-QUA-0003')).toEqual({ ok: false, error: t.error });
    expect(await db().select().from(s.changeRequests)).toEqual([]);
    // The owner of the confidential document, who reads it, may propose it.
    expect(await withdraw('owner', OLD, NEW)).toMatchObject({ ok: true });
  });
});

describe('a draft replacement stays within its drafting circle (D-14)', () => {
  /** OLD in force, withdrawn by Vigie and replaced by NEW, a draft of writer2 never in force. */
  async function replacedByDraft() {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, ownerId: 'writer2', revisions: [{ letter: 'A', status: 'draft', versions: ['writer2'] }] });
    expect(await withdraw('writer2', OLD, NEW)).toMatchObject({ ok: true });
    await decide((await pendingRequest(OLD)).id, true);
  }

  it('hides the link, the proposal and its journal entries from a reader outside that circle, until it is in force', async () => {
    await replacedByDraft();
    expect(await seenLinks('auditor', OLD)).toEqual([]);
    expect(await seenLinks('writer2', OLD)).toEqual([['replaced_by', NEW]]);
    expect(await seenLinks('manager', OLD)).toEqual([['replaced_by', NEW]]);
    actAs('auditor');
    expect((await listChangeRequests(await getCtx(), { docId: OLD }))[0].replacement).toBeNull();
    actAs('writer2');
    expect((await listChangeRequests(await getCtx(), { docId: OLD }))[0].replacement).toMatchObject({ id: NEW, href: `/documents/${NEW}` });
    expect(await linkEntries('auditor', OLD)).toEqual([]);
    expect(await linkEntries('manager', OLD)).toHaveLength(1);

    await approveA(NEW);
    expect(await seenLinks('auditor', OLD)).toEqual([['replaced_by', NEW]]);
    expect(await linkEntries('auditor', OLD)).toHaveLength(1);
  });

  it('carries the link and the proposal along when the replacement is reclassified', async () => {
    await replacedByDraft();
    actAs('writer2');
    const fd = new FormData();
    fd.set('docId', NEW);
    fd.set('department', 'ING');
    expect(await updateMeta(fd)).toMatchObject({ ok: true, message: `${t.act_reclass} : PRO-ING-0001` });
    expect(await links()).toEqual([{ sourceId: 'PRO-ING-0001', targetId: OLD, kind: 'replaces' }]);
    expect((await pendingRequest(OLD)).replacementId).toBe('PRO-ING-0001');
    expect(await seenLinks('writer2', OLD)).toEqual([['replaced_by', 'PRO-ING-0001']]);
    // The journal keeps the ID of the time, which still resolves to the reclassified document.
    expect(await linkEntries('writer2', OLD)).toEqual([['link', `${ECO} · ${t.link_replaced_by} ${NEW}`]]);
    expect(await linkEntries('auditor', OLD)).toEqual([]);
  });
});

describe('links from the record', () => {
  it('lets the owner of both say a withdrawn document is « remplacé par » another, journaled on both', async () => {
    await addDoc(db(), { id: OLD, state: 'obsolete' });
    await addDoc(db(), { id: NEW });
    actAs('owner');
    expect(await addDocLink(OLD, 'replaced_by', NEW)).toEqual({ ok: true, message: t.link_added });
    expect(await links()).toEqual([{ sourceId: NEW, targetId: OLD, kind: 'replaces' }]);
    expect((await journalOf(db(), OLD)).at(-1)).toMatchObject({ userId: 'owner', action: 'link', revisionId: null, data: { link: { rel: 'replaced_by', other: NEW } } });
    expect((await journalOf(db(), NEW)).at(-1)).toMatchObject({ userId: 'owner', action: 'link', data: { link: { rel: 'replaces', other: OLD } } });
    // The same link, whichever end asks again, in whichever direction: one link per pair.
    expect(await addDocLink(NEW, 'replaces', OLD)).toEqual({ ok: false, error: t.link_exists, field: 'other' });
    expect(await addDocLink(NEW, 'see_also', OLD)).toEqual({ ok: false, error: t.link_exists, field: 'other' });
    // And removes it from either record.
    const [link] = await db().select().from(s.documentLinks);
    expect(await removeDocLink(NEW, link.id)).toEqual({ ok: true, message: t.link_removed });
    expect(await links()).toEqual([]);
  });

  it('does not let the owner of one document write « remplacé par » in the band of another one’s withdrawn document', async () => {
    await addDoc(db(), { id: OLD, state: 'obsolete' });
    await addDoc(db(), { id: NEW, ownerId: 'writer' });
    actAs('writer'); // owns NEW, active; OLD, withdrawn, is owner's
    expect(await addDocLink(NEW, 'replaces', OLD)).toEqual({ ok: false, error: t.link_reserved, field: 'other' });
    actAs('owner');
    expect(await addDocLink(OLD, 'replaced_by', NEW)).toEqual({ ok: false, error: t.link_reserved, field: 'other' });
    expect(await links()).toEqual([]);
    actAs('manager');
    expect(await addDocLink(OLD, 'replaced_by', NEW)).toEqual({ ok: true, message: t.link_added });
  });

  it('replaces only a document Vigie withdrew (D-17), by an active one', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    actAs('owner');
    expect(await addDocLink(OLD, 'replaces', NEW)).toEqual({ ok: false, error: t.link_not_withdrawn, field: 'rel' });
    expect(await addDocLink(OLD, 'replaced_by', NEW)).toEqual({ ok: false, error: t.link_not_withdrawn, field: 'rel' });
    expect(await addDocLink(OLD, 'see_also', NEW)).toMatchObject({ ok: true });
    // An obsolete or archived document replaces nothing, as in a withdrawal request.
    await addDoc(db(), { id: 'PRO-QUA-0003', state: 'obsolete' });
    await addDoc(db(), { id: 'PRO-QUA-0004', state: 'archived' });
    expect(await addDocLink('PRO-QUA-0003', 'replaced_by', 'PRO-QUA-0004')).toEqual({ ok: false, error: t.link_replacer_inactive, field: 'other' });
    expect(await addDocLink('PRO-QUA-0004', 'replaces', 'PRO-QUA-0003')).toEqual({ ok: false, error: t.link_replacer_inactive, field: 'rel' });
    expect(await addDocLink('PRO-QUA-0003', 'see_also', 'PRO-QUA-0004')).toMatchObject({ ok: true });
  });

  it('is reserved to the owner of both documents and records managers, with the edit permission, on documents they may read', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, ownerId: 'writer' });
    await addDoc(db(), { id: 'PRO-QUA-0003', conf: 'tres_confidentiel' });
    actAs('writer'); // owns NEW, not OLD
    expect(await addDocLink(OLD, 'see_also', NEW)).toEqual({ ok: false, error: t.link_reserved });
    actAs('owner', 'auditeur'); // no edit permission
    expect(await addDocLink(OLD, 'see_also', NEW)).toMatchObject({ ok: false, error: `${t.not_allowed} : ${t.perm_edit}` });
    actAs('writer');
    const notFound = { ok: false, error: t.link_not_found, field: 'other' };
    expect(await addDocLink(NEW, 'see_also', 'PRO-QUA-0003')).toEqual(notFound);
    expect(await addDocLink(NEW, 'see_also', 'PRO-QUA-0099')).toEqual(notFound);
    expect(await addDocLink(NEW, 'see_also', NEW)).toEqual({ ok: false, error: t.link_self, field: 'other' });
    expect(await addDocLink(NEW, 'related', OLD)).toEqual({ ok: false, error: t.error });
    // From their own record, towards a document of someone else: not theirs to link either.
    expect(await addDocLink(NEW, 'see_also', OLD)).toEqual({ ok: false, error: t.link_reserved, field: 'other' });
    expect(await links()).toEqual([]);
    actAs('manager');
    expect(await addDocLink(OLD, 'see_also', 'PRO-QUA-0003')).toMatchObject({ ok: true });
    expect(await links()).toEqual([{ sourceId: OLD, targetId: 'PRO-QUA-0003', kind: 'see_also' }]);
  });

  it('freezes the links of a document under legal hold, at either end, to add and to remove', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, legalHold: true });
    actAs('owner');
    const frozen = { ok: false, error: t.link_hold };
    expect(await addDocLink(OLD, 'see_also', NEW)).toEqual(frozen);
    await hold(NEW, false);
    await hold(OLD, true);
    expect(await addDocLink(OLD, 'see_also', NEW)).toEqual(frozen);
    expect(await addDocLink(NEW, 'see_also', OLD)).toEqual(frozen);
    expect(await links()).toEqual([]);

    await hold(OLD, false);
    expect(await addDocLink(OLD, 'see_also', NEW)).toMatchObject({ ok: true });
    const [link] = await db().select().from(s.documentLinks);
    for (const id of [OLD, NEW]) {
      await hold(id, true);
      for (const from of [OLD, NEW]) expect(await removeDocLink(from, link.id), `${id} frozen, from ${from}`).toEqual(frozen);
      await hold(id, false);
    }
    actAs('manager');
    await hold(NEW, true);
    expect(await removeDocLink(OLD, link.id)).toEqual(frozen);
    expect(await links()).toEqual([{ sourceId: OLD, targetId: NEW, kind: 'see_also' }]);
  });

  it('removes a link from either record, with the rights on both, journaled on both; a link the user may not see answers as missing', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW, ownerId: 'writer' });
    await addDoc(db(), { id: 'PRO-QUA-0003', conf: 'tres_confidentiel', ownerId: 'head' });
    actAs('manager');
    await addDocLink(OLD, 'see_also', NEW);
    await addDocLink(OLD, 'see_also', 'PRO-QUA-0003');
    const [toNew, toSecret] = await db().select().from(s.documentLinks).orderBy(s.documentLinks.id);

    actAs('writer'); // owns NEW, not OLD
    expect(await removeDocLink(OLD, toNew.id)).toEqual({ ok: false, error: t.link_reserved });
    expect(await removeDocLink(NEW, toNew.id)).toEqual({ ok: false, error: t.link_reserved });
    expect(await removeDocLink('PRO-QUA-0003', toSecret.id)).toEqual({ ok: false, error: t.not_found });
    expect(await removeDocLink(NEW, toSecret.id)).toEqual({ ok: false, error: t.link_not_found });
    actAs('owner'); // owns OLD, not NEW, may not read PRO-QUA-0003
    expect(await removeDocLink(OLD, toNew.id)).toEqual({ ok: false, error: t.link_reserved });
    expect(await removeDocLink(OLD, toSecret.id)).toEqual({ ok: false, error: t.link_not_found });
    expect(await seenLinks('owner', OLD)).toEqual([['see_also', NEW]]);

    actAs('manager');
    expect(await removeDocLink(NEW, toNew.id)).toEqual({ ok: true, message: t.link_removed });
    expect(await links()).toEqual([{ sourceId: OLD, targetId: 'PRO-QUA-0003', kind: 'see_also' }]);
    expect((await journalOf(db(), OLD)).at(-1)).toMatchObject({ userId: 'manager', action: 'unlink', data: { link: { rel: 'see_also', other: NEW } } });
    expect((await journalOf(db(), NEW)).at(-1)).toMatchObject({ userId: 'manager', action: 'unlink', data: { link: { rel: 'see_also', other: OLD } } });
    expect(await removeDocLink(NEW, toNew.id)).toEqual({ ok: false, error: t.link_not_found });
    // The trace of the link to the document the owner may not read is not theirs to read either.
    expect(await linkEntries('owner', OLD)).toEqual([['unlink', `${t.link_see_also} ${NEW}`], ['link', `${t.link_see_also} ${NEW}`]]);
  });
});

describe('the database keeps one link per pair of distinct documents', () => {
  const insert = (sourceId: string, targetId: string, kind: 'replaces' | 'see_also' = 'see_also') =>
    db().insert(s.documentLinks).values({ sourceId, targetId, kind, createdBy: 'owner', createdAt: '2026-10-10' });

  it('refuses a link to itself, a second link in either direction, an unknown kind', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    await expect(insert(OLD, OLD)).rejects.toThrow();
    await insert(OLD, NEW);
    await expect(insert(OLD, NEW, 'replaces')).rejects.toThrow();
    await expect(insert(NEW, OLD)).rejects.toThrow();
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    await expect(db().insert(s.documentLinks).values({ sourceId: NEW, targetId: 'PRO-QUA-0003', kind: 'annexe' as 'see_also', createdBy: 'owner', createdAt: '2026-10-10' })).rejects.toThrow();
    expect(await links()).toHaveLength(1);
  });

  it('keeps a replacement on withdrawal requests only, never the document itself', async () => {
    await addDoc(db(), { id: OLD });
    await addDoc(db(), { id: NEW });
    const row = { docId: OLD, requesterId: 'owner', reason: 'r', status: 'submitted' as const, createdAt: '2026-10-10 10:00:00' };
    await expect(db().insert(s.changeRequests).values({ ...row, id: 'ECR-2026-901', kind: 'modification', replacementId: NEW })).rejects.toThrow();
    await expect(db().insert(s.changeRequests).values({ ...row, id: 'ECR-2026-902', kind: 'obsolescence', replacementId: OLD })).rejects.toThrow();
    await db().insert(s.changeRequests).values({ ...row, id: 'ECR-2026-903', kind: 'obsolescence', replacementId: NEW });
  });
});
