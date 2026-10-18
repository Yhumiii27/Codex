import 'server-only';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@/db';
import type { SchedulerStatus } from '@/db/schema';
import { backUpNow } from './backup';
import { scheduledExportDir, scheduledExportKeep, writeFullExport } from './full-export';
import { checkFilesNow } from './integrity';
import { applyDuePendingDecisions, promoteDue } from './lifecycle';
import { logger, serializeError } from './log';
import { purgeOrphans } from './orphans';
import { intervalOf, SCHEDULE, schedulerEnabled, schedulerState, TASK_NAMES, type TaskName } from './scheduler-state';

export { intervalOf, MIN_INTERVAL_MS, parseInterval, SCHEDULE, schedulerEnabled, TASK_NAMES, type TaskName } from './scheduler-state';

// Internal scheduler (point 38 of docs/reste-a-faire.md; docs/exploitation.md §4): tasks run in the server process at
// a regular interval, each set by its variable. Started by src/instrumentation.ts when the server starts (next dev,
// next start, the Mac app), never during next build nor in tests.
//
// Only the deferred entry into force runs by default (every 5 minutes): approved revisions whose effective date has come
// enter into force, and acceptances of Vigie that nothing holds any more apply. The maintenance tasks (orphan files,
// integrity check, backup, full export) are off: how often they should run, and where archives should go, belong to the
// hosting, which is not decided (M22).
//
// One run at a time per task, whatever the number of Codex processes on the database (a PostgreSQL server may serve
// several): a process runs a task under a lease in the table scheduler_runs, renewed while it runs and taken over once
// expired (a process stopped mid-run), and only once the last start of that task is at least one interval old.
//
// Every run is written to the technical log (scope "scheduler"); what it changes is journaled by the task itself, under
// the system actor Codex (entry into force, decision applied, files removed, check, backup, export).
//
// Extension point: reminders and notifications outside the application (overdue validations, reviews, retention), and
// sends to Vigie or Keystone, will be tasks of TASKS below. Neither exists: who to alert, when, and through which channel
// (M19, Teams or Outlook not discussed) are not decided, and outgoing calls wait for the real integrations (T-01, O-03,
// O-10). A task returns its figures; the scheduler does the rest (lease, log, state shown in Administration).

const log = logger('scheduler');

/** The system actor the tasks act and journal under. */
export const SCHEDULER_ACTOR = 'codex';

export type TaskOutcome = { status: 'ok' | 'skipped'; summary: Record<string, unknown> };

/** What each task does; its variable and default interval are in lib/scheduler-state.ts (SCHEDULE). */
export const TASKS: Record<TaskName, { run: (db: Db) => Promise<TaskOutcome> }> = {
  promote: {
    run: async (db) => ({ status: 'ok', summary: { promoted: await promoteDue(db), decisions: await applyDuePendingDecisions(db) } }),
  },
  orphans: {
    run: async () => {
      const r = await purgeOrphans(SCHEDULER_ACTOR);
      if (r === 'busy') return { status: 'skipped', summary: { reason: 'busy' } };
      return { status: 'ok', summary: { removed: r.removed.length, bytes: r.bytes, failed: r.failed, left: r.left } };
    },
  },
  integrity: {
    run: async () => {
      const r = await checkFilesNow(SCHEDULER_ACTOR);
      if (r === 'busy') return { status: 'skipped', summary: { reason: 'busy' } };
      return { status: 'ok', summary: { checked: r.checked, altered: r.alteredCount, missing: r.missingCount } };
    },
  },
  backup: {
    run: async () => {
      const r = await backUpNow(SCHEDULER_ACTOR);
      if (r === 'busy' || r === 'server') return { status: 'skipped', summary: { reason: r } };
      if ('recent' in r) return { status: 'skipped', summary: { reason: 'recent' } };
      return { status: 'ok', summary: { archive: r.name, size: r.size, rotatedOut: r.removed.length } };
    },
  },
  export: {
    run: async () => {
      const r = await writeFullExport(SCHEDULER_ACTOR, { dir: scheduledExportDir(), keep: scheduledExportKeep() });
      return { status: 'ok', summary: { archive: r.path.split(/[\\/]/).pop(), size: r.size, files: r.files, rotatedOut: r.removed.length } };
    },
  },
};

