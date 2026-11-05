import 'server-only';
import { eq, notInArray } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import { logger } from './log';

// CAPEX of the subsidiaries (Arche's request CX-01, decision of 1 November 2026: a 4th attachment `capex`, its code the
// context of the ID, PID-CPX-APM-2026-01-001). Arche owns them and publishes them in its view `arche.pub_capex` (read by
// codex_app once Matrix declares the link, decision M-18); Codex keeps a mirror (table capex) refreshed by the scheduler
// (task "capex", CODEX_SCHEDULE_CAPEX). Codex never writes in Arche's schema (M-17). Without the view (PGlite, a server
// where the link is not granted yet), nothing changes: the mirror keeps what it has.

const log = logger('capex');

/** A row of arche.pub_capex, the columns Codex reads (contract of Arche, docs/DEMANDES-CODEX.md of its repository). */
type PubCapex = { code: string; intitule: string | null; filiale_code: string | null; filiale: string | null; site: string | null; statut: string | null; phase_code: string | null };

export type CapexSync = { status: 'ok'; read: number; added: number; updated: number; inactivated: number } | { status: 'skipped'; reason: 'no_source' };

/** The view arche.pub_capex, when it exists and codex_app may read it; null otherwise (never an error). */
async function readSource(db: Db): Promise<PubCapex[] | null> {
  try {
    const [{ ok }] = (await db.$client.query<{ ok: boolean }>(
      `select to_regclass('arche.pub_capex') is not null and has_table_privilege(current_user, 'arche.pub_capex', 'select') as ok`,
    )).rows;
    if (!ok) return null;
    return (await db.$client.query<PubCapex>('select code, intitule, filiale_code, filiale, site, statut, phase_code from arche.pub_capex')).rows;
  } catch (err) {
    // No usage on the schema arche, for instance: the link is not granted (yet).
    log.info('arche.pub_capex not readable', { err });
    return null;
  }
}

/**
 * Refreshes the mirror from arche.pub_capex: a CAPEX published is added or updated and active, one no longer published
 * becomes inactive (never removed: its documents keep it). A row without a code is left out.
 */
export async function syncCapex(db: Db, now = new Date()): Promise<CapexSync> {
  const rows = await readSource(db);
  if (!rows) return { status: 'skipped', reason: 'no_source' };
  const at = now.toISOString();
  const published = rows.filter((r) => typeof r.code === 'string' && r.code.trim()).map((r) => ({
    code: r.code.trim(), name: (r.intitule ?? '').trim() || r.code.trim(), subsidiaryCode: r.filiale_code, subsidiary: r.filiale,
    site: r.site, status: r.statut, phase: r.phase_code, active: true, syncedAt: at,
  }));
  return db.transaction(async (tx) => {
    const before = new Map((await tx.select().from(s.capex)).map((c) => [c.code, c]));
    let added = 0, updated = 0;
    for (const c of published) {
      const cur = before.get(c.code);
      if (!cur) {
        await tx.insert(s.capex).values(c);
        added++;
      } else if (cur.name !== c.name || cur.subsidiaryCode !== c.subsidiaryCode || cur.subsidiary !== c.subsidiary || cur.site !== c.site || cur.status !== c.status || cur.phase !== c.phase || !cur.active) {
        await tx.update(s.capex).set(c).where(eq(s.capex.code, c.code));
        updated++;
      }
    }
    const codes = published.map((c) => c.code);
    const gone = [...before.values()].filter((c) => c.active && !codes.includes(c.code));
    if (gone.length) {
      await tx.update(s.capex).set({ active: false, syncedAt: at }).where(codes.length ? notInArray(s.capex.code, codes) : eq(s.capex.active, true));
    }
    return { status: 'ok' as const, read: rows.length, added, updated, inactivated: gone.length };
  });
}
