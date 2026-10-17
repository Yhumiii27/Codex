import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Résultat de db.execute() commun aux deux pilotes (Results de PGlite, QueryResult de node-postgres) : les lignes. */
export interface QueryRows<T> {
  rows: T[];
}
export interface AppQueryResultHKT extends PgQueryResultHKT {
  readonly type: QueryRows<this['row']>;
}
export type DB = PgDatabase<AppQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
