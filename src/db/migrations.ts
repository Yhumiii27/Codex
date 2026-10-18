import type { PGlite } from '@electric-sql/pglite';

// Versioned migrations (drizzle/, point 41 of docs/reste-a-faire.md). Since 17 October 2026 the schema evolves by
// incremental migrations only: 0000_init is the base, equal to src/db/schema.ts on that day, and each change of the
// schema adds the next file (npm run db:generate), never rewrites one that a database may have applied.
//
// drizzle's migrator only compares instants: it applies every migration of the code younger than the last one the
// database applied, and checks nothing else. So it would replay 0000_init on a database made by an earlier, regenerated
// 0000_init (and fail half-way), skip a migration generated on another branch with an older instant, and say nothing of
// a database made by a newer Codex. migrationPlan() checks first that the database's migrations are the code's first
// ones, the same files (SHA-256, as drizzle hashes them), and says which remain.

/** A migration of the code (lib/backup-core.mjs readMigrations): its tag, the instant of the journal, its SHA-256. */
export type CodeMigration = { tag: string; hash: string; createdAt: number };
/** A migration a database applied (drizzle.__drizzle_migrations). */
export type AppliedMigration = { hash: string; createdAt: number };
/** `fresh`: the database has applied nothing (new); `pending`: tags of the code's migrations it still lacks, in order. */
export type MigrationPlan = { fresh: boolean; pending: string[] };

export class MigrationMismatch extends Error {
  constructor(readonly code: 'order' | 'unknown', message: string) {
    super(message);
    this.name = 'MigrationMismatch';
  }
}

/**
 * Which of the code's migrations a database lacks. Refuses (MigrationMismatch) when the code's journal is not in
 * increasing order of instants (drizzle would skip the out-of-order one), or when a migration the database applied is
 * not the code's at the same rank: a database made by another schema (a 0000_init regenerated before 17 October 2026, a
 * newer Codex, a migration file edited after it was applied).
 */
export function migrationPlan(applied: AppliedMigration[], code: CodeMigration[]): MigrationPlan {
  code.forEach((m, i) => {
    if (i && m.createdAt <= code[i - 1].createdAt) {
      throw new MigrationMismatch('order', `migration ${m.tag} is dated before ${code[i - 1].tag} in drizzle/meta/_journal.json: drizzle would never apply it`);
    }
  });
  const done = [...applied].sort((a, b) => a.createdAt - b.createdAt);
  done.forEach((m, i) => {
    const mine = code[i];
    if (!mine || mine.hash !== m.hash || mine.createdAt !== m.createdAt) {
      const known = code.find((x) => x.hash === m.hash && x.createdAt === m.createdAt);
      throw new MigrationMismatch('unknown', known
        ? `the database applied ${known.tag} out of order`
        : `the database applied a migration this code does not have (instant ${m.createdAt}, sha256 ${m.hash.slice(0, 12)}…): it was made by another version of Codex's schema. Run the version that made it, restore a backup made with this one (npm run restore), or start over (npm run db:reset, which deletes the data)`);
    }
  });
  return { fresh: !done.length, pending: code.slice(done.length).map((m) => m.tag) };
}

/** The migrations a database applied, oldest first; none for a database just created. */
export async function appliedMigrations(client: Pick<PGlite, 'query'>): Promise<AppliedMigration[]> {
  const [{ t }] = (await client.query<{ t: string | null }>(`select to_regclass('drizzle.__drizzle_migrations')::text as t`)).rows;
  if (!t) return [];
  const { rows } = await client.query<{ hash: string; created_at: string }>('select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at');
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}
