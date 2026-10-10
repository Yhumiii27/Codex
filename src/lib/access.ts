import 'server-only';
import { cache } from 'react';
import { inArray } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import type { Conf } from '@/db/schema';
import { TEMPLATE_TYPE } from './codes';
import type { Ctx } from './context';

// Who sees what (docs/modele-cible.md §5).

type AccessDoc = { id: string; ownerId: string; department: string; projectCode: string | null; conf: string; state: string; revInForce: string | null };
type Q = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** The person whose access is checked: the simulated user, or another person (default modifier of an accepted ECO). */
export type Viewer = Pick<Ctx, 'user' | 'seesAll' | 'can'>;

/**
 * People around each document: named readers, designated authors of open revisions, approvers of running workflows,
 * project teams. Built from `q` (a transaction inside lib/lifecycle.ts); getAccessIndex() caches it per request.
 */
export async function buildAccessIndex(q: Q) {
  const [readers, revs, wfs, steps, holders, projects] = await Promise.all([
    q.select().from(s.documentReaders),
    q.select({ docId: s.revisions.docId, modifierId: s.revisions.modifierId, status: s.revisions.status }).from(s.revisions).where(inArray(s.revisions.status, ['draft', 'in_review', 'approved'])),
    q.select().from(s.workflows),
    q.select({ workflowId: s.workflowSteps.workflowId, idx: s.workflowSteps.idx, assigneeId: s.workflowSteps.assigneeId }).from(s.workflowSteps),
    q.select().from(s.functionHolders),
    q.select({ code: s.projects.code, managerId: s.projects.managerId }).from(s.projects),
  ]);
  const add = (m: Map<string, Set<string>>, k: string, v: string | null) => { if (!v) return; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };
  const readersBy = new Map<string, Set<string>>(), modifiersBy = new Map<string, Set<string>>(), approversBy = new Map<string, Set<string>>(), teamBy = new Map<string, Set<string>>();
  readers.forEach((r) => add(readersBy, r.docId, r.userId));
  revs.forEach((r) => add(modifiersBy, r.docId, r.modifierId));
  for (const w of wfs) {
    const ws = steps.filter((x) => x.workflowId === w.id);
    if (w.outcome || w.step >= ws.length) continue; // finished or rejected workflows no longer open drafts to their approvers
    ws.forEach((x) => add(approversBy, w.docId, x.assigneeId));
  }
  projects.forEach((p) => add(teamBy, p.code, p.managerId));
  holders.filter((h) => h.scopeValue && projects.some((p) => p.code === h.scopeValue)).forEach((h) => add(teamBy, h.scopeValue!, h.userId));
  const none = new Set<string>();
  return {
    readers: (docId: string) => readersBy.get(docId) ?? none,
    modifiers: (docId: string) => modifiersBy.get(docId) ?? none,
    approvers: (docId: string) => approversBy.get(docId) ?? none,
    team: (projectCode: string | null) => (projectCode ? teamBy.get(projectCode) ?? none : none),
  };
}
export type AccessIndex = Awaited<ReturnType<typeof buildAccessIndex>>;

export const getAccessIndex = cache(async () => buildAccessIndex(await getDb()));

/** Owner, designated author, current approvers and records managers: they see drafts and working versions. */
export function inDraftingCircle(ctx: Viewer, d: AccessDoc, ix: AccessIndex): boolean {
  const me = ctx.user.id;
  return ctx.seesAll || d.ownerId === me || ix.modifiers(d.id).has(me) || ix.approvers(d.id).has(me);
}

/** Named readers count for confidential and highly confidential documents only. */
export function readersApply(conf: string): boolean {
  return conf === 'confidentiel' || conf === 'tres_confidentiel';
}

/**
 * Can the user see the document at all (its revision in force, or its drafts if they belong to the drafting circle)?
 * Outside the drafting circle, the "read" permission of the matrix is required as well.
 */
export function canRead(ctx: Viewer, d: AccessDoc, ix: AccessIndex): boolean {
  if (inDraftingCircle(ctx, d, ix)) return true;
  if (!ctx.can('read')) return false;
  const me = ctx.user.id;
  // A document that never entered into force is a draft: only its drafting circle sees it.
  if (!d.revInForce) return false;
  switch (d.conf as Conf) {
    case 'public':
    case 'restreint':
    case 'interne':
      return true;
    case 'confidentiel':
      return ctx.user.department === d.department || ix.team(d.projectCode).has(me) || ix.readers(d.id).has(me);
    case 'tres_confidentiel':
      return ix.readers(d.id).has(me);
    default:
      return false;
  }
}

/** A template offered by "Nouveau depuis un modèle" and accepted by createDocument: FRM in force, active, visible. */
export function isUsableTemplate(ctx: Viewer, d: AccessDoc & { typeCode: string }, ix: AccessIndex): boolean {
  return d.typeCode === TEMPLATE_TYPE && !!d.revInForce && d.state === 'active' && canRead(ctx, d, ix);
}

/** Outside the drafting circle, only the final file of the revision in force is served or listed (§5). */
export function readerMaySeeVersion(circle: boolean, revStatus: string, isFinal: boolean): boolean {
  return circle || (revStatus === 'in_force' && isFinal);
}

/**
 * Revisions every reader of the document sees: the one in force and those it replaced. A draft, a revision under review
 * or waiting for its effective date, and a cancelled one belong to the drafting circle (D-14): outside it, they do not
 * exist, nor do their workflows, comments, designated author or change order.
 */
export function readerMaySeeRevision(circle: boolean, revStatus: string | null | undefined): boolean {
  return circle || revStatus === 'in_force' || revStatus === 'superseded';
}

/** Journal actions that only ever concern one revision (working versions, circuits, entry into force, files). */
const REVISION_ACTIONS = new Set(['upload', 'working', 'import', 'reclass', 'request', 'approve', 'sign', 'reject', 'delegate', 'in_force', 'download']);

/**
 * Journal entries outside the drafting circle (D-14). An entry about a revision records it (audit_log.revision_id) and
 * follows it: shown once that revision is in force or superseded (readerMaySeeRevision), hidden while it is drafted,
 * reviewed, waiting for its effective date, or after it was cancelled. An entry without a revision concerns the document
 * as a whole (metadata, readers, change requests and their refusal, withdrawal, hold, archiving) and is shown, unless
 * its action only ever concerns a revision: the revision is then unknown, and the entry stays hidden.
 * `revStatus` is the status of the entry's revision, undefined when that revision cannot be found.
 */
export function readerMaySeeEntry(circle: boolean, e: { action: string; revisionId: number | null }, revStatus: string | undefined): boolean {
  if (circle) return true;
  if (e.revisionId == null) return !REVISION_ACTIONS.has(e.action);
  return readerMaySeeRevision(false, revStatus);
}
