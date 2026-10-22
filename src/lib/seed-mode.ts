// What a new database receives the first time Codex opens it (src/db/seed.ts, point 45 of docs/reste-a-faire.md). Read
// only when the database is empty: an existing database is never seeded again.
//
// - demo: the reference data and the demonstration (fictitious people, projects, programmes, documents, circuits, Vigie
//   requests, journal);
// - minimal: the reference data alone (register of types and families, approval functions, permission matrix, the
//   provisional departments and sites, the system actors) and one initial administrator to log in with. People,
//   holders of functions and projects come later: Administration, the org chart (O-04), the authentication (O-02);
// - none: nothing. The server starts and every page says the database is empty and how to fill it (src/app/layout.tsx,
//   EmptyDatabase); nothing is written until someone says what to write.
//
// Two variables say it, the one of this branch and the one of main (lot 11, docs/decisions.md):
// - CODEX_SEED=demo|minimal, whatever the engine;
// - CODEX_SEED_DEMO=1, the shared server's variable (Matrix, infra/postgres/README.md): demo. With CODEX_SEED set to
//   another mode as well, the configuration is refused rather than guessed.
// Neither: demo for the embedded database (development, Mac app: as before a db:reset), none on a PostgreSQL server
// (DATABASE_URL): a server database is filled only when asked, as main did with CODEX_SEED_DEMO.

export const SEED_MODES = ['demo', 'minimal'] as const;
export type SeedMode = (typeof SEED_MODES)[number];

/** The mode asked for (see above); null when CODEX_SEED names no mode, or contradicts CODEX_SEED_DEMO=1 (refused). */
export function seedModeOf(env: Readonly<Record<string, string | undefined>>): SeedMode | 'none' | null {
  const v = env.CODEX_SEED?.trim().toLowerCase();
  const demoFlag = env.CODEX_SEED_DEMO?.trim() === '1';
  if (v) {
    if (!(SEED_MODES as readonly string[]).includes(v)) return null;
    return demoFlag && v !== 'demo' ? null : (v as SeedMode);
  }
  if (demoFlag) return 'demo';
  return env.DATABASE_URL?.trim() ? 'none' : 'demo';
}
