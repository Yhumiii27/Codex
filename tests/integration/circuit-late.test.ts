import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { getCtx } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { DICT } from '@/lib/i18n';
import { departmentPage, docWorkflows, validationsPage } from '@/lib/queries';
import { addDoc, addWorkflow, setClock, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs, setLangCookie } from '../support/session';

// Indicateur « en retard » des circuits (point 87 of docs/reste-a-faire.md, display only): a running circuit whose due day
// (workflows.due) has passed in Paris time, in Validations (list and header), the Validation tab of the record and the
// department page. Nothing about a circuit the user may not see (D-14); neither the 7-day delay nor « À traiter » change.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
const t = DICT.fr;

/** A procedure of QUA in review, its circuit due on 20 October 2026 (addWorkflow), waiting for `head`. */
async function running(id = 'PRO-QUA-0001', wf = 'WF-1', conf: 'interne' | 'confidentiel' = 'interne') {
  await addDoc(db(), { id, conf, revisions: [{ letter: 'A', status: 'in_review', versions: ['owner'] }] });
  await addWorkflow(db(), { id: wf, docId: id, letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['head'] });
}
const as = async (who: Person) => { actAs(who); return getCtx(); };
const late = (w: { daysLate: number; lateL: string | null; lateTitle: string | null }) => [w.daysLate, w.lateL, w.lateTitle];

describe('circuit overdue indicator (point 87)', () => {
  it('is not late on its due day in Paris, and late from the next day there (UTC still on the due day)', async () => {
    await running();
    setClock('2026-10-20T21:30:00Z'); // 23:30 in Paris, on the due day
    expect(late((await validationsPage(await as('head'))).selected!)).toEqual([0, null, null]);
    setClock('2026-10-20T22:30:00Z'); // 00:30 in Paris, the next day
    const ctx = await as('head');
    const page = await validationsPage(ctx);
    const title = t.wf_late_title.replace('{date}', fmtDate('2026-10-20', 'fr')).replace('{n}', '1');
    expect(late(page.selected!)).toEqual([1, t.wf_late, title]);
    expect(late(page.list[0])).toEqual([1, t.wf_late, title]);
    // The Validation tab of the record (drafting circle) and the department page.
    expect(late((await docWorkflows(ctx, 'PRO-QUA-0001'))[0])).toEqual([1, t.wf_late, title]);
    expect((await departmentPage(ctx, 'QUA'))!.workflows.map(late)).toEqual([[1, t.wf_late, title]]);
    vi.useRealTimers();
  });

  it('counts the days and speaks English in English', async () => {
    await running();
    setClock('2026-10-30T09:00:00Z');
    actAs('owner');
    setLangCookie('en');
    const w = (await validationsPage(await getCtx(), { filter: 'requested' })).selected!;
    expect(w.daysLate).toBe(10);
    expect(w.lateL).toBe(DICT.en.wf_late);
    expect(w.lateTitle).toBe(DICT.en.wf_late_title.replace('{date}', fmtDate('2026-10-20', 'en')).replace('{n}', '10'));
    vi.useRealTimers();
  });

  it('is never shown on a circuit that is over', async () => {
    await running();
    await db().update(s.workflows).set({ outcome: 'approved', step: 2 }).where(eq(s.workflows.id, 'WF-1'));
    setClock('2026-10-30T09:00:00Z');
    const page = await validationsPage(await as('manager'), { filter: 'done' });
    expect(page.list.map(late)).toEqual([[0, null, null]]);
    vi.useRealTimers();
  });

  it('shows nothing of a circuit the user may not see (D-14)', async () => {
    await running('PRO-QUA-0001', 'WF-1');
    await running('PRO-QUA-0002', 'WF-2', 'confidentiel');
    setClock('2026-10-30T09:00:00Z');
    // writer takes no part: no circuit in Validations, none on the department page, none on the record's tab.
    const ctx = await as('writer');
    const page = await validationsPage(ctx);
    expect(page.total).toBe(0);
    expect((await departmentPage(ctx, 'QUA'))!.workflows).toEqual([]);
    expect(page.list.some((w) => w.lateL)).toBe(false);
    vi.useRealTimers();
  });
});
