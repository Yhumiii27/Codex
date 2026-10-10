import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { getCtx } from '@/lib/context';
import { csvHeaders, csvRow } from '@/lib/csv';
import { todayIso } from '@/lib/format';
import type { TKey } from '@/lib/i18n';
import { auditForReader } from '@/lib/queries';

const BATCH = 5000;

/**
 * CSV export of the audit log (administration only), newest first. Streamed batch by batch with a keyset cursor
 * (timestamp, id): no row limit, and memory stays bounded however long the log grows. Same entries as the Journal
 * tab: an administrator who is not a records manager does not get the work in progress of other people's drafts (D-14).
 */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx.screens.admin) return new Response('Forbidden', { status: 403 });
  const { t } = ctx;
  const db = await getDb();
  const enc = new TextEncoder();
  let cursor: { at: string; id: number } | null = null;
  let headed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (!headed) {
        headed = true;
        c.enqueue(enc.encode('﻿' + csvRow([t.when, t.user, t.action, t.document, t.detail])));
        return;
      }
      // A batch may be filtered out entirely: read on until something is enqueued, or pull would not be called again.
      for (;;) {
        const after = cursor ? or(lt(s.auditLog.at, cursor.at), and(eq(s.auditLog.at, cursor.at), lt(s.auditLog.id, cursor.id))) : undefined;
        const batch = await db.select().from(s.auditLog).where(after).orderBy(desc(s.auditLog.at), desc(s.auditLog.id)).limit(BATCH);
        if (!batch.length) {
          c.close();
          return;
        }
        const last = batch[batch.length - 1];
        cursor = { at: last.at, id: last.id };
        const rows = await auditForReader(ctx, batch);
        if (!rows.length) continue;
        c.enqueue(enc.encode(rows.map((a) => csvRow([a.at, ctx.userName(a.userId), ctx.t[`act_${a.action}` as TKey] ?? a.action, a.docId, a.detail])).join('')));
        return;
      }
    },
  });
  return new Response(body, { headers: csvHeaders(`codex-journal-audit-${todayIso()}.csv`) });
}
