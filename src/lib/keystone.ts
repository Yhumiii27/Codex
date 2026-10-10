import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { Ctx } from './context';
import { fmtClock, fmtWhen, loc } from './format';

// Keystone integration boundary. Keystone owns projects; Codex keeps the documents and the type register that
// Keystone reads (GET /api/registry). Until Keystone exposes an API, project data comes from Codex's local mirror
// tables. Swap the bodies of these functions for API calls when the integration exists.
// The project feed is shown to every reader of the project's documents: it never names a revision being drafted, its
// change order or its author (D-14, docs/modele-cible.md §5).

export function keystoneUrl(code?: string): string {
  const base = (process.env.NEXT_PUBLIC_KEYSTONE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return code ? `${base}/projects/${encodeURIComponent(code)}` : base;
}

export async function getProject(ctx: Ctx, code: string) {
  const db = await getDb();
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code));
  if (!p) return null;
  const [expected, events] = await Promise.all([
    db.select().from(s.projectExpected).where(eq(s.projectExpected.projectCode, code)).orderBy(asc(s.projectExpected.sort)),
    db.select().from(s.projectEvents).where(eq(s.projectEvents.projectCode, code)).orderBy(desc(s.projectEvents.at)),
  ]);
  return {
    code: p.code,
    name: p.name,
    client: p.client,
    stage: p.stage,
    managerId: p.managerId,
    manager: ctx.userName(p.managerId),
    site: p.site,
    tiers: p.tiers,
    synced: fmtClock(p.syncedAt),
    url: keystoneUrl(p.code),
    expected: expected.map((x) => ({ id: x.id, label: loc(x.label, ctx.lang), typeCode: x.typeCode, docId: x.docId, later: x.later })),
    events: events.map((e) => ({ id: e.id, when: fmtWhen(e.at), text: loc(e.text, ctx.lang) })),
  };
}
export type ProjectView = NonNullable<Awaited<ReturnType<typeof getProject>>>;
