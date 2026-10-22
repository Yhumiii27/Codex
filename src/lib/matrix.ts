import 'server-only';
// Déclaration du schéma de Codex auprès de Matrix (contrat matrix.schema/1).
//
// Portage TypeScript du module de référence de Matrix (`integration/declarer-schema.mjs`, partie PostgreSQL) :
// même SQL, même document, mêmes variables. Appelé par `src/db/index.ts` juste après les migrations.
//
// Variables d'environnement :
//   MATRIX_URL               adresse de Matrix (ex. https://matrix.exemple.fr, ou https://user:mdp@… derrière une
//                            authentification HTTP) ; si absente, rien n'est envoyé (tests, poste local)
//   MATRIX_TOKEN             jeton partagé avec Matrix, envoyé dans l'en-tête X-Matrix-Token
//   MATRIX_DECLARATIONS_DIR  dossier où écrire aussi la déclaration (utile sans réseau)
//
// L'envoi n'est jamais bloquant : en cas d'échec, Codex démarre normalement et un avertissement est écrit.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MatrixColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  default: string | null;
}

export interface MatrixForeignKey {
  columns: string[];
  table: string;
  refColumns: string[];
  onDelete: string | null;
  declared: true;
}

export interface MatrixTable {
  name: string;
  columns: MatrixColumn[];
  pk: string[];
  fks: MatrixForeignKey[];
  uniques: string[][];
}

export interface MatrixSchemaDocument {
  schema: 'matrix.schema/1';
  app: string;
  version: string | null;
  declareLe: string;
  empreinte: string;
  tables: MatrixTable[];
}

/** Exécute une requête SQL et renvoie ses lignes (par ex. `sql => pglite.query(sql).then(r => r.rows)`). */
export type QueryRows = <T>(sql: string) => Promise<T[]>;

type Log = Pick<Console, 'info' | 'warn'>;

const PG_TABLES = `
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
    and c.table_name not in ('__drizzle_migrations', 'schema_migrations')
  order by c.table_name, c.ordinal_position`;

const PG_CONSTRAINTS = `
  select rel.relname as table_name, con.contype as kind,
    array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as cols,
    ref.relname as ref_table,
    array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_cols,
    con.confdeltype as on_delete
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  left join pg_class ref on ref.oid = con.confrelid
  where n.nspname = current_schema() and con.contype in ('p', 'u', 'f')
  order by rel.relname, con.conname`;

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

interface ConstraintRow {
  table_name: string;
  kind: 'p' | 'u' | 'f';
  cols: string[] | string | null;
  ref_table: string | null;
  ref_cols: string[] | string | null;
  on_delete: string | null;
}

const ON_DELETE: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };

/** Tableau PostgreSQL, déjà décodé ou sous sa forme texte `{a,b}`. */
const arr = (v: string[] | string | null | undefined): string[] =>
  Array.isArray(v) ? v : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);

/** Lit le schéma courant d'une base PostgreSQL ou PGlite. */
export async function introspecterPostgres(query: QueryRows): Promise<MatrixTable[]> {
  const tables = new Map<string, MatrixTable>();
  for (const r of await query<ColumnRow>(PG_TABLES)) {
    let t = tables.get(r.table_name);
    if (!t) {
      t = { name: r.table_name, columns: [], pk: [], fks: [], uniques: [] };
      tables.set(r.table_name, t);
    }
    const type =
      r.data_type === 'USER-DEFINED' ? r.udt_name
      : r.data_type === 'ARRAY' ? r.udt_name.replace(/^_/, '') + '[]'
      : r.data_type;
    t.columns.push({ name: r.column_name, type, nullable: r.is_nullable === 'YES', pk: false, default: r.column_default ?? null });
  }
  for (const r of await query<ConstraintRow>(PG_CONSTRAINTS)) {
    const t = tables.get(r.table_name);
    if (!t) continue;
    const cols = arr(r.cols);
    if (r.kind === 'p') {
      t.pk = cols;
      if (cols.length === 1) {
        const col = t.columns.find((c) => c.name === cols[0]);
        if (col) col.pk = true;
      }
    } else if (r.kind === 'u') {
      t.uniques.push(cols);
    } else {
      t.fks.push({
        columns: cols,
        table: r.ref_table ?? '',
        refColumns: arr(r.ref_cols),
        onDelete: r.on_delete ? (ON_DELETE[r.on_delete] ?? null) : null,
        declared: true,
      });
    }
  }
  return [...tables.values()];
}

/** Construit le document matrix.schema/1. L'empreinte permet à Matrix d'ignorer une déclaration inchangée. */
export function documentSchema({ app, version = null, tables }: { app: string; version?: string | null; tables: MatrixTable[] }): MatrixSchemaDocument {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const empreinte = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return { schema: 'matrix.schema/1', app, version, declareLe: new Date().toISOString(), empreinte, tables: sorted };
}

/** Envoie la déclaration à Matrix et/ou l'écrit dans un dossier. Ne lève jamais d'erreur. */
export async function declarerSchema({
  app,
  version,
  tables,
  env = process.env,
  log = console,
}: {
  app: string;
  version?: string | null;
  tables: MatrixTable[];
  env?: NodeJS.ProcessEnv;
  log?: Log;
}): Promise<MatrixSchemaDocument> {
  const doc = documentSchema({ app, version, tables });
  try {
    if (env.MATRIX_DECLARATIONS_DIR) {
      mkdirSync(env.MATRIX_DECLARATIONS_DIR, { recursive: true });
      writeFileSync(join(env.MATRIX_DECLARATIONS_DIR, `${app}.json`), JSON.stringify(doc, null, 1));
    }
    if (env.MATRIX_URL) {
      // MATRIX_URL peut contenir un identifiant et un mot de passe (https://user:mdp@matrix.exemple.fr) quand Matrix
      // est protégé par l'authentification HTTP de l'hébergeur : ils partent en Basic, le jeton dans X-Matrix-Token.
      const url = new URL('/api/declarations', env.MATRIX_URL);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (env.MATRIX_TOKEN) headers['x-matrix-token'] = env.MATRIX_TOKEN;
      if (url.username) {
        headers.authorization =
          'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
        url.username = '';
        url.password = '';
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Matrix a répondu ${res.status} : ${await res.text()}`);
      const r = (await res.json()) as { nouvellesTables?: string[] };
      if (r.nouvellesTables?.length) log.info?.(`[matrix] nouvelles tables déclarées : ${r.nouvellesTables.join(', ')}`);
    }
  } catch (e) {
    log.warn?.(`[matrix] déclaration du schéma de ${app} non transmise : ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

/**
 * Lit le schéma de la base et le déclare à Matrix. Ne lève jamais d'erreur : à appeler sans l'attendre (`void`).
 * Sans MATRIX_URL ni MATRIX_DECLARATIONS_DIR, il n'y a rien à faire et la base n'est même pas interrogée.
 */
export async function declarerSchemaCodex(query: QueryRows, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!env.MATRIX_URL && !env.MATRIX_DECLARATIONS_DIR) return;
  try {
    const tables = await introspecterPostgres(query);
    await declarerSchema({ app: 'codex', version: env.APP_VERSION ?? null, tables, env });
  } catch (e) {
    console.warn(`[matrix] lecture du schéma de codex impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}
