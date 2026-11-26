import { Fragment } from 'react';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Segmented } from '@norma/charte/ds/Segmented';
import { FilterBar, FilterNote } from '@norma/charte/ds/FilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { msg } from '@/i18n';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { mayRecordReview, maySetRetentionEvent } from '@/lib/access';
import { restoreArchived } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { addDays, fmtDate, todayIso } from '@/lib/format';
import { retentionBasisL } from '@/lib/i18n';
import { archivedDocs, dueDeadlines, eventDocs, registryUsage, retentionByType, typeCounts } from '@/lib/queries';
import { typeSpec } from '../administration/shared';
import { DueTable, type DueRow } from './DueTable';
import { screenTitle } from '@/lib/titles';
import { DISPOSITION_LABEL, DUE_KIND_LABEL, FILTER_LABEL, RETENTION_TAB_LABEL, TRIGGER_LABEL, labelOf } from '@/i18n/labels';

/** Deadlines; documents whose retention waits for the date of an event (lib/retention.ts EVENT_TRIGGERS); rules; archives. */
const TABS = ['due', 'events', 'rules', 'archives'] as const;
/** Deadlines shown: all of them, or those past due as the record's indicators say (lib/review.ts): expired, review overdue. */
const DUE_FILTERS = ['all', 'expired', 'review_late'] as const;

export function generateMetadata() {
  return screenTitle(msg('Archiving & retention'));
}

