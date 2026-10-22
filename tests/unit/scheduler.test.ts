import { describe, expect, it } from 'vitest';
import { intervalOf, parseInterval, schedulerEnabled, schedulerPromotes, schedulerState, TASK_NAMES } from '@/lib/scheduler-state';

// Settings of the internal scheduler (point 38 of docs/reste-a-faire.md; docs/exploitation.md §4): only the deferred
// entry into force runs by default; the maintenance tasks, whose frequency belongs to the hosting (not decided), are off
// until their variable sets one.

describe('intervals', () => {
  it('reads <n><unit> in seconds, minutes, hours or days; off and 0 turn a task off; anything else is not an interval', () => {
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval(' 5m ')).toBe(300_000);
    expect(parseInterval('6H')).toBe(21_600_000);
    expect(parseInterval('1d')).toBe(86_400_000);
    expect(parseInterval('off')).toBeNull();
    expect(parseInterval('0')).toBeNull();
    expect(parseInterval('0m')).toBeNull();
    for (const v of ['5', '5 minutes', '1w', '-5m', '1.5h', 'daily']) expect(parseInterval(v), v).toBeUndefined();
    expect(parseInterval(undefined)).toBeUndefined();
  });

  it('raises an interval under 10 seconds to 10 seconds', () => {
    expect(parseInterval('1s')).toBe(10_000);
  });

  it('runs only the deferred entry into force by default, every 5 minutes', () => {
    expect(Object.fromEntries(TASK_NAMES.map((t) => [t, intervalOf(t, {})]))).toEqual({ promote: 300_000, orphans: null, renames: null, integrity: null, backup: null, export: null });
  });

  it('turns a maintenance task on by its variable, and keeps the default for a value it cannot read', () => {
    expect(intervalOf('backup', { CODEX_SCHEDULE_BACKUP: '1d' })).toBe(86_400_000);
    expect(intervalOf('backup', { CODEX_SCHEDULE_BACKUP: 'daily' })).toBeNull();
    expect(intervalOf('promote', { CODEX_SCHEDULE_PROMOTE: 'off' })).toBeNull();
    expect(intervalOf('promote', { CODEX_SCHEDULE_PROMOTE: 'often' })).toBe(300_000);
  });

  it('stops every task with CODEX_SCHEDULER=off', () => {
    expect(schedulerEnabled({ CODEX_SCHEDULER: 'off' })).toBe(false);
    expect(schedulerEnabled({ CODEX_SCHEDULER: 'on' })).toBe(true);
    expect(TASK_NAMES.map((t) => intervalOf(t, { CODEX_SCHEDULER: '0', CODEX_SCHEDULE_BACKUP: '1d' }))).toEqual([null, null, null, null, null, null]);
  });
});

describe('requests', () => {
  it('put revisions in force themselves unless the scheduler of the process does', () => {
    const state = schedulerState();
    const saved = { ...state };
    try {
      Object.assign(state, { started: false, promotes: false });
      expect(schedulerPromotes()).toBe(false);
      Object.assign(state, { started: true, promotes: false });
      expect(schedulerPromotes()).toBe(false);
      Object.assign(state, { started: true, promotes: true });
      expect(schedulerPromotes()).toBe(true);
    } finally {
      Object.assign(state, saved);
    }
  });
});
