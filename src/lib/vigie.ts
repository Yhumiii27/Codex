import 'server-only';
import { sql } from 'drizzle-orm';
import { schema as s } from '@/db';
import { nextNumber } from './codification';
import { nowStamp } from './format';
import type { Tx } from './lifecycle';

// Vigie integration boundary. Vigie owns change requests (ECR/ECO) and withdrawal requests; Codex creates them for
// documents and applies Vigie's decisions (POST /api/integrations/vigie). Until Vigie exposes its API, requests are
// kept in Codex's mirror table and decisions can be simulated by a records manager.

export function vigieUrl(id?: string): string {
  const base = (process.env.NEXT_PUBLIC_VIGIE_URL ?? 'http://localhost:3200').replace(/\/$/, '');
  return id ? `${base}/changements/${encodeURIComponent(id)}` : base;
}

/** True while no real Vigie endpoint is configured: decisions are simulated from Codex. */
export function vigieSimulated(): boolean {
  return !process.env.VIGIE_API_URL;
}

export type ChangeInput = { kind: 'modification' | 'obsolescence'; docId: string; requesterId: string; reason: string; description: string; source?: string };

/** Registers a request with Vigie and mirrors it; returns its Vigie reference. */
export async function submitChange(tx: Tx, input: ChangeInput): Promise<string> {
  const at = nowStamp();
  const year = at.slice(0, 4);
  const seq = await nextNumber(tx, `ecr:${year}`, `ECR-${year}-`, sql`select ${s.changeRequests.id} from ${s.changeRequests}`);
  const id = `ECR-${year}-${String(seq).padStart(3, '0')}`;
  // Real integration: POST {VIGIE_API_URL}/change-requests and use the id Vigie returns.
  await tx.insert(s.changeRequests).values({ id, ...input, source: input.source ?? 'codex', status: 'submitted', createdAt: at });
  return id;
}
