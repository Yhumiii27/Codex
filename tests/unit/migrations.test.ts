import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLegacyChain, migrationPlan, MigrationMismatch, planFor, SERVER_PLAN, type CodeMigration, type Layout } from '@/db/migrations';
import { LEGACY_PUBLIC_CHAIN, readMigrations } from '@/lib/backup-core.mjs';
import { seedModeOf } from '@/lib/seed-mode';

// Versioned migrations (src/db/migrations.ts, point 41 of docs/reste-a-faire.md): a database applies the code's
// migrations in order, and one made by another schema is refused before drizzle replays anything on it.

const code: CodeMigration[] = [
  { tag: '0000_init', hash: 'a'.repeat(64), createdAt: 1000 },
  { tag: '0001_next', hash: 'b'.repeat(64), createdAt: 2000 },
  { tag: '0002_last', hash: 'c'.repeat(64), createdAt: 3000 },
];
const applied = (...xs: CodeMigration[]) => xs.map(({ hash, createdAt }) => ({ hash, createdAt }));

describe('migrationPlan', () => {
  it('applies every migration to a new database', () => {
    expect(migrationPlan([], code)).toEqual({ fresh: true, pending: ['0000_init', '0001_next', '0002_last'] });
  });

  it('applies the migrations a database still lacks, in order', () => {
    expect(migrationPlan(applied(code[0]), code)).toEqual({ fresh: false, pending: ['0001_next', '0002_last'] });
    expect(migrationPlan(applied(code[1], code[0]), code)).toEqual({ fresh: false, pending: ['0002_last'] });
    expect(migrationPlan(applied(...code), code)).toEqual({ fresh: false, pending: [] });
  });

  it('refuses a database made by a regenerated 0000_init (same tag, other file and instant)', () => {
    const old = { hash: 'f'.repeat(64), createdAt: 900 };
    expect(() => migrationPlan([old], code)).toThrow(MigrationMismatch);
    expect(() => migrationPlan([old], code)).toThrow(/another version of Codex's schema/);
  });

  it('refuses a migration file edited after a database applied it', () => {
    expect(() => migrationPlan([{ hash: 'e'.repeat(64), createdAt: 1000 }], code)).toThrow(MigrationMismatch);
  });

  it('refuses a database made by a newer Codex (a migration the code does not have)', () => {
    expect(() => migrationPlan([...applied(...code), { hash: 'd'.repeat(64), createdAt: 4000 }], code)).toThrow(MigrationMismatch);
  });

  it('refuses a database that skipped a migration', () => {
    expect(() => migrationPlan(applied(code[0], code[2]), code)).toThrow(/out of order/);
  });

  it('refuses a journal whose instants go back: drizzle would never apply that migration', () => {
    const merged = [code[0], code[2], { tag: '0003_branch', hash: 'd'.repeat(64), createdAt: 2500 }];
    expect(() => migrationPlan(applied(code[0]), merged)).toThrow(/0003_branch is dated before 0002_last/);
  });
});

describe('the migrations of drizzle/ (decision M-01: schema codex, role codex_app without CREATE on the database)', () => {
  const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql'));

  it('never create a schema nor name public: codex_app may do neither', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const text = readFileSync(path.join('drizzle', f), 'utf8');
      expect(text, f).not.toMatch(/create\s+schema/i);
      expect(text, f).not.toMatch(/"public"|\bpublic\./i);
      expect(text, f).not.toMatch(/create\s+extension/i);
    }
  });

  it('qualify every table they create with the schema codex', () => {
    for (const f of files) {
      for (const m of readFileSync(path.join('drizzle', f), 'utf8').matchAll(/create\s+(?:unique\s+)?(?:table|index|view|or\s+replace\s+view)\s+(?:if\s+not\s+exists\s+)?("?[\w]+"?(?:\."?[\w]+"?)?)/gi)) {
        if (/^create\s+(unique\s+)?index/i.test(m[0])) continue;
        expect(m[1], `${f}: ${m[0]}`).toMatch(/^"?codex"?\./);
      }
    }
  });

  it('keep the chain before the schema codex out of drizzle/, recorded as it was (LEGACY_PUBLIC_CHAIN)', async () => {
    const legacy = await readMigrations(path.join('tests', 'fixtures', 'drizzle-public'));
    expect(legacy).toEqual(LEGACY_PUBLIC_CHAIN);
    const code = await readMigrations('drizzle');
    expect(code.map((m) => m.tag)).toEqual(expect.arrayContaining(['0000_init', '0001_partage']));
    for (const m of code) expect(LEGACY_PUBLIC_CHAIN.some((l) => l.hash === m.hash)).toBe(false);
  });
});

