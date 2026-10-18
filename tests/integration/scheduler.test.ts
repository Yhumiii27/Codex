import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { verifyExport } from '@/lib/export-core.mjs';
import { writeFullExport } from '@/lib/full-export';
import { LEASE_MS, runTask, schedulerOverview, startScheduler, stopScheduler, TASKS } from '@/lib/scheduler';
import { schedulerState } from '@/lib/scheduler-state';
import { submitChange } from '@/lib/vigie';
import { addDoc, fixClock, getChange, journalOf, revisionStatuses, setClock, setupDb } from '../support/db';

// The internal scheduler on a real database (point 38 of docs/reste-a-faire.md; docs/exploitation.md §4): an approved
// revision enters into force on its date without anyone opening a page, a pending acceptance of Vigie that nothing
// holds any more applies, one run at a time per task whatever the number of processes (lease in scheduler_runs), every
// run recorded, and what it changes journaled under the system actor Codex.

// Tasks that read the database themselves (orphans, backup…) reach it through getDb().
vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

const ID = 'PRO-QUA-0001';
const FIVE_MIN = 300_000;
const promote = (owner = 'process-1') => runTask('promote', { interval: FIVE_MIN, db: db(), owner });
const row = async () => (await db().select().from(s.schedulerRuns).where(eq(s.schedulerRuns.task, 'promote')))[0];

/** Revision A in force, B approved and waiting for its effective date. */
const waiting = (effectiveAt = '2026-10-12') =>
  addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt }] });

afterEach(() => {
  vi.restoreAllMocks();
  stopScheduler();
});

describe('deferred entry into force', () => {
  it('puts an approved revision in force once its date has come, journaled by Codex, and records the run', async () => {
    await waiting();
    expect(await promote()).toMatchObject({ ran: true, status: 'ok', summary: { promoted: 0, decisions: 0 } });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });

    setClock('2026-10-11T22:05:00Z'); // 12 October, 00:05 in Paris
    expect(await promote()).toMatchObject({ ran: true, status: 'ok', summary: { promoted: 1, decisions: 0 } });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'in_force').map((e) => [e.userId, e.detail])).toEqual([['codex', 'B']]);
    expect(await row()).toMatchObject({
      status: 'ok', summary: { promoted: 1, decisions: 0 }, error: null, leaseOwner: null, leaseUntil: null,
      startedAt: '2026-10-11 22:05:00+00', finishedAt: '2026-10-11 22:05:00+00', nextAt: '2026-10-11 22:10:00+00',
    });
  });

  it('runs a task again only once its interval has passed since its last start, whichever process started it', async () => {
    expect(await promote('process-1')).toMatchObject({ ran: true });
    expect(await promote('process-2')).toEqual({ ran: false, reason: 'not_due' });
    setClock('2026-10-10T08:04:58Z');
    expect(await promote('process-2')).toEqual({ ran: false, reason: 'not_due' });
    setClock('2026-10-10T08:05:00Z');
    expect(await promote('process-2')).toMatchObject({ ran: true });
  });

  it('runs a task in one process at a time: a lease held elsewhere stops it until it lapses', async () => {
    await waiting('2026-10-10');
    await db().insert(s.schedulerRuns).values({ task: 'promote', leaseOwner: 'process-2', leaseUntil: '2026-10-10T08:01:00Z', status: 'running', startedAt: '2026-10-10T07:59:00Z' });
    expect(await runTask('promote', { interval: FIVE_MIN, db: db(), owner: 'process-1', force: true })).toEqual({ ran: false, reason: 'not_due' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'approved' });
    // process-2 stopped during its run: once its lease lapses, the run shows as interrupted and another process takes over.
    setClock('2026-10-10T08:04:00Z');
    expect((await schedulerOverview({ seesAll: true }, {}, db())).tasks.find((x) => x.task === 'promote')).toMatchObject({ status: 'error', error: 'interrupted' });
    setClock('2026-10-10T08:05:00Z');
    expect(await promote('process-1')).toMatchObject({ ran: true, summary: { promoted: 1 } });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
  });

  it('lets only one of two processes looking at the same moment run it', async () => {
    await waiting('2026-10-10');
    const runs = await Promise.all([promote('process-1'), promote('process-2')]);
    expect(runs.filter((r) => r.ran)).toHaveLength(1);
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'in_force')).toHaveLength(1);
  });

  it('records a failed run with its error and frees the lease', async () => {
    vi.spyOn(TASKS.promote, 'run').mockRejectedValueOnce(new Error('database gone'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await promote()).toMatchObject({ ran: true, status: 'error', error: 'database gone' });
    expect(await row()).toMatchObject({ status: 'error', error: 'database gone', leaseOwner: null });
    setClock('2026-10-10T08:05:00Z');
    expect(await promote()).toMatchObject({ ran: true, status: 'ok' });
  });
});

