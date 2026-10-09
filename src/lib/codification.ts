import 'server-only';
import { schema as s, type Db } from '@/db';
import { contextOf, formatId, type IdInput } from './codes';

export { contextOf, idMatches, isFinalStatus, nextLetter, revLabel, seqWidth, TEMPLATE_CONTEXT, TEMPLATE_TYPE, type IdInput } from './codes';

type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** Next free ID for this type and context; earlier IDs kept as aliases are never reused. */
export async function nextDocId(tx: Tx, d: IdInput): Promise<string> {
  const prefix = `${d.typeCode}-${contextOf(d)}-`;
  const rows = await tx.select({ id: s.documents.id, aliases: s.documents.aliases }).from(s.documents);
  const taken = rows.flatMap((r) => [r.id, ...r.aliases]).filter((id) => id.startsWith(prefix));
  const max = taken.reduce((m, id) => Math.max(m, Number(id.slice(prefix.length)) || 0), 0);
  return formatId(d, max + 1);
}