describe('planFor (layout of a database)', () => {
  const none: Layout = { journal: false, applied: [], legacy: false, legacyApplied: [], schema: false, tables: 0 };
  const legacy = { ...none, legacy: true, legacyApplied: LEGACY_PUBLIC_CHAIN.map(({ hash, createdAt }) => ({ hash, createdAt })) };
  const embedded = { embedded: true, remedy: 'REMEDY' };

  it('makes a new database: every migration, no take-up', () => {
    expect(planFor(none, code, embedded)).toEqual({ fresh: true, pending: ['0000_init', '0001_next', '0002_last'] });
    expect(planFor({ ...none, schema: true }, code, SERVER_PLAN)).toEqual({ fresh: true, pending: ['0000_init', '0001_next', '0002_last'] });
  });

  it('migrates a database of the schema codex by its journal', () => {
    expect(planFor({ ...none, journal: true, applied: applied(code[0]), schema: true, tables: 30 }, code, SERVER_PLAN)).toEqual({ fresh: false, pending: ['0001_next', '0002_last'] });
  });

  it('takes up a PGlite database of the last chain before the schema codex: public → codex, then all but 0000_init', () => {
    expect(isLegacyChain(legacy.legacyApplied)).toBe(true);
    expect(planFor(legacy, code, embedded)).toEqual({ fresh: false, pending: ['0001_next', '0002_last'], takeUp: true });
  });

  it('never takes up a server, nor an older chain, nor a database without journal: refused with the remedy', () => {
    expect(() => planFor(legacy, code, SERVER_PLAN)).toThrow(MigrationMismatch);
    expect(() => planFor(legacy, code, SERVER_PLAN)).toThrow(/tables in public/);
    const older = { ...legacy, legacyApplied: legacy.legacyApplied.slice(0, 4) };
    expect(isLegacyChain(older.legacyApplied)).toBe(false);
    expect(() => planFor(older, code, embedded)).toThrow(/version of Codex of 21 October 2026 once.*REMEDY/);
    // The demo of main before 17 October 2026 (the database of the Coolify volume /data/pglite): no journal there either.
    expect(() => planFor({ ...none, legacy: true }, code, embedded)).toThrow(/before the schema codex \(tables in public, no journal\): REMEDY/);
  });

  it('refuses tables in the schema codex without a journal (not made by Codex), and a database taken up halfway', () => {
    expect(() => planFor({ ...none, schema: true, tables: 3 }, code, embedded)).toThrow(/holds 3 table\(s\) but no journal/);
    expect(() => planFor({ ...legacy, schema: true, tables: 2 }, code, embedded)).toThrow(MigrationMismatch);
  });
});

describe('seedModeOf (CODEX_SEED, CODEX_SEED_DEMO)', () => {
  it('is demo by default, demo or minimal when asked, null for anything else', () => {
    expect(seedModeOf({})).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: '' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: ' Minimal ' })).toBe('minimal');
    expect(seedModeOf({ CODEX_SEED: 'demo' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: 'reference' })).toBeNull();
  });

  it('fills nothing on a PostgreSQL server (DATABASE_URL) unless asked, as main did (CODEX_SEED_DEMO=1)', () => {
    const url = 'postgres://codex_app@db/epc2i';
    expect(seedModeOf({ DATABASE_URL: url })).toBe('none');
    expect(seedModeOf({ DATABASE_URL: ' ' })).toBe('demo');
    expect(seedModeOf({ DATABASE_URL: url, CODEX_SEED: 'demo' })).toBe('demo');
    expect(seedModeOf({ DATABASE_URL: url, CODEX_SEED: 'minimal' })).toBe('minimal');
    expect(seedModeOf({ DATABASE_URL: url, CODEX_SEED_DEMO: '1' })).toBe('demo');
    expect(seedModeOf({ DATABASE_URL: url, CODEX_SEED_DEMO: '0' })).toBe('none');
  });

  it('takes CODEX_SEED_DEMO=1 as demo everywhere, and refuses it beside another CODEX_SEED', () => {
    expect(seedModeOf({ CODEX_SEED_DEMO: '1' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED_DEMO: '1', CODEX_SEED: 'demo' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED_DEMO: '1', CODEX_SEED: 'minimal' })).toBeNull();
  });
});
