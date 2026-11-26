import 'server-only';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import { audit } from './lifecycle';
import { logger } from './log';
import { CURSUS_ACTOR, isCursusRef, type DestroyReason } from './records';
import { storeFor, type StoreName } from './storage';

// The records of Cursus as Cursus itself reads and destroys them (request « lot 16 », docs/api.md): routes
// GET /api/documents/{id}/file (with Cursus's token) and POST /api/documents/{id}/destroy. Only the documents filed under
// Cursus's prefix (`cursus:…`, documents.legacy_ref) are reached; any other answers as missing.

const log = logger('records');

type Q = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
type DocRow = typeof s.documents.$inferSelect;

/** The document filed by Cursus under this ID, current or former (an alias), or null for any other document. */
export async function cursusRecord(q: Q, id: string): Promise<DocRow | null> {
  const [d] = await q.select().from(s.documents)
    .where(or(eq(s.documents.id, id), sql`${s.documents.aliases} @> ${JSON.stringify([id])}::jsonb`))
    .orderBy(sql`${s.documents.id} = ${id} desc`).limit(1);
  return d && isCursusRef(d.legacyRef) ? d : null;
}

/** The trace of a record of Cursus destroyed under this ID, or null. */
export async function destroyedRecord(q: Q, id: string) {
  const [x] = await q.select().from(s.destroyedDocuments).where(eq(s.destroyedDocuments.id, id)).limit(1);
  return x && isCursusRef(x.sourceRef) ? x : null;
}

/**
 * The file a record carries, as filed: the last working version of its revision in force (a record has one revision,
 * A, and one version). Null without one.
 */
export async function recordVersion(q: Q, d: DocRow) {
  const rows = await q.select({ v: s.workingVersions, letter: s.revisions.letter, status: s.revisions.status }).from(s.workingVersions)
    .innerJoin(s.revisions, eq(s.revisions.id, s.workingVersions.revisionId))
    .where(eq(s.workingVersions.docId, d.id))
    .orderBy(asc(s.revisions.id), asc(s.workingVersions.n));
  const inForce = rows.filter((r) => r.status === 'in_force');
  const last = inForce.at(-1) ?? null;
  return last && last.v.fileKey ? { version: last.v, letter: last.letter } : null;
}

export type DestroyOutcome =
  | { kind: 'destroyed'; id: string; destroyedAt: string; removed: number; failed: number }
  | { kind: 'already'; id: string; destroyedAt: string; reason: string }
  | { kind: 'not_found' }
  | { kind: 'legal_hold'; id: string }
  /** Another document points to it (a circuit, a change request, a pending replacement): to settle in Codex first. */
  | { kind: 'in_use'; id: string };

/**
 * Destroys a record of Cursus (`reason`: retrait, conservation, effacement): its revisions, working versions, renderings,
 * named readers, links and search terms are deleted, its files removed from their store once the transaction has
 * committed; a trace without content is kept (destroyed_documents: ID, type, category, source reference, dates, reason,
 * application) and the journal records it (« Destruction », actor cursus). The journal itself is never rewritten: its
 * entries about the record keep their ID and detail, which hold neither its title nor its file. Refused under legal
 * hold. Sent again for a record already destroyed: its trace, nothing done.
 */
export async function destroyRecord(id: string, reason: DestroyReason): Promise<DestroyOutcome> {
  const db = await getDb();
  const out = await db.transaction(async (tx): Promise<DestroyOutcome & { files?: { storage: string; key: string }[] }> => {
    const d = await cursusRecord(tx, id);
    if (!d) {
      const gone = await destroyedRecord(tx, id);
      return gone ? { kind: 'already', id: gone.id, destroyedAt: gone.destroyedAt, reason: gone.reason } : { kind: 'not_found' };
    }
    await tx.execute(sql`select 1 from ${s.documents} where ${s.documents.id} = ${d.id} for update`);
    if (d.legalHold) return { kind: 'legal_hold', id: d.id };
    const [[wf], [cr]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(s.workflows).where(eq(s.workflows.docId, d.id)),
      tx.select({ n: sql<number>`count(*)::int` }).from(s.changeRequests).where(or(eq(s.changeRequests.docId, d.id), eq(s.changeRequests.replacementId, d.id))),
    ]);
    if (wf.n || cr.n) return { kind: 'in_use', id: d.id };
    const versions = await tx.select({ id: s.workingVersions.id, storage: s.workingVersions.storage, key: s.workingVersions.fileKey }).from(s.workingVersions).where(eq(s.workingVersions.docId, d.id));
    const vids = versions.map((v) => v.id);
    const previews = vids.length ? await tx.select({ key: s.versionPreviews.fileKey }).from(s.versionPreviews).where(inArray(s.versionPreviews.workingVersionId, vids)) : [];
    const files = [
      ...versions.flatMap((v) => (v.key ? [{ storage: v.storage ?? 'local', key: v.key }] : [])),
      ...previews.flatMap((p) => (p.key ? [{ storage: 'local', key: p.key }] : [])),
    ];
    if (vids.length) await tx.delete(s.versionPreviews).where(inArray(s.versionPreviews.workingVersionId, vids));
    await tx.delete(s.workingVersions).where(eq(s.workingVersions.docId, d.id));
    await tx.delete(s.revisions).where(eq(s.revisions.docId, d.id));
    await tx.delete(s.documentReaders).where(eq(s.documentReaders.docId, d.id));
    await tx.delete(s.documentLinks).where(or(eq(s.documentLinks.sourceId, d.id), eq(s.documentLinks.targetId, d.id)));
    await tx.update(s.projectExpected).set({ docId: null }).where(eq(s.projectExpected.docId, d.id));
    await tx.update(s.documents).set({ templateId: null }).where(eq(s.documents.templateId, d.id));
    await tx.delete(s.documents).where(and(eq(s.documents.id, d.id), eq(s.documents.ownerId, CURSUS_ACTOR)));
    const destroyedAt = new Date().toISOString();
    await tx.insert(s.destroyedDocuments).values({
      id: d.id, typeCode: d.typeCode, subtype: d.subtype, sourceRef: d.legacyRef!, app: CURSUS_ACTOR, reason, filedAt: d.createdAt, destroyedAt,
    });
    // About a document that no longer exists: the detail says why and which reference, never what it held.
    await audit(tx, CURSUS_ACTOR, 'destroy', d.id, `${reason} · ${d.legacyRef}`);
    return { kind: 'destroyed', id: d.id, destroyedAt, removed: 0, failed: 0, files };
  });
  if (out.kind !== 'destroyed') return out;
  // The files go once nothing points to them any more. A file the store fails to remove is logged (never its content):
  // the orphan check of Administration removes it from the local store (lib/orphans.ts).
  let removed = 0, failed = 0;
  for (const f of out.files ?? []) {
    try {
      await storeFor((f.storage === 'sharepoint' ? 'sharepoint' : 'local') as StoreName).remove(f.key);
      removed++;
    } catch (err) {
      failed++;
      log.error('destroyed record: file not removed', { doc: out.id, store: f.storage, err });
    }
  }
  return { kind: 'destroyed', id: out.id, destroyedAt: out.destroyedAt, removed, failed };
}
