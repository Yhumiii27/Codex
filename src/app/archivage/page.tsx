import { Fragment } from 'react';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Seg } from '@/components/ui/Seg';
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

/** Deadlines; documents whose retention waits for the date of an event (lib/retention.ts EVENT_TRIGGERS); rules; archives. */
const TABS = ['due', 'events', 'rules', 'archives'] as const;
/** Deadlines shown: all of them, or those past due as the record's indicators say (lib/review.ts): expired, review overdue. */
const DUE_FILTERS = ['all', 'expired', 'review_late'] as const;

export function generateMetadata() {
  return screenTitle('nav_retention');
}

export default async function RetentionPage({ searchParams }: PageProps<'/archivage'>) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const ctx = await getCtx();
  const { t, lang } = ctx;
  if (!ctx.screens.retention) return <Forbidden text={t.forbidden} back={t.back_home} />;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab! : 'due';
  const canArchive = ctx.can('archive');
  const tabs = (
    <Seg
      name="retTab"
      value={tab}
      style={{ flex: 'none' }}
      optStyle={{ padding: '6px 14px', fontSize: 12.5 }}
      options={TABS.map((k) => ({ key: k, label: t[`ret_${k}`], href: `/archivage${k === 'due' ? '' : `?tab=${k}`}` }))}
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
        kindL: t[`due_${x.kind}`], detail: x.kind === 'retention' ? x.retentionL : '',
        endF: x.endF, days: x.days, actionLabel: x.actionLabel, held: x.legalHold, href: x.href,
        overdueL: x.overdue ? (x.kind === 'expiry' ? t.ind_expired : t.ind_review_late) : null,
        // A review falling due may be recorded from here (lib/actions.ts recordReview), by whom the record allows it.
        review: x.kind === 'review' ? {
          spec: { kind: 'review', docId: x.id, title: x.title, letter: x.revInForce ?? '', reviewDueAt: x.reviewDueAt, months: ctx.typeByCode.get(x.typeCode)?.reviewMonths ?? null, minDate: tomorrow },
          denied: x.legalHold ? t.locked_hold : !ctx.can('edit') ? `${t.not_allowed} : ${t.perm_edit}` : mayRecordReview(ctx, x) ? undefined : t.review_reserved,
        } : null,
      }));
    const filters = (
      <Seg
        name="dueF"
        value={filter}
        ariaLabel={t.ret_due}
        style={{ flex: 'none' }}
        optStyle={{ padding: '6px 12px', fontSize: 12.5 }}
        options={DUE_FILTERS.map((k) => ({ key: k, label: t[`f_${k}`], href: `/archivage${k === 'all' ? '' : `?f=${k}`}` }))}
      />
    );
    return (
      <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Archivage">
        <DueTable tabs={tabs} filters={filters} rows={rows} canArchive={canArchive} />
      </div>
    );
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
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Archivage">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px 10px', flexWrap: 'wrap' }}>
        {tabs}
        <span style={{ flex: 1 }} />
        {tab === 'rules' && <span className="text-muted" style={{ fontSize: 12 }}>{ctx.types.length} {t.types_count}</span>}
        {tab === 'events' && <span className="text-muted" style={{ fontSize: 12 }}>{events.filter((d) => !d.retentionEventAt).length} {t.ret_events_missing}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {tab === 'rules' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t.type}</th><th>{t.retention_basis}</th><th>{t.duration}</th><th>{t.trigger}</th><th>{t.outcome}</th>
                <th style={{ textAlign: 'right' }}>{t.count}</th>{canEditRules && <th><span className="sr-only">{t.col_actions}</span></th>}
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
                        <td><div>{lang === 'fr' ? x.labelFr : x.labelEn}</div><div className="text-muted" style={{ fontSize: 11 }}>{x.code}{x.active ? '' : ` · ${t.inactive}`}</div></td>
                        <td className="text-muted" style={{ maxWidth: 320, fontSize: 12 }}>{retentionBasisL(x, lang) || '—'}</td>
                        <td className="nowrap">{x.retentionYears != null ? `${x.retentionYears} ${t.years_short}` : '—'}</td>
                        <td className="text-muted">{t[`trig_${x.retentionTrigger}`]}</td>
                        <td className="text-muted">{t[`disp_${x.retentionDisposition}`]}</td>
                        <td className="tabnum" style={{ textAlign: 'right' }}>
                          <div>{counts.get(x.code)?.n ?? 0}</div>
                          {!!counts.get(x.code)?.overrides && <div className="text-muted" style={{ fontSize: 11 }}>{t.retention_overrides_n.replace('{n}', String(counts.get(x.code)?.overrides))}</div>}
                        </td>
                        {canEditRules && (
                          <td style={{ textAlign: 'right', width: 44 }}>
                            <DialogButton spec={typeSpec(x, !!usage?.types.has(x.code), retention?.get(x.code))} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${x.code}`} style={{ width: 30, height: 30 }} />
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
            <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 12.5, maxWidth: 760 }}>{t.ret_events_hint}</p>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.trigger}</th><th>{t.owner}</th><th>{t.retention_event_at}</th><th>{t.until}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
              <tbody>
                {events.map((d) => {
                  const may = maySetRetentionEvent(ctx, d);
                  return (
                    <tr key={d.id}>
                      <td><div>{d.title}</div><div className="text-muted" style={{ fontSize: 11 }}>{d.id} · {d.contextL}</div></td>
                      <td className="text-muted">{d.typeLabel}</td>
                      <td className="text-muted">{t[`trig_${d.retentionTrigger}`]}</td>
                      <td className="text-muted">{d.owner}</td>
                      <td>{d.retentionEventAt ? d.retentionEventF : <span className="tag tag-outline">{t.until_event_missing}</span>}</td>
                      <td className="text-muted">{d.untilF}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <DialogButton
                            spec={{ kind: 'retentionEvent', docId: d.id, title: d.title, triggerL: t[`trig_${d.retentionTrigger}`], eventAt: d.retentionEventAt, maxDate: today, version: d.version }}
                            className="btn btn-ghost nowrap" style={{ fontSize: 12 }}
                            deniedTitle={d.legalHold ? t.locked_hold : may ? undefined : t.retention_event_reserved}
                          >{t.retention_event_set}</DialogButton>
                          <Link href={d.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.open}</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && <tr><td colSpan={7} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
              </tbody>
            </table>
          </>
        )}
        {tab === 'archives' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.revision}</th><th>{t.archived_on}</th><th>{t.until}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
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
                      <Link href={d.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.consult}</Link>
                      <ActionButton
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        disabled={!canArchive || d.legalHold}
                        title={!canArchive ? `${t.not_allowed} : ${t.perm_archive}` : d.legalHold ? t.locked_hold : undefined}
                        action={restoreArchived.bind(null, d.id)}
                      >
                        {t.restore}
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
              {archives.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
