// Options of every PGlite Codex opens (the server, src/db/index.ts; the commands npm run backup, restore, export,
// integrity, registry:apply, db:migrate). No 'server-only': plain Node scripts import it, inside the image too.
//
// PGlite starts its one session with `-c search_path=public` (PGlite.defaultStartParams) and applies no setting stored
// in the database (ALTER DATABASE … SET is not read in its single-user mode). Since lot 11 Codex's tables are in the
// schema codex (decision M-01, src/db/schema.ts DB_SCHEMA): the session starts with search_path codex, then public,
// which stays empty in a database of this layout and still holds the tables of a database made before it (read by the
// backup taken before its take-up, src/db/migrations.ts). Objects are created in codex, the first schema that exists.

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

/** search_path of a PGlite session of Codex. */
export const PGLITE_SEARCH_PATH = 'codex, public';

/**
 * Options of `new PGlite(…)` for a database of Codex: its data directory (undefined, or memory://: in memory), the
 * pg_trgm extension (search, document_terms) and the search_path above.
 * @param {string | undefined} dataDir
 */
export function pgliteOptions(dataDir) {
  const startParams = PGlite.defaultStartParams.map((p) => (p.startsWith('search_path=') ? `search_path=${PGLITE_SEARCH_PATH}` : p));
  return { dataDir, extensions: { pg_trgm }, startParams };
}
