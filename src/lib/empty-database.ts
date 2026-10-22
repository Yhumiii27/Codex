import 'server-only';
import { connection } from 'next/server';
import { getDb } from '@/db';

// A database left empty: a server database that no CODEX_SEED nor CODEX_SEED_DEMO asked to fill (src/db/index.ts
// seedIfEmpty, lib/seed-mode.ts). Nobody to act as: the root layout renders EmptyDatabase in place of the shell, getCtx
// leads every page to /base-vide (lib/context.ts), /api/health says `empty: true`.

const g = globalThis as unknown as { __codexFilled?: boolean };

/** True while the database has no person (system actors aside). Asked at every request until false once: a database never empties again. */
export async function databaseIsEmpty(): Promise<boolean> {
  // A request-time question: never asked while `next build` prerenders (the root layout of /_not-found would open the
  // database at build time).
  await connection();
  if (g.__codexFilled) return false;
  const db = await getDb();
  const [{ empty }] = (await db.$client.query<{ empty: boolean }>('select not exists (select from users where not is_system) as empty')).rows;
  if (!empty) g.__codexFilled = true;
  return empty;
}
