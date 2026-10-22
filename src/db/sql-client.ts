import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// The raw SQL connection behind Codex's drizzle database (db.$client), whichever engine holds the data (point 51 of
// docs/reste-a-faire.md):
// - PGlite, embedded, one connection, in DATA_DIR/pglite: the default, local use, demonstration, Mac app;
// - a PostgreSQL server, through a pool of node-postgres connections, when DATABASE_URL is set: the shared EPC2I server
//   (decision M-01: base epc2i, schema codex, role codex_app), or a server of one's own laid out the same way.
// What the code asks of either is the subset PGlite offers and the pool is made to offer here: query (with $n
// parameters), exec (several statements, no parameter), transaction (one connection for the callback, committed or
// rolled back) and close. What only PGlite can do (copy its data directory: the backup) is reached through embedded().
// No 'server-only' import: the npm commands (scripts/) open databases with it too.

/** Rows as plain objects, typed by the caller. */
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One connection's worth of SQL: a transaction's, or the client's. */
export interface SqlQueryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
}

/** db.$client: PGlite itself, or a pool of server connections (PgServerClient). */
export interface SqlClient extends SqlQueryable {
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The embedded database behind `client`, or null for a PostgreSQL server. */
export function embedded(client: SqlClient): PGlite | null {
  return 'dumpDataDir' in client ? (client as unknown as PGlite) : null;
}

/** Which engine: 'pglite' (embedded) or 'postgres' (a server). */
export function engineOf(client: SqlClient): 'pglite' | 'postgres' {
  return embedded(client) ? 'pglite' : 'postgres';
}

// node-postgres hands int8 (count(*), sums) back as a string and date as a Date at local midnight; PGlite gives a number
// and a Date at UTC midnight. The same values for both, so that a query's result does not depend on the engine (drizzle
// reads its own date and timestamp columns as text on both, whatever these parsers say). Process-wide: Codex is the only
// user of node-postgres in its processes. An int8 beyond 2^53 would lose precision, as it does on PGlite; none of
// Codex's columns is int8.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => new Date(`${v}T00:00:00Z`));
// PGlite's decoder drops a byte order mark (U+FEFF) leading a text value, so that the application never sees one
// (codex_unbom in src/db/index.ts does the same in the database, for the search terms): the same here for text, varchar
// and char values. Arrays and JSON keep theirs, as on PGlite.
const unbom = (v: string) => (v.charCodeAt(0) === 0xfeff ? v.slice(1) : v);
for (const t of [pg.types.builtins.TEXT, pg.types.builtins.VARCHAR, pg.types.builtins.BPCHAR]) pg.types.setTypeParser(t, unbom);

function queryable(c: pg.Pool | pg.PoolClient): SqlQueryable {
  return {
    async query<T = Row>(text: string, params?: unknown[]) {
      const r = await c.query(text, params as unknown[] | undefined);
      return { rows: r.rows as T[] };
    },
    // Without parameters node-postgres sends the simple query protocol, which runs several statements, as PGlite's exec.
    async exec(text: string) {
      return c.query(text);
    },
  };
}

/** A transaction on one connection of `pool`: BEGIN, the callback, COMMIT, or ROLLBACK when it throws. */
async function inTransaction<T>(pool: pg.Pool, fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
  const conn = await pool.connect();
  let broken = false;
  try {
    await conn.query('begin');
    const res = await fn(queryable(conn));
    await conn.query('commit');
    return res;
  } catch (err) {
    await conn.query('rollback').catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    conn.release(broken);
  }
}

/**
 * A session pinned to one connection (temporary tables, session locks live as long as it). release(true) closes the
 * connection instead of handing it back to the pool: what it holds (a lock taken before an error) goes with it.
 */
export type PinnedSession = SqlClient & { release(destroy?: boolean): void };

/** The SqlClient of a PostgreSQL server: a pool of node-postgres connections. */
export class PgServerClient implements SqlClient {
  private readonly q: SqlQueryable;

  constructor(readonly pool: pg.Pool, private readonly onClose?: () => Promise<void>) {
    this.q = queryable(pool);
  }

  query<T = Row>(text: string, params?: unknown[]) {
    return this.q.query<T>(text, params);
  }

  exec(text: string) {
    return this.q.exec(text);
  }

  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, fn);
  }

  /**
   * One connection kept for a whole task (lib/export-core.mjs: its temporary tables are seen only by the connection that
   * made them), handed back by release().
   */
  async session(): Promise<PinnedSession> {
    const conn = await this.pool.connect();
    const q = queryable(conn);
    let released = false;
    return {
      ...q,
      async transaction<T>(fn: (tx: SqlQueryable) => Promise<T>) {
        await conn.query('begin');
        try {
          const res = await fn(q);
          await conn.query('commit');
          return res;
        } catch (err) {
          await conn.query('rollback').catch(() => {});
          throw err;
        }
      },
      async close() {
        if (!released) conn.release();
        released = true;
      },
      release(destroy = false) {
        if (!released) conn.release(destroy);
        released = true;
      },
    };
  }

  async close() {
    await this.pool.end();
    await this.onClose?.();
  }
}

/** The database server DATABASE_URL names, or null for the embedded database (the default). */
export function databaseUrlOf(env: Readonly<Record<string, string | undefined>>): string | null {
  return env.DATABASE_URL?.trim() || null;
}

/** DATABASE_URL without its password, for the logs and the commands' messages. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(DATABASE_URL illisible)';
  }
}

/**
 * Largest number of server connections of one Codex process: CODEX_DB_POOL (the shared server's name, Matrix
 * infra/postgres/README.md), or CODEX_DB_POOL_MAX (its former name here); default 10, at least 2: opening the database
 * migrates on one connection while another holds the migration lock.
 */
export function poolMaxOf(env: Readonly<Record<string, string | undefined>>): number {
  const n = Number((env.CODEX_DB_POOL?.trim() || env.CODEX_DB_POOL_MAX?.trim()));
  return Number.isInteger(n) && n >= 2 && n <= 200 ? n : 10;
}

/**
 * Queries sent to one connection while another is running (Promise.all over a transaction, as PGlite allows) are queued
 * by node-postgres 8, with a deprecation warning: version 9 will refuse them. Each connection chains them itself, so that
 * the code may keep sending them at once. Callback calls (the pool's own) and cursors are left as they are.
 */
function chainQueries(client: pg.PoolClient): void {
  const own = client.query.bind(client) as (...args: unknown[]) => unknown;
  let tail: Promise<unknown> = Promise.resolve();
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const first = args[0] as { submit?: unknown } | undefined;
    if (typeof args[args.length - 1] === 'function' || typeof first?.submit === 'function') return own(...args);
    const run = tail.then(() => own(...args));
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * A pool of connections to `url`, named codex in pg_stat_activity, whose search_path is the schema codex (src/db/schema.ts
 * DB_SCHEMA; the shared server also sets it on the role codex_app): Codex's plain table names resolve there.
 */
export function serverPool(url: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'codex', options: '-c search_path=codex' });
  pool.on('connect', chainQueries);
  return pool;
}
