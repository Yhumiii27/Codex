import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import type { ProjectConfidentiality } from '@/db/schema';
import { logger } from '@/lib/log';

// Confidentiality and team of the Keystone projects (decision of the owner of 27 November 2026, D-33): « c'est Keystone
// qui donnera le niveau de confidentialité […] (valable aussi pour les documents dans Codex) ». Keystone publishes
// `confidentialite` ('normal' | 'confidentiel') at the end of keystone.pub_projets and the team of each project in
// keystone.pub_equipes_projets (Keystone#90; Matrix publishes them and grants codex_app their reading, M-18). Codex keeps
// both in its mirror of the projects (projects.confidentiality, project_team), refreshed by the scheduler (task
// "keystone", CODEX_SCHEDULE_KEYSTONE); lib/access.ts reads the mirror. Codex never writes in Keystone (M-17).
//
// A source that cannot be read is a state, never an error: the mirror keeps what it has (a confidential project stays
// confidential, its team stays the last one read). pub_projets without the column: every project read is « normal »
// (not confidential). Only the projects Codex mirrors are touched; a project Keystone no longer publishes keeps its
// state.

const log = logger('keystone');

/** A row of keystone.pub_equipes_projets, the columns Codex reads (reference query of Keystone, definitions.ts). */
type PubTeam = { projet_code: string | null; matricule: string | null; personne_nom: string | null; email: string | null; origine: string | null; personne_clavis_id: string | null; role: string | null };

export type KeystoneSync =
  | { status: 'ok'; projects: number; changed: number; team: 'ok' | 'no_source'; members: number }
  | { status: 'skipped'; reason: 'no_source' };

const ORIGINS = new Set(['equipe', 'affectation', 'partie_prenante']);

/** Can codex_app read this view of Keystone? Never an error (no usage on the schema: the link is not granted yet). */
async function readable(db: Db, view: string): Promise<boolean> {
  try {
    const [{ ok }] = (await db.$client.query<{ ok: boolean }>(
      `select to_regclass($1) is not null and has_table_privilege(current_user, $1, 'select') as ok`, [view],
    )).rows;
    return ok;
  } catch (err) {
    log.info(`${view} not readable`, { err });
    return false;
  }
}

async function query<T>(db: Db, text: string): Promise<T[] | null> {
  try {
    return (await db.$client.query<T>(text)).rows;
  } catch (err) {
    log.info('keystone view not readable', { err });
    return null;
  }
}

/** keystone.pub_projets: code and confidentiality (absent column: 'normal'); null when the view cannot be read. */
async function readProjects(db: Db): Promise<{ code: string; conf: ProjectConfidentiality }[] | null> {
  if (!(await readable(db, 'keystone.pub_projets'))) return null;
  const cols = await query<{ ok: boolean }>(db, `select exists (select 1 from pg_attribute where attrelid = 'keystone.pub_projets'::regclass
    and attname = 'confidentialite' and not attisdropped) as ok`);
  if (!cols) return null;
  const withConf = cols[0]?.ok === true;
  const rows = await query<{ code: string | null; confidentialite: string | null }>(db,
    `select code, ${withConf ? 'confidentialite' : 'null::text as confidentialite'} from keystone.pub_projets`);
  if (!rows) return null;
  return rows.filter((r) => typeof r.code === 'string' && r.code.trim())
    .map((r) => ({ code: r.code!.trim(), conf: r.confidentialite === 'confidentiel' ? 'confidentiel' : 'normal' }));
}

/** keystone.pub_equipes_projets; null when the view is absent or cannot be read. */
async function readTeams(db: Db): Promise<PubTeam[] | null> {
  if (!(await readable(db, 'keystone.pub_equipes_projets'))) return null;
  return query<PubTeam>(db, 'select projet_code, matricule, personne_nom, email, origine, personne_clavis_id, role from keystone.pub_equipes_projets');
}

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Refreshes the confidentiality and the team of the projects Codex mirrors. The team of a mirrored project is replaced
 * by the one published (people without a Clavis person id nor a personnel number are left out: Codex could not match
 * them); while pub_equipes_projets cannot be read, the teams stay as they are.
 */
export async function syncKeystoneConfidentiality(db: Db, now = new Date()): Promise<KeystoneSync> {
  const published = await readProjects(db);
  if (!published) return { status: 'skipped', reason: 'no_source' };
  const teams = await readTeams(db);
  const at = now.toISOString();
  return db.transaction(async (tx) => {
    const mirrored = new Map((await tx.select({ code: s.projects.code, conf: s.projects.confidentiality }).from(s.projects)).map((p) => [p.code, p.conf]));
    let changed = 0;
    for (const p of published) {
      const cur = mirrored.get(p.code);
      if (cur === undefined || cur === p.conf) continue;
      await tx.update(s.projects).set({ confidentiality: p.conf }).where(eq(s.projects.code, p.code));
      changed++;
    }
    if (!teams) return { status: 'ok' as const, projects: published.length, changed, team: 'no_source' as const, members: 0 };
    const rows = teams.flatMap((r) => {
      const projectCode = clean(r.projet_code), clavisPersonId = clean(r.personne_clavis_id)?.toLowerCase() ?? null, matricule = clean(r.matricule);
      if (!projectCode || !mirrored.has(projectCode) || (!clavisPersonId && !matricule)) return [];
      return [{
        projectCode, clavisPersonId, matricule, name: clean(r.personne_nom) ?? matricule ?? clavisPersonId!, email: clean(r.email),
        origin: ORIGINS.has(r.origine ?? '') ? r.origine! : 'equipe', role: clean(r.role), syncedAt: at,
      }];
    });
    const codes = [...mirrored.keys()];
    if (codes.length) await tx.delete(s.projectTeam).where(inArray(s.projectTeam.projectCode, codes));
    if (rows.length) await tx.insert(s.projectTeam).values(rows);
    return { status: 'ok' as const, projects: published.length, changed, team: 'ok' as const, members: rows.length };
  });
}
