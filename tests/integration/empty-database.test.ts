import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedIfEmpty } from '@/db';
import { EMPTY_DATABASE_PATH, getCtx } from '@/lib/context';
import { currentDb, emptyTables, setupDb } from '../support/db';

// A database left empty (lot 11): on a PostgreSQL server (DATABASE_URL), Codex fills a new database only when asked
// (CODEX_SEED=demo|minimal, or CODEX_SEED_DEMO=1 as main did, lib/seed-mode.ts). Left empty, the server must not fail on
// the first page (a TypeError on user.role in getCtx, before lot 11): every page leads to /base-vide, which says how to
// fill it (src/app/layout.tsx, EmptyDatabase).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

const emptyAll = () => emptyTables(db());

const people = async () => (await db().$client.query<{ n: number }>('select count(*)::int as n from users where not is_system')).rows[0].n;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a new database on a server, without CODEX_SEED', () => {
  it('is left empty, and every page leads to /base-vide instead of failing', async () => {
    await emptyAll();
    vi.stubEnv('DATABASE_URL', 'postgres://codex_app@db/epc2i');
    vi.stubEnv('CODEX_SEED', '');
    vi.stubEnv('CODEX_SEED_DEMO', '');
    await seedIfEmpty(currentDb());
    expect(await people()).toBe(0);
    const err = await getCtx().then(() => null, (e: unknown) => e as { digest?: string });
    expect(err?.digest).toMatch(/^NEXT_REDIRECT;.*;\/base-vide;/);
    expect(EMPTY_DATABASE_PATH).toBe('/base-vide');
  });

  it('receives the reference data and the initial administrator with CODEX_SEED=minimal', async () => {
    await emptyAll();
    vi.stubEnv('DATABASE_URL', 'postgres://codex_app@db/epc2i');
    vi.stubEnv('CODEX_SEED', 'minimal');
    await seedIfEmpty(currentDb());
    expect(await people()).toBe(1);
    const ctx = await getCtx();
    expect(ctx.user.id).toBe('admin');
  });

  it('receives the demonstration with CODEX_SEED_DEMO=1, and is never seeded again', { timeout: 60_000 }, async () => {
    await emptyAll();
    vi.stubEnv('DATABASE_URL', 'postgres://codex_app@db/epc2i');
    vi.stubEnv('CODEX_SEED', '');
    vi.stubEnv('CODEX_SEED_DEMO', '1');
    await seedIfEmpty(currentDb());
    const n = await people();
    expect(n).toBeGreaterThan(5);
    vi.stubEnv('CODEX_SEED', 'minimal');
    vi.stubEnv('CODEX_SEED_DEMO', '');
    await seedIfEmpty(currentDb());
    expect(await people()).toBe(n);
  });
});