type Env = Readonly<Record<string, string | undefined>>;

// ── Lease and run ───────────────────────────────────────────────────────

/** How long a lease holds without being renewed; renewed every third of it while the task runs. */
export const LEASE_MS = 120_000;
/** Timers fire a little late, never early: by default, a start this close to one interval old counts as due. */
const SLACK_MS = 1000;

/** This process, as a lease names it. */
const OWNER = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;

const iso = (ms: number) => new Date(ms).toISOString();
/** A timestamptz as the database hands it back ("2026-10-18 08:00:00.123+00") → milliseconds. */
const instantOf = (ts: string) => Date.parse(ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));

/** Tasks this process is running: never twice at once in one process. */
const g = globalThis as unknown as { __codexSchedulerRunning?: Set<TaskName>; __codexSchedulerTimers?: NodeJS.Timeout[] };
const running = (g.__codexSchedulerRunning ??= new Set());

export type RunResult =
  | { ran: false; reason: 'running' | 'not_due' }
  | { ran: true; status: SchedulerStatus; summary: Record<string, unknown>; error?: string; ms: number };

/**
 * Runs `task` now if it is due and no other process holds it: takes the lease (a row of scheduler_runs), runs it,
 * renews the lease meanwhile, then records what it did and when the next run comes, and writes it to the technical log.
 * `interval`: the task's (intervalOf); `slack`: how much earlier than one interval after the last start it may run
 * (the timers pass half a look's period, so that a run is never put off by a whole look); `force` runs it even if not
 * due (tests). `owner`: this process (tests set another to play a second process).
 */
export async function runTask(task: TaskName, opts: { interval: number; slack?: number; db?: Db; owner?: string; force?: boolean; now?: () => number } = { interval: 0 }): Promise<RunResult> {
  const owner = opts.owner ?? OWNER;
  const now = opts.now ?? Date.now;
  if (running.has(task) && owner === OWNER) return { ran: false, reason: 'running' };
  const db = opts.db ?? (await getDb());
  const t0 = now();
  await db.insert(s.schedulerRuns).values({ task }).onConflictDoNothing();
  const due = opts.force ? undefined : or(isNull(s.schedulerRuns.startedAt), lte(s.schedulerRuns.startedAt, iso(t0 - opts.interval + (opts.slack ?? SLACK_MS))));
  const [got] = await db.update(s.schedulerRuns)
    .set({ leaseOwner: owner, leaseUntil: iso(t0 + LEASE_MS), startedAt: iso(t0), status: 'running', error: null })
    .where(and(eq(s.schedulerRuns.task, task), or(isNull(s.schedulerRuns.leaseUntil), lt(s.schedulerRuns.leaseUntil, iso(t0))), due))
    .returning({ task: s.schedulerRuns.task });
  if (!got) {
    log.debug('task not due, or run by another process', { task });
    return { ran: false, reason: 'not_due' };
  }
  running.add(task);
  const renew = setInterval(() => {
    db.update(s.schedulerRuns).set({ leaseUntil: iso(now() + LEASE_MS) }).where(and(eq(s.schedulerRuns.task, task), eq(s.schedulerRuns.leaseOwner, owner)))
      .catch((err: unknown) => log.warn('lease not renewed', { task, err }));
  }, LEASE_MS / 3);
  renew.unref?.();
  let status: SchedulerStatus;
  let summary: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    const out = await TASKS[task].run(db);
    status = out.status;
    summary = out.summary;
  } catch (err) {
    status = 'error';
    error = String(serializeError(err).message ?? 'error');
    log.error('task failed', { task, err });
  } finally {
    clearInterval(renew);
    running.delete(task);
  }
  const t1 = now();
  try {
    await db.update(s.schedulerRuns)
      .set({ leaseOwner: null, leaseUntil: null, finishedAt: iso(t1), status, summary, error: error ?? null, nextAt: opts.interval ? iso(t0 + opts.interval) : null })
      .where(and(eq(s.schedulerRuns.task, task), eq(s.schedulerRuns.leaseOwner, owner)));
  } catch (err) {
    log.error('task state not recorded', { task, err });
  }
  if (status !== 'error') log.info(status === 'ok' ? 'task done' : 'task skipped', { task, ms: t1 - t0, ...summary });
  return { ran: true, status, summary, ...(error ? { error } : {}), ms: t1 - t0 };
}