describe('pending decisions', () => {
  it('applies an acceptance of Vigie left waiting although nothing holds it any more', async () => {
    await addDoc(db(), { id: ID });
    const id = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer', reason: 'r', description: '' }));
    // Left 'accepted' by a path that did not apply it: the document is unlocked and no revision is open.
    await db().update(s.changeRequests).set({ status: 'accepted', ecoRef: 'ECO-2026-020', decidedAt: '2026-10-09 10:00:00' }).where(eq(s.changeRequests.id, id));
    expect(await promote()).toMatchObject({ ran: true, summary: { promoted: 0, decisions: 1 } });
    expect(await getChange(db(), id)).toMatchObject({ status: 'implemented', ecoRef: 'ECO-2026-020' });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'in_force', B: 'draft' });
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'ecr').map((e) => [e.userId, e.detail])).toContainEqual(['vigie', 'ECO-2026-020 → B']);
  });

  it('leaves waiting an acceptance on a frozen document', async () => {
    await addDoc(db(), { id: ID, legalHold: true });
    const id = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer', reason: 'r', description: '' }));
    await db().update(s.changeRequests).set({ status: 'accepted' }).where(eq(s.changeRequests.id, id));
    expect(await promote()).toMatchObject({ ran: true, summary: { decisions: 0 } });
    expect((await getChange(db(), id)).status).toBe('accepted');
  });
});

describe('export written by the scheduler', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-scheduled-export-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a checked archive, journaled by Codex, and keeps only its most recent ones, never those of npm run export', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await addDoc(db(), { id: ID });
    writeFileSync(path.join(dir, 'codex-export-2026-10-01T00-00-00-000Z.zip'), 'npm run export');
    for (const at of ['2026-10-10T08:00:00Z', '2026-10-10T09:00:00Z', '2026-10-10T10:00:00Z']) {
      setClock(at);
      await writeFullExport('codex', { dir, keep: 2 });
    }
    expect(readdirSync(dir).sort()).toEqual([
      'codex-export-2026-10-01T00-00-00-000Z.zip', 'codex-export-auto-2026-10-10T09-00-00-000Z.zip', 'codex-export-auto-2026-10-10T10-00-00-000Z.zip',
    ]);
    const fh = await open(path.join(dir, 'codex-export-auto-2026-10-10T10-00-00-000Z.zip'), 'r');
    try {
      expect((await verifyExport(fh)).counts.documents).toBe(1);
    } finally {
      await fh.close();
    }
    const journal = await db().select().from(s.auditLog).where(eq(s.auditLog.action, 'export_full'));
    expect(journal.length).toBeGreaterThanOrEqual(3);
    expect(new Set(journal.map((e) => e.userId))).toEqual(new Set(['codex']));
  });
});

describe('administration', () => {
  it('shows each task with its setting, its last run and the next', async () => {
    await promote();
    const view = await schedulerOverview({ seesAll: true }, { CODEX_SCHEDULE_BACKUP: '1d' }, db());
    expect(view).toMatchObject({ enabled: true });
    expect(view.tasks.map((x) => [x.task, x.interval, x.status, x.next])).toEqual([
      ['promote', FIVE_MIN, 'ok', '2026-10-10 08:05:00+00'],
      ['orphans', null, null, null],
      ['renames', null, null, null],
      ['integrity', null, null, null],
      ['backup', 86_400_000, null, null],
      ['export', null, null, null],
    ]);
  });
});

describe('timers', () => {
  it('start once per process, only when the scheduler is on, and tell requests whether to put revisions in force', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    startScheduler({ CODEX_SCHEDULER: 'off' });
    expect(schedulerState()).toMatchObject({ started: false, promotes: false });
    startScheduler({ CODEX_SCHEDULE_PROMOTE: 'off', CODEX_SCHEDULE_BACKUP: '1d' });
    expect(schedulerState()).toMatchObject({ started: true, promotes: false });
    stopScheduler();
    startScheduler({});
    expect(schedulerState()).toMatchObject({ started: true, promotes: true });
  });

  it('keep a lease short enough to be taken over soon after a process stops', () => {
    expect(LEASE_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
