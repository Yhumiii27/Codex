import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { schema as s, type Db } from '@/db';
import { contextOf, formatId, type IdInput } from './codes';

export { contextOf, idMatches, isFinalStatus, nextLetter, revLabel, seqWidth, TEMPLATE_CONTEXT, TEMPLATE_TYPE, type IdInput } from './codes';

type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** Highest N among the values `prefix` + N (digits only) of a one-column query; null when there is none. */
function highestAfter(prefix: string, values: SQL): SQL {
  const rest = sql`substr(v, ${prefix.length + 1}::int)`;
  return sql`select max(case when ${rest} ~ '^[0-9]{1,9}$' then ${rest}::int end) from (${values}) t(v) where left(v, ${prefix.length}::int) = ${prefix}`;
}

/**
 * Moves the counter of `scope` to last + step, at least `floor`, and returns it. One INSERT … ON CONFLICT statement in
 * the caller's transaction: concurrent callers queue on the counter row instead of reading the same maximum (Postgres
 * in READ COMMITTED), and a rolled-back transaction gives its number back. On the scope's first use the counter starts
 * from `used`, the highest number already taken; COALESCE evaluates it only then.
 */
async function advance(tx: Tx, scope: string, used: SQL, step: 0 | 1, floor = 0): Promise<number> {
  const c = s.idCounters;
  const stored = sql`(select ${c.last} from ${c} where ${c.scope} = ${scope})`;
  const [row] = await tx.insert(c)
    .values({ scope, last: sql`greatest(coalesce(${stored}, (${used}), 0) + ${step}::int, ${floor}::int)` })
    .onConflictDoUpdate({ target: c.scope, set: { last: sql`greatest(${c.last} + ${step}::int, ${floor}::int)` } })
    .returning({ last: c.last });
  return row.last;
}

/** Next number of `scope`. `values` lists the identifiers already written (`prefix` + N); only its first use reads them. */
export function nextNumber(tx: Tx, scope: string, prefix: string, values: SQL): Promise<number> {
  return advance(tx, scope, highestAfter(prefix, values), 1);
}

/** Every document ID and alias: a number kept as an alias is never handed out again. */
const docIdsAndAliases = () => sql`select ${s.documents.id} from ${s.documents} union all select jsonb_array_elements_text(${s.documents.aliases}) from ${s.documents}`;

/** Next free ID for this type and context; earlier IDs kept as aliases are never reused. */
export async function nextDocId(tx: Tx, d: IdInput): Promise<string> {
  const scope = `${d.typeCode}-${contextOf(d)}`;
  return formatId(d, await nextNumber(tx, `doc:${scope}`, `${scope}-`, docIdsAndAliases()));
}

/**
 * For an ID written without nextDocId (an imported document's own ID, a legacy reference kept as alias): when it reads
 * TYPE-CONTEXTE-SEQ, its counter is raised to at least SEQ, so that number is never handed out.
 */
export async function reserveDocId(tx: Tx, id: string): Promise<void> {
  const m = /^(.+-.+)-(\d{1,9})$/.exec(id);
  if (!m) return;
  await advance(tx, `doc:${m[1]}`, highestAfter(`${m[1]}-`, docIdsAndAliases()), 0, Number(m[2]));
}

/** Next approval circuit, W-n. */
export async function nextWorkflowId(tx: Tx): Promise<string> {
  return `W-${await nextNumber(tx, 'workflow', 'W-', sql`select ${s.workflows.id} from ${s.workflows}`)}`;
}