// ── Timers ──────────────────────────────────────────────────────────────

/** The first look after the server starts: it is left to answer its first requests first. */
export const START_DELAY_MS = 5000;
/** A task is looked at this often at most (its interval when shorter): whichever process sees it due first runs it. */
export const CHECK_MS = 60_000;

/**
 * Starts the timers of the tasks that are on, once per process (src/instrumentation.ts). A look that fails (the database
 * cannot be opened, a run fails) is logged and the next look comes as planned. The timers never keep the process alive.
 */
export function startScheduler(env: Env = process.env): void {
  const state = schedulerState();
  if (state.started) return;
  if (!schedulerEnabled(env)) {
    log.info('scheduler off (CODEX_SCHEDULER): approved revisions enter into force when a page is opened');
    return;
  }
  const on = TASK_NAMES.map((task) => ({ task, interval: intervalOf(task, env) })).filter((x): x is { task: TaskName; interval: number } => x.interval != null);
  state.started = true;
  state.promotes = on.some((x) => x.task === 'promote');
  const timers = (g.__codexSchedulerTimers ??= []);
  for (const { task, interval } of on) {
    const period = Math.min(interval, CHECK_MS);
    const look = () => {
      runTask(task, { interval, slack: period / 2 }).catch((err: unknown) => log.error('task not run', { task, err }));
    };
    const first = setTimeout(() => {
      look();
      const every = setInterval(look, period);
      every.unref?.();
      timers.push(every);
    }, START_DELAY_MS);
    first.unref?.();
    timers.push(first);
  }
  log.info('scheduler started', { tasks: Object.fromEntries(on.map((x) => [x.task, `${Math.round(x.interval / 1000)}s`])), off: TASK_NAMES.filter((t) => !on.some((x) => x.task === t)) });
}

/** Stops the timers (tests). */
export function stopScheduler(): void {
  for (const t of g.__codexSchedulerTimers ?? []) clearTimeout(t);
  g.__codexSchedulerTimers = [];
  const state = schedulerState();
  state.started = false;
  state.promotes = false;
}

// ── State shown in Administration ───────────────────────────────────────

export type TaskView = {
  task: TaskName;
  env: string;
  /** Interval in milliseconds, null when off (in the process that renders the page). */
  interval: number | null;
  lastStart: string | null;
  lastEnd: string | null;
  status: SchedulerStatus | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  /** When the next run is planned: after the last start, or at the first look of a task never run; null when off. */
  next: string | null;
};

/** Every task with its setting and its last run, for Administration › Journal d'audit. */
export async function schedulerOverview(env: Env = process.env, db?: Db, now = Date.now()): Promise<{ enabled: boolean; started: boolean; tasks: TaskView[] }> {
  const rows = await (db ?? (await getDb())).select().from(s.schedulerRuns);
  const by = new Map(rows.map((r) => [r.task, r]));
  return {
    enabled: schedulerEnabled(env),
    started: schedulerState().started,
    tasks: TASK_NAMES.map((task) => {
      const r = by.get(task);
      const interval = intervalOf(task, env);
      // A run whose lease lapsed without its end being recorded: the process stopped during it.
      const lapsed = r?.status === 'running' && (!r.leaseUntil || instantOf(r.leaseUntil) < now);
      return {
        task, env: SCHEDULE[task].env, interval,
        lastStart: r?.startedAt ?? null, lastEnd: r?.finishedAt ?? null, status: lapsed ? 'error' : r?.status ?? null,
        summary: r?.summary ?? null, error: lapsed ? 'interrupted' : r?.error ?? null,
        next: interval == null ? null : r?.nextAt ?? null,
      };
    }),
  };
}
