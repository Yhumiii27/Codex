import { expect } from 'vitest';
import type { Ctx } from '@/lib/context';
import { explorerDocs, listDocs, NO_ATTACHMENT, PAGE_SIZE, type DocView, type ExplorerAxis, type ExplorerDue, type ExplorerStatus } from '@/lib/queries';

// /explorateur as it computed its lists in memory until lot 6, kept as the reference of explorerDocs (lib/queries.ts),
// which the database runs: every document the user may see (listDocs), counted and filtered in JavaScript. A test file
// using these mocks getDb() (tests/support/db.ts).

export type ExplorerFilter = { axis: ExplorerAxis; node?: string; sub?: string; status: ExplorerStatus; due?: ExplorerDue; sel?: string };

function axisKey(d: DocView, axis: ExplorerAxis): string {
  switch (axis) {
    case 'family': return d.family;
    case 'department': return d.department;
    case 'project': return d.attachedCode ?? NO_ATTACHMENT;
    case 'type': return d.typeCode;
    case 'origin': return d.origin;
  }
}

function statusMatches(d: DocView, f: ExplorerStatus): boolean {
  if (f === 'all') return true;
  if (f === 'in_review') return d.status === 'in_review' || d.status === 'approved';
  return d.status === f;
}

/** The explorer's lists over `all` (listDocs), as its page computed them. */
export function referenceExplorer(all: DocView[], f: ExplorerFilter) {
  const nodes = new Map<string, number>();
  all.forEach((d) => { const k = axisKey(d, f.axis); nodes.set(k, (nodes.get(k) ?? 0) + 1); });
  const children = new Map<string, number>();
  if (f.node && f.axis !== 'type') all.filter((d) => axisKey(d, f.axis) === f.node).forEach((d) => children.set(d.typeCode, (children.get(d.typeCode) ?? 0) + 1));
  const rows = all.filter((d) => (!f.node || axisKey(d, f.axis) === f.node) && (!f.sub || d.typeCode === f.sub) && statusMatches(d, f.status)
    && (!f.due || (f.due === 'expired' ? d.expired : d.reviewOverdue)));
  return {
    all: all.length, nodes, children, rows,
    dues: { expired: all.filter((d) => d.expired).length, review_late: all.filter((d) => d.reviewOverdue).length },
    sel: f.sel ? all.find((d) => d.id === f.sel) : undefined,
  };
}

/**
 * The explorer as the database runs it, page after page, checked against the in-memory one: the same counts, met in
 * the same order, the same documents, read the same and in the same order. `all`: listDocs for the user, if read already.
 */
export async function explorerChecked(ctx: Ctx, f: ExplorerFilter, all?: DocView[]) {
  const ref = referenceExplorer(all ?? (await listDocs(ctx)), f);
  const what = `${ctx.user.id} (${ctx.role}) ${JSON.stringify(f)}`;
  const first = await explorerDocs(ctx, { ...f, page: 1 });
  expect(first.all, what).toBe(ref.all);
  expect([...first.nodes], what).toEqual([...ref.nodes]);
  expect([...first.children], what).toEqual([...ref.children]);
  expect(first.dues, what).toEqual(ref.dues);
  expect(first.total, what).toBe(ref.rows.length);
  expect(first.pages, what).toBe(Math.max(1, Math.ceil(ref.rows.length / PAGE_SIZE)));
  expect(first.sel, what).toEqual(ref.sel);
  const rows = [...first.rows];
  for (let page = 2; page <= first.pages; page++) rows.push(...(await explorerDocs(ctx, { ...f, page })).rows);
  expect(rows.map((d) => d.id), what).toEqual(ref.rows.map((d) => d.id));
  expect(rows, what).toEqual(ref.rows);
  return first;
}
