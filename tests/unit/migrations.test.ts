import { describe, expect, it } from 'vitest';
import { migrationPlan, MigrationMismatch, type CodeMigration } from '@/db/migrations';
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

describe('seedModeOf (CODEX_SEED)', () => {
  it('is demo by default, demo or minimal when asked, null for anything else', () => {
    expect(seedModeOf({})).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: '' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: ' Minimal ' })).toBe('minimal');
    expect(seedModeOf({ CODEX_SEED: 'demo' })).toBe('demo');
    expect(seedModeOf({ CODEX_SEED: 'reference' })).toBeNull();
  });

  it('is minimal by default on a PostgreSQL server (DATABASE_URL), demo only when asked', () => {
    expect(seedModeOf({ DATABASE_URL: 'postgres://codex@db/codex' })).toBe('minimal');
    expect(seedModeOf({ DATABASE_URL: ' ' })).toBe('demo');
    expect(seedModeOf({ DATABASE_URL: 'postgres://codex@db/codex', CODEX_SEED: 'demo' })).toBe('demo');
  });
});
