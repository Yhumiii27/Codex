import { describe, expect, it } from 'vitest';
import type { RetentionTrigger } from '@/db/schema';
import { retainUntil, triggerDate } from '@/lib/retention';

// Retention class per document type (D-20), counted per document from its trigger event (docs/modele-cible.md §8).

type RetDoc = Parameters<typeof retainUntil>[0];

const doc = (over: Partial<RetDoc> & { retentionTrigger: RetentionTrigger }): RetDoc => ({
  retentionYears: 10, retentionDisposition: 'destroy',
  createdAt: '2026-03-15', issuedAt: null, obsoleteAt: null, archivedAt: null, expiresAt: null,
  ...over,
});

describe('triggerDate and retainUntil, per trigger', () => {
  it('creation: from the creation date', () => {
    const d = doc({ retentionTrigger: 'creation', retentionYears: 5 });
    expect(triggerDate(d)).toBe('2026-03-15');
    expect(retainUntil(d)).toBe('2031-03-15');
  });

  it('in_force: from the entry into force, unknown before it', () => {
    expect(retainUntil(doc({ retentionTrigger: 'in_force' }))).toBeNull();
    const d = doc({ retentionTrigger: 'in_force', issuedAt: '2026-06-01' });
    expect(triggerDate(d)).toBe('2026-06-01');
    expect(retainUntil(d)).toBe('2036-06-01');
  });

  it('superseded: from the withdrawal of the document (Vigie), else from its archiving (§8)', () => {
    expect(triggerDate(doc({ retentionTrigger: 'superseded', issuedAt: '2026-06-01' }))).toBeNull();
    expect(retainUntil(doc({ retentionTrigger: 'superseded', issuedAt: '2026-06-01' }))).toBeNull();
    const archived = doc({ retentionTrigger: 'superseded', retentionYears: 3, archivedAt: '2027-01-10' });
    expect(triggerDate(archived)).toBe('2027-01-10');
    expect(retainUntil(archived)).toBe('2030-01-10');
    const withdrawnThenArchived = doc({ retentionTrigger: 'superseded', retentionYears: 3, obsoleteAt: '2026-11-02', archivedAt: '2027-01-10' });
    expect(triggerDate(withdrawnThenArchived)).toBe('2026-11-02');
    expect(retainUntil(withdrawnThenArchived)).toBe('2029-11-02');
  });

  it('contract_end and expiry: from the expiry date', () => {
    for (const t of ['contract_end', 'expiry'] as const) {
      expect(retainUntil(doc({ retentionTrigger: t })), t).toBeNull();
      const d = doc({ retentionTrigger: t, retentionYears: 5, expiresAt: '2028-09-30' });
      expect(triggerDate(d), t).toBe('2028-09-30');
      expect(retainUntil(d), t).toBe('2033-09-30');
    }
  });

  it('fiscal_year_end: from 31 December of the year of entry into force, else of creation', () => {
    const issued = doc({ retentionTrigger: 'fiscal_year_end', issuedAt: '2027-02-01' });
    expect(triggerDate(issued)).toBe('2027-12-31');
    expect(retainUntil(issued)).toBe('2037-12-31');
    const draft = doc({ retentionTrigger: 'fiscal_year_end' });
    expect(triggerDate(draft)).toBe('2026-12-31');
    expect(retainUntil(draft)).toBe('2036-12-31');
  });

  it('project_end, asset_life, employee_departure: not computable, Codex does not know the event', () => {
    for (const t of ['project_end', 'asset_life', 'employee_departure'] as const) {
      const d = doc({ retentionTrigger: t, issuedAt: '2026-06-01', expiresAt: '2028-01-01', archivedAt: '2029-01-01' });
      expect(triggerDate(d), t).toBeNull();
      expect(retainUntil(d), t).toBeNull();
    }
  });
});

describe('retainUntil, permanent retention and missing durations', () => {
  it('never ends for a permanent trigger or a permanent disposition', () => {
    expect(triggerDate(doc({ retentionTrigger: 'permanent' }))).toBeNull();
    expect(retainUntil(doc({ retentionTrigger: 'permanent', retentionYears: 10, issuedAt: '2026-06-01' }))).toBeNull();
    expect(retainUntil(doc({ retentionTrigger: 'creation', retentionDisposition: 'permanent', retentionYears: 10 }))).toBeNull();
  });

  it('has no end without a duration', () => {
    expect(retainUntil(doc({ retentionTrigger: 'creation', retentionYears: null }))).toBeNull();
    expect(retainUntil(doc({ retentionTrigger: 'in_force', retentionYears: null, issuedAt: '2026-06-01' }))).toBeNull();
  });

  it('ends on the trigger date itself for a duration of zero years', () => {
    expect(retainUntil(doc({ retentionTrigger: 'creation', retentionYears: 0 }))).toBe('2026-03-15');
  });

  it('keeps 29 February on the 28th in a non-leap year', () => {
    expect(retainUntil(doc({ retentionTrigger: 'in_force', retentionYears: 1, issuedAt: '2028-02-29' }))).toBe('2029-02-28');
    expect(retainUntil(doc({ retentionTrigger: 'in_force', retentionYears: 4, issuedAt: '2028-02-29' }))).toBe('2032-02-29');
  });
});
