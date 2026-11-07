import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { schema as s } from '@/db';
import { nextNumber } from './codification';
import { nowStamp } from './format';
import type { Tx } from './lifecycle';
import { logger } from './log';

// Vigie integration boundary. Vigie owns change requests (ECR/ECO) and withdrawal requests; Codex creates them for
// documents and applies Vigie's decisions (POST /api/integrations/vigie). On the shared server, Codex creates a request
// through Vigie's function vigie.pub_creer_demande_modification (Vigie's request D12, decision D-31; M-17: a write at
// another tool goes through a pub_ function of its owner), once Matrix grants codex_app its execution. Vigie numbers
// it (ECR-AAAA-NNN) and decides; Codex keeps a mirror (table change_requests). Without the function (PGlite, a server
// where the link is not granted yet), Codex numbers the request itself and a records manager simulates the decision.

const log = logger('vigie');

/** Vigie's function, with its signature (Vigie, drizzle/0029_convergence_m02_ecr_eco.sql). */
const VIGIE_FN = 'pub_creer_demande_modification';

export function vigieUrl(id?: string): string {
  const base = (process.env.NEXT_PUBLIC_VIGIE_URL ?? 'http://localhost:3200').replace(/\/$/, '');
  return id ? `${base}/modifications-techniques/${encodeURIComponent(id)}` : base;
}

/**
 * True when Vigie's address is configured (NEXT_PUBLIC_VIGIE_URL). Without it, vigieUrl falls back on Vigie's local
 * port, where a request may not exist: a link offered only « si configuré » is then left out.
 */
export function vigieLinkConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_VIGIE_URL?.trim();
}

/**
 * True when codex_app may call vigie.pub_creer_demande_modification. Read in the catalogue, which never raises (no
 * usage on the schema vigie, no schema at all): safe inside a transaction.
 */
export async function vigieConnected(db: Tx): Promise<boolean> {
  const res = await db.execute<{ ok: boolean }>(sql`
    select coalesce(bool_or(has_schema_privilege(n.oid, 'USAGE') and has_function_privilege(p.oid, 'EXECUTE')), false) as ok
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'vigie' and p.proname = ${VIGIE_FN}`);
  return !!res.rows[0]?.ok;
}

/** True while Codex cannot reach Vigie's function: requests stay in Codex and their decisions are simulated from it. */
export async function vigieSimulated(db: Tx): Promise<boolean> {
  return !(await vigieConnected(db));
}

/**
 * A request as Codex sends it. `replacementId`: for a withdrawal, the document proposed to replace this one, kept by
 * Codex, sent to Vigie (p_remplacant) and linked when the withdrawal applies (lib/lifecycle.ts).
 */
export type ChangeInput = { kind: 'modification' | 'obsolescence'; docId: string; requesterId: string; reason: string; description: string; replacementId?: string | null; source?: string };

/**
 * Vigie refused the request before registering it: `refused` (P0V01: codex_app is not a known caller), `invalid` (P0V02,
 * with Vigie's message), `taken` (the number Vigie gave already names a request of Codex: one numbered by Codex before
 * the link). Nothing is written in Codex either: the transaction is undone.
 */
export class VigieError extends Error {
  constructor(readonly reason: 'refused' | 'invalid' | 'taken', message: string) {
    super(message);
    this.name = 'VigieError';
  }
}

/** The SQLSTATE of a database error, possibly wrapped by Drizzle (its cause). */
function sqlState(err: unknown): string | null {
  for (let e = err, i = 0; e && typeof e === 'object' && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}
function rootMessage(err: unknown): string {
  let m = err instanceof Error ? err.message : String(err);
  for (let e = err, i = 0; e && typeof e === 'object' && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error && e.message) m = e.message;
  }
  return m;
}

/**
 * Registers a request with Vigie and mirrors it; returns its Vigie reference. With Vigie's function, the call runs in
 * the caller's transaction: Vigie's deposit and Codex's mirror are kept or undone together, so a request is never sent
 * twice (its external id is still unique, as Vigie's idempotence asks).
 */
export async function submitChange(tx: Tx, input: ChangeInput): Promise<string> {
  const at = nowStamp();
  let id: string;
  if (await vigieConnected(tx)) {
    const [who] = await tx.select({ name: s.users.name, matricule: s.users.matricule }).from(s.users).where(eq(s.users.id, input.requesterId));
    let res;
    try {
      res = await tx.execute<{ id: string }>(sql`select vigie.pub_creer_demande_modification(
        p_id_externe => ${`codex:${crypto.randomUUID()}`}, p_nature => ${input.kind}, p_document => ${input.docId},
        p_motif => ${input.reason}, p_description => ${input.description}, p_demandeur_ref => ${input.requesterId},
        p_demandeur_nom => ${who?.name ?? input.requesterId}, p_demandeur_matricule => ${who?.matricule ?? null},
        p_remplacant => ${input.replacementId ?? null}, p_enregistre_le => ${new Date().toISOString()}::timestamptz) as id`);
    } catch (err) {
      const code = sqlState(err);
      if (code === 'P0V01' || code === 'P0V02') {
        log.warn('request refused by Vigie', { code, docId: input.docId, err });
        throw new VigieError(code === 'P0V01' ? 'refused' : 'invalid', rootMessage(err));
      }
      throw err;
    }
    id = String(res.rows[0]?.id ?? '');
    if (!id) throw new Error('vigie.pub_creer_demande_modification returned no number');
    const [taken] = await tx.select({ id: s.changeRequests.id }).from(s.changeRequests).where(eq(s.changeRequests.id, id));
    if (taken) {
      log.error('Vigie number already used in Codex', { changeRequest: id });
      throw new VigieError('taken', id);
    }
  } else {
    const year = at.slice(0, 4);
    const seq = await nextNumber(tx, `ecr:${year}`, `ECR-${year}-`, sql`select ${s.changeRequests.id} from ${s.changeRequests}`);
    id = `ECR-${year}-${String(seq).padStart(3, '0')}`;
  }
  await tx.insert(s.changeRequests).values({ id, ...input, source: input.source ?? 'codex', status: 'submitted', createdAt: at });
  return id;
}
