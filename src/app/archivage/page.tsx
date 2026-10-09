import { Fragment } from 'react';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Seg } from '@/components/ui/Seg';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { restoreArchived } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { deadlines, listDocs } from '@/lib/queries';
import { countBy, typeSpec } from '../administration/shared';
import { DueTable, type DueRow } from './DueTable';

const TABS = ['due', 'rules', 'archives'] as const;

export default async function RetentionPage({ searchParams }: PageProps<'/archivage'>) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const ctx = await getCtx();
  const { t, lang } = ctx;
  if (!ctx.screens.retention) return <Forbidden text={t.forbidden} back={t.back_home} />;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab! : 'due';
  const docs = await listDocs(ctx);
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
    const rows: DueRow[] = deadlines(ctx, docs).map((x) => ({
      id: x.id, kind: x.kind, title: x.title, contextL: x.contextL, typeLabel: x.typeLabel,
      kindL: t[`due_${x.kind}`], detail: x.kind === 'retention' ? x.retentionL : '',
      endF: x.endF, days: x.days, actionLabel: x.actionLabel, held: x.legalHold, href: x.href,
    }));
    return (
      <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Archivage">
        <DueTable tabs={tabs} rows={rows} canArchive={canArchive} />
      </div>
    );
  }

  const counts = countBy(docs, (d) => d.typeCode);
  // The register's retention rules are edited in the 'type' dialog (records managers / administrators).
  const canEditRules = ctx.screens.admin;
  const archives = docs.filter((d) => d.state === 'archived');
  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Archivage">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px 10px', flexWrap: 'wrap' }}>
        {tabs}
        <span style={{ flex: 1 }} />
        {tab === 'rules' && <span className="text-muted" style={{ fontSize: 12 }}>{ctx.types.length} {t.types_count}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {tab === 'rules' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t.type}</th><th>{t.retention_basis}</th><th>{t.duration}</th><th>{t.trigger}</th><th>{t.outcome}</th>
                <th style={{ textAlign: 'right' }}>{t.count}</th>{canEditRules && <th />}
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
                        <h6 className="sec-title" style={{ fontSize: 11 }}>{lang === 'fr' ? f.labelFr : f.labelEn}</h6>
                      </td>
                    </tr>
                    {types.map((x) => (
                      <tr key={x.code} style={x.active ? undefined : { opacity: 0.55 }}>
                        <td><div>{lang === 'fr' ? x.labelFr : x.labelEn}</div><div className="text-muted" style={{ fontSize: 11 }}>{x.code}{x.active ? '' : ` · ${t.inactive}`}</div></td>
                        <td className="text-muted" style={{ maxWidth: 320, fontSize: 12 }}>{x.retentionBasis || '—'}</td>
                        <td className="nowrap">{x.retentionYears != null ? `${x.retentionYears} ${t.years_short}` : '—'}</td>
                        <td className="text-muted">{t[`trig_${x.retentionTrigger}`]}</td>
                        <td className="text-muted">{t[`disp_${x.retentionDisposition}`]}</td>
                        <td className="tabnum" style={{ textAlign: 'right' }}>{counts.get(x.code) ?? 0}</td>
                        {canEditRules && (
                          <td style={{ textAlign: 'right', width: 44 }}>
                            <DialogButton spec={typeSpec(x, lang)} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${x.code}`} style={{ width: 30, height: 30 }} />
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
        {tab === 'archives' && (
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.revision}</th><th>{t.archived_on}</th><th>{t.until}</th><th /></tr></thead>
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
