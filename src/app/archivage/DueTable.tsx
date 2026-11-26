'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import type { DialogSpec } from '@/components/dialogs/types';
import { Icon } from '@/components/ui/Icon';
import { DialogButton } from '@/components/ui/client';
import { FilterBar, FilterNote } from '@norma/charte/ds/FilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { archiveDocuments, holdDocuments, type ActionResult } from '@/lib/actions';
import { failureText } from '@/lib/errors';

export type DueRow = {
  /** Document ID: a document can fall due twice (retention and review), selection acts on the document. */
  id: string;
  kind: 'retention' | 'expiry' | 'review';
  title: string; contextL: string; typeLabel: string; kindL: string; detail: string;
  endF: string; days: number; actionLabel: string; held: boolean; href: string;
  /** « Expiré » or « Revue en retard » once past due, as the record says it (lib/review.ts); null otherwise. */
  overdueL: string | null;
  /** A review falling due: the dialog that records it, and why the user may not (lib/actions.ts recordReview). */
  review: { spec: DialogSpec; denied?: string } | null;
};

/** Deadlines tab: selection and the two bulk actions of the design (archive, legal hold); `filters`: those past due only. */
export function DueTable({ title, tabs, filters, rows, canArchive }: { title: string; tabs: ReactNode; filters: ReactNode; rows: DueRow[]; canArchive: boolean }) {
  const { tr, toast } = useApp();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  const docIds = [...new Set(rows.map((x) => x.id))];
  const ids = docIds.filter((id) => sel[id]);
  const all = docIds.length > 0 && ids.length === docIds.length;
  const run = (fn: (ids: string[]) => Promise<ActionResult>) =>
    start(async () => {
      try {
        const r = await fn(ids);
        if (r.ok) { setSel({}); toast(r.message ?? tr('Changes saved')); } else toast(r.error, true);
      } catch (err) {
        toast(failureText(tr, err), true);
      }
    });
  const denied = canArchive ? undefined : `${tr('Permission required')} : ${tr('Archive')}`;

  return (
    <>
      {/* The two bulk actions act on the rows ticked below: the page header holds them (Norma 2.0), the toolbar the tabs,
          the filter and the count of the selection. */}
      <PageHeader
        title={title}
        actions={<button type="button" className="btn btn-secondary" disabled={!ids.length || pending || !canArchive} title={denied} onClick={() => run(archiveDocuments)}><Icon name="archive" size={14} />{tr('Archive selection')}</button>}
        primary={<button type="button" className="btn btn-primary" disabled={!ids.length || pending || !canArchive} title={denied} onClick={() => run(holdDocuments)}><Icon name="lock" size={14} />{tr('Apply legal hold')}</button>}
        toolbar={
          <FilterBar>
            {tabs}
            {filters}
            <FilterNote>{ids.length} {tr('selected')}</FilterNote>
          </FilterBar>
        }
      />
      <div className="screen codex-table-scroll" data-screen-label="Archivage">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" aria-label={tr('selected')} checked={all} disabled={!docIds.length} onChange={() => setSel(all ? {} : Object.fromEntries(docIds.map((id) => [id, true])))} style={{ margin: 0, display: 'block' }} /></th>
              <th>{tr('Document')}</th><th>{tr('Type')}</th><th>{tr('Kind')}</th><th>{tr('Due')}</th><th>{tr('Proposed action')}</th><th><span className="sr-only">{tr('Actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={`${x.id}:${x.kind}`}>
                <td><input type="checkbox" aria-label={x.title} checked={!!sel[x.id]} onChange={() => setSel({ ...sel, [x.id]: !sel[x.id] })} style={{ margin: 0, display: 'block' }} /></td>
                <td><div>{x.title}</div><div className="text-muted" style={{ fontSize: 11 }}>{x.id} · {x.contextL}</div></td>
                <td className="text-muted">{x.typeLabel}</td>
                <td><div className="text-muted">{x.kindL}</div>{x.detail && <div className="text-muted" style={{ fontSize: 11 }}>{x.detail}</div>}</td>
                <td className="nowrap">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{x.endF}{x.overdueL && <span className="tag tag-outline">{x.overdueL}</span>}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{x.days >= 0 ? `${x.days} ${tr('days left')}` : `${-x.days} ${tr('days overdue')}`}</div>
                </td>
                <td><span className={x.held ? 'tag tag-neutral' : 'tag tag-outline'}>{x.held && <Icon name="lock" size={11} style={{ marginRight: 4 }} />}{x.actionLabel}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {x.review && <DialogButton spec={x.review.spec} className="btn btn-ghost nowrap" style={{ fontSize: 12 }} deniedTitle={x.review.denied}>{tr('Review done')}</DialogButton>}
                    <Link href={x.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Open')}</Link>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
