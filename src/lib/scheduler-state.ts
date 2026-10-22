// The settings of the scheduler (lib/scheduler.ts) and what it does in this process, apart from it so that
// lib/context.ts and the configuration check (lib/config-check.ts) read them without loading the tasks. The state is on
// globalThis: src/instrumentation.ts, which starts the scheduler, is bundled apart from the pages and routes, and dev hot
// reloads load this module again; all of them must see one state.

type SchedulerState = {
  /** The scheduler runs in this process (started by src/instrumentation.ts). */
  started: boolean;
  /** It runs the deferred entry into force (task "promote"): requests no longer need to. */
  promotes: boolean;
};

const g = globalThis as unknown as { __codexScheduler?: SchedulerState };

export function schedulerState(): SchedulerState {
  return (g.__codexScheduler ??= { started: false, promotes: false });
}

/**
 * Whether the scheduler of this process puts approved revisions in force on their date. While it does not (scheduler
 * off, tests, a process that never started it), each request does it lazily, as before (lib/context.ts).
 */
export function schedulerPromotes(): boolean {
  const s = schedulerState();
  return s.started && s.promotes;
}

// ── Settings ────────────────────────────────────────────────────────────

export type TaskName = 'promote' | 'orphans' | 'renames' | 'integrity' | 'backup' | 'export';

/**
 * Each task's variable and its interval when the variable is unset. Only the deferred entry into force is on by
 * default; the maintenance tasks wait for the hosting to say how often (M22).
 */
export const SCHEDULE: Record<TaskName, { env: string; def: string }> = {
  promote: { env: 'CODEX_SCHEDULE_PROMOTE', def: '5m' },
  orphans: { env: 'CODEX_SCHEDULE_ORPHANS', def: 'off' },
  renames: { env: 'CODEX_SCHEDULE_RENAMES', def: 'off' },
  integrity: { env: 'CODEX_SCHEDULE_INTEGRITY', def: 'off' },
  backup: { env: 'CODEX_SCHEDULE_BACKUP', def: 'off' },
  export: { env: 'CODEX_SCHEDULE_EXPORT', def: 'off' },
};

export const TASK_NAMES = Object.keys(SCHEDULE) as TaskName[];

/** Shortest interval admitted: a shorter one would run a task almost without pause. */
export const MIN_INTERVAL_MS = 10_000;
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * An interval: "<n><unit>" with s, m, h or d (30s, 5m, 6h, 1d). Null for "off" or "0"; undefined for a value that is
 * none of these. A value under MIN_INTERVAL_MS is raised to it.
 */
export function parseInterval(raw: string | undefined): number | null | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'off' || v === '0') return null;
  const m = /^(\d{1,6})\s*([smhd])$/.exec(v);
  if (!m) return undefined;
  const ms = Number(m[1]) * UNIT_MS[m[2]];
  return ms === 0 ? null : Math.max(MIN_INTERVAL_MS, ms);
}

/** CODEX_SCHEDULER=off stops the whole scheduler (requests then put revisions in force, as before). On by default. */
export function schedulerEnabled(env: Env = process.env): boolean {
  return !/^(0|false|off|no)$/i.test(env.CODEX_SCHEDULER?.trim() ?? '');
}

/** The interval of a task, in milliseconds, or null when it is off: its variable, else its default. */
export function intervalOf(task: TaskName, env: Env = process.env): number | null {
  if (!schedulerEnabled(env)) return null;
  const spec = SCHEDULE[task];
  const own = parseInterval(env[spec.env]);
  return own !== undefined ? own : parseInterval(spec.def)!;
}