export default async function RetentionPage({ searchParams }: PageProps<'/archivage'>) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const ctx = await getCtx();
  const { tr, lang } = ctx;
  if (!ctx.screens.retention) return <Forbidden text={tr('The simulated role cannot access this screen.')} back={tr('Back to home')} />;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab! : 'due';
  const canArchive = ctx.can('archive');
  const title = tr('Archiving & retention');
  const tabs = (
    <Segmented
      className="codex-seg"
      wrap
      value={tab}
      options={TABS.map((k) => ({ value: k, label: labelOf(tr, RETENTION_TAB_LABEL, k), href: `/archivage${k === 'due' ? '' : `?tab=${k}`}` }))}
    />
  );

  if (tab === 'due') {
    // End of retention, expiry (permits, certificates, contracts) and periodic review falling due within 90 days.
    const filter = (DUE_FILTERS as readonly string[]).includes(sp.f ?? '') ? (sp.f as (typeof DUE_FILTERS)[number]) : 'all';
    const tomorrow = addDays(todayIso(), 1);
    const rows: DueRow[] = (await dueDeadlines(ctx))
      .filter((x) => filter === 'all' || (x.overdue && x.kind === (filter === 'expired' ? 'expiry' : 'review')))
      .map((x) => ({
        id: x.id, kind: x.kind, title: x.title, contextL: x.contextL, typeLabel: x.typeLabel,
        kindL: labelOf(tr, DUE_KIND_LABEL, x.kind), detail: x.kind === 'retention' ? x.retentionL : '',
        endF: x.endF, days: x.days, actionLabel: x.actionLabel, held: x.legalHold, href: x.href,
        overdueL: x.overdue ? (x.kind === 'expiry' ? tr('Expired#indicator') : tr('Review overdue')) : null,
        // A review falling due may be recorded from here (lib/actions.ts recordReview), by whom the record allows it.
        review: x.kind === 'review' ? {
          spec: { kind: 'review', docId: x.id, title: x.title, letter: x.revInForce ?? '', reviewDueAt: x.reviewDueAt, months: ctx.typeByCode.get(x.typeCode)?.reviewMonths ?? null, minDate: tomorrow },
          denied: x.legalHold ? tr('Document under legal hold: it cannot be changed.') : !ctx.can('edit') ? `${tr('Permission required')} : ${tr('Edit#permission')}` : mayRecordReview(ctx, x) ? undefined : tr('Review reserved to the document’s owner, its process owner and records managers.'),
        } : null,
      }));
    const filters = (
      <Segmented
        className="codex-seg"
        wrap
        label={tr('Deadlines')}
        value={filter}
        options={DUE_FILTERS.map((k) => ({ value: k, label: labelOf(tr, FILTER_LABEL, k), href: `/archivage${k === 'all' ? '' : `?f=${k}`}` }))}
      />
    );
    return <DueTable title={title} tabs={tabs} filters={filters} rows={rows} canArchive={canArchive} />;
  }

  // Each tab reads only what it lists (lib/queries.ts), among the documents the user reads (D-14).
  // The register's retention rules are edited in the 'type' dialog (records managers / administrators).
  const canEditRules = ctx.screens.admin;
  // Rules: documents per type and derogations among them; what refers to each type (one in use keeps its code in the
  // type dialog, lib/actions.ts updateType).
  const [counts, usage, retention] = tab === 'rules'
    ? await Promise.all([typeCounts(ctx), canEditRules ? registryUsage() : null, canEditRules ? retentionByType() : null])
    : [new Map<string, { n: number; overrides: number }>(), null, null];
  // Documents whose retention counts from an event entered on the record: those still without a date first.
  const events = tab === 'events'
    ? (await eventDocs(ctx)).sort((a, b) => Number(!!a.retentionEventAt) - Number(!!b.retentionEventAt) || a.id.localeCompare(b.id))
    : [];
  const today = todayIso();
  const archives = tab === 'archives' ? await archivedDocs(ctx) : [];
  return (
    <>
      <PageHeader
        title={title}
        toolbar={
          <FilterBar>
            {tabs}
            {tab === 'rules' && <FilterNote>{ctx.types.length} {tr('types')}</FilterNote>}
            {tab === 'events' && <FilterNote>{events.filter((d) => !d.retentionEventAt).length} {tr('date(s) to enter')}</FilterNote>}
          </FilterBar>
        }
      />
    <div className="screen" data-screen-label="Archivage">
      <div className="codex-table-scroll">
        {tab === 'rules' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{tr('Type')}</th><th>{tr('Basis')}</th><th>{tr('Duration')}</th><th>{tr('Trigger')}</th><th>{tr('Final outcome')}</th>
                <th style={{ textAlign: 'right' }}>{tr('Documents')}</th>{canEditRules && <th><span className="sr-only">{tr('Actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {ctx.families.map((f) => {
                const types = ctx.types.filter((x) => x.family === f.key);
                if (!types.length) return null;
                return (
                  <Fragment key={f.key}>
                    <tr>
                      <td colSpan={canEditRules ? 7 : 6} style={{ paddingTop: 18 }}>
                        <h2 className="sec-title" style={{ fontSize: 11 }}>{lang === 'fr' ? f.labelFr : f.labelEn}</h2>
                      </td>
                    </tr>
                    {types.map((x) => (
                      <tr key={x.code} style={x.active ? undefined : { opacity: 0.55 }}>
                        <td><div>{lang === 'fr' ? x.labelFr : x.labelEn}</div><div className="text-muted" style={{ fontSize: 11 }}>{x.code}{x.active ? '' : ` · ${tr('Inactive')}`}</div></td>
                        <td className="text-muted" style={{ maxWidth: 320, fontSize: 12 }}>{retentionBasisL(x, lang) || '—'}</td>
                        <td className="nowrap">{x.retentionYears != null ? `${x.retentionYears} ${tr('years')}` : '—'}</td>
                        <td className="text-muted">{labelOf(tr, TRIGGER_LABEL, x.retentionTrigger)}</td>
                        <td className="text-muted">{labelOf(tr, DISPOSITION_LABEL, x.retentionDisposition)}</td>
                        <td className="tabnum" style={{ textAlign: 'right' }}>
                          <div>{counts.get(x.code)?.n ?? 0}</div>
                          {!!counts.get(x.code)?.overrides && <div className="text-muted" style={{ fontSize: 11 }}>{tr('incl. {n} derogation(s)').replace('{n}', String(counts.get(x.code)?.overrides))}</div>}
                        </td>
                        {canEditRules && (
                          <td style={{ textAlign: 'right', width: 44 }}>
                            <DialogButton spec={typeSpec(x, !!usage?.types.has(x.code), retention?.get(x.code))} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${x.code}`} style={{ width: 30, height: 30 }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === 'events' && (
          <>
            <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 12.5, maxWidth: 760 }}>{tr('Documents whose retention starts from an event Codex does not know (end of life of the asset, departure of the employee). The owner or a records manager enters its date on the record; the end of retention then shows in the deadlines. Nothing is archived or destroyed automatically.')}</p>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{tr('Title')}</th><th>{tr('Type')}</th><th>{tr('Trigger')}</th><th>{tr('Owner')}</th><th>{tr('Date of the trigger event')}</th><th>{tr('Retained until')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
              <tbody>
                {events.map((d) => {
                  const may = maySetRetentionEvent(ctx, d);
                  return (
                    <tr key={d.id}>
                      <td><div>{d.title}</div><div className="text-muted" style={{ fontSize: 11 }}>{d.id} · {d.contextL}</div></td>
                      <td className="text-muted">{d.typeLabel}</td>
                      <td className="text-muted">{labelOf(tr, TRIGGER_LABEL, d.retentionTrigger)}</td>
                      <td className="text-muted">{d.owner}</td>
                      <td>{d.retentionEventAt ? d.retentionEventF : <span className="tag tag-outline">{tr('Event date to enter')}</span>}</td>
                      <td className="text-muted">{d.untilF}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <DialogButton
                            spec={{ kind: 'retentionEvent', docId: d.id, title: d.title, triggerL: labelOf(tr, TRIGGER_LABEL, d.retentionTrigger), eventAt: d.retentionEventAt, maxDate: today, version: d.version }}
                            className="btn btn-ghost nowrap" style={{ fontSize: 12 }}
                            deniedTitle={d.legalHold ? tr('Document under legal hold: it cannot be changed.') : may ? undefined : tr('Reserved to the document owner and records managers')}
                          >{tr('Event date')}</DialogButton>
                          <Link href={d.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Open')}</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
              </tbody>
            </table>
          </>
        )}
        {tab === 'archives' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{tr('Title')}</th><th>{tr('Type')}</th><th>{tr('Revision')}</th><th>{tr('Archived on')}</th><th>{tr('Retained until')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
            <tbody>
              {archives.map((d) => (
                <tr key={d.id}>
                  <td><div>{d.title}</div><div className="text-muted" style={{ fontSize: 11 }}>{d.id} · {d.contextL}</div></td>
                  <td className="text-muted">{d.typeLabel}</td>
                  <td className="text-muted">{d.revInForce ?? '—'}</td>
                  <td className="text-muted">{fmtDate(d.archivedAt ?? d.modifiedAt, lang)}</td>
                  <td className="text-muted">{d.untilF}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link href={d.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('View')}</Link>
                      <ActionButton
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        disabled={!canArchive || d.legalHold}
                        title={!canArchive ? `${tr('Permission required')} : ${tr('Archive')}` : d.legalHold ? tr('Document under legal hold: it cannot be changed.') : undefined}
                        action={restoreArchived.bind(null, d.id)}
                      >
                        {tr('Restore')}
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {archives.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </>
  );
}
