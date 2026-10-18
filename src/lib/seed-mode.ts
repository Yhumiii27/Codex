// What a new database receives the first time Codex opens it (src/db/seed.ts, point 45 of docs/reste-a-faire.md):
// CODEX_SEED=demo (default) or minimal. Read only when the database is empty: an existing database is never seeded again.
//
// - demo: the reference data and the demonstration (fictitious people, projects, programmes, documents, circuits, Vigie
//   requests, journal), as before;
// - minimal: the reference data alone (register of types and families, approval functions, permission matrix, the
//   provisional departments and sites, the system actors) and one initial administrator to log in with. People,
//   holders of functions and projects come later: Administration, the org chart (O-04), the authentication (O-02).
//
// The default stays demo everywhere, development and production alike (the Mac app runs `next start`), so that nothing
// changes for a database reset as before; a real deployment sets CODEX_SEED=minimal (README, .env.example).

export const SEED_MODES = ['demo', 'minimal'] as const;
export type SeedMode = (typeof SEED_MODES)[number];

/** The mode CODEX_SEED asks for, demo when unset or empty, null when it names no mode (refused, never guessed). */
export function seedModeOf(env: Readonly<Record<string, string | undefined>>): SeedMode | null {
  const v = env.CODEX_SEED?.trim().toLowerCase();
  if (!v) return 'demo';
  return (SEED_MODES as readonly string[]).includes(v) ? (v as SeedMode) : null;
}
