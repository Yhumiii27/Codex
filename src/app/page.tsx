import type { ReactNode } from 'react';
import Link from 'next/link';
import { TodoSync } from '@/components/shell/AppProvider';
import { TODO_ICON } from '@/components/shell/todo';
import { Icon } from '@/components/ui/Icon';
import { ActionLink, ClickRow, DialogButton } from '@/components/ui/client';
import { PageHeader } from '@/components/shell/PageHeader';
import { KpiGrid } from '@norma/charte/ds/Kpi';
import { msg, translatorFor } from '@/i18n';
import { getCtx } from '@/lib/context';
import { todayLong } from '@/lib/format';
import { dueDeadlines, inForceThisWeek, myTodo, recentActivity, recentDocs } from '@/lib/queries';
import styles from './home.module.css';
import { screenTitle } from '@/lib/titles';

/** A KPI card: a link when the role may open its screen, otherwise a plain card (never a dead end). */
function Kpi({ href, ok, children }: { href: string; ok: boolean; children: ReactNode }) {
  const cls = `card elev-sm coque-kpi ${styles.kpi}`;
  return ok ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export function generateMetadata() {
  return screenTitle(msg('Home'));
}

export default async function HomePage() {
  const ctx = await getCtx();
  const { lang } = ctx;
  const tr = translatorFor(lang);
  // Only what the home shows is read (lib/queries.ts): no list of every document.
  const [recents, todo, due, inForceWeek, activity] = await Promise.all([
    recentDocs(ctx, 5),
    myTodo(ctx),
    dueDeadlines(ctx),
    // Revisions that entered into force in the last 7 days and are still the ones in force.
    inForceThisWeek(ctx),
    // Activity of the group, limited to documents the user may see, each under its current ID.
    recentActivity(ctx, 6, 500),
  ]);
  const actions = todo.items;

  // Everything waiting for me, as the sidebar badge and the bell list it (myTodo, handed to them by TodoSync); the KPI
  // counts the approval steps.
  const toApprove = actions.filter((a) => a.kind === 'step').length;
  const noUpload = ctx.can('upload') ? undefined : `${tr('Permission required')} : ${tr('Upload')}`;

  return (
    <>
      <TodoSync todo={todo} />
      <PageHeader
        title={tr('Dashboard')}
        subtitle={<>{tr('Good morning')}, {ctx.user.name.split(' ')[0]} · {todayLong(lang)} · {tr('Here is what needs your attention.')}</>}
        actions={<>
          <ActionLink href="/recherche">{tr('Advanced search')}</ActionLink>
          <DialogButton spec={{ kind: 'new', preset: { mode: 'file' } }} icon="upload" deniedTitle={noUpload}>{tr('Upload a file')}</DialogButton>
        </>}
        primary={<DialogButton spec={{ kind: 'new', preset: { mode: 'template' } }} className="btn btn-primary" icon="plus" iconSw={1.8} deniedTitle={noUpload}>{tr('New from template')}</DialogButton>}
      />
      <div className={`screen ${styles.page}`} data-screen-label="Accueil">
        <KpiGrid min={170}>
          <Kpi href="/validations" ok={ctx.screens.workflow}><div className="coque-kpi-label">{tr('To approve')}</div><div className="coque-kpi-value">{toApprove}</div><div className="coque-kpi-sub">{tr('workflows waiting for your decision')}</div></Kpi>
          <Kpi href="/archivage" ok={ctx.screens.retention}><div className="coque-kpi-label">{tr('Due within 90 days')}</div><div className="coque-kpi-value">{due.length}</div><div className="coque-kpi-sub">{tr('retention, expiry or review falling due')}</div></Kpi>
          <Kpi href="/explorateur?status=in_force" ok={ctx.screens.explorer}><div className="coque-kpi-label">{tr('In force this week')}</div><div className="coque-kpi-value">{inForceWeek}</div><div className="coque-kpi-sub">{tr('new revisions entered into force')}</div></Kpi>
        </KpiGrid>

        <div className={styles.cols}>
          <div className={styles.col}>
            <section>
              {/* The list is whole: no « Tout voir » towards Validations, which only holds the approval steps. */}
              <div className="sec-head"><h2 className="sec-title">{tr('To do')}</h2></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {actions.map((a) => (
                  <div key={a.key} className={`card ${styles.todo}`}>
                    <Icon name={TODO_ICON[a.kind]} size={18} style={{ flex: 'none', color: 'var(--color-accent)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ellipsis">{a.docTitle}</div>
                      <div className="text-muted ellipsis sub" title={a.detail}>{a.detail}</div>
                      {/* Why a circuit sent the revision back, on its own line (abridged; the record shows all of it). */}
                      {a.note && <div className="sub" style={{ overflowWrap: 'anywhere', marginTop: 2 }}>{a.note}</div>}
                    </div>
                    <Link href={a.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Open')}</Link>
                  </div>
                ))}
                {actions.length === 0 && (
                  <div className={`card text-muted ${styles.todo}`}>
                    <Icon name="tick" size={18} style={{ flex: 'none' }} />
                    <span>{tr('Nothing to do for now.')}</span>
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="sec-head" style={{ marginBottom: 6 }}><h2 className="sec-title">{tr('Recent documents')}</h2><Link href="/explorateur" className="sec-link">{tr('See all')}</Link></div>
              <div className="codex-table-scroll">
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>{tr('Title')}</th><th>{tr('Type')}</th><th>{tr('Revision')}</th><th>{tr('Status')}</th><th>{tr('Modified')}</th></tr></thead>
                <tbody>
                  {recents.map((d) => (
                    <ClickRow key={d.id} href={d.href}>
                      <td className="ellipsis" style={{ maxWidth: 0, width: '100%', minWidth: 160 }} title={`${d.id} · ${d.title}`}><Link href={d.href} className="link-plain" style={{ color: 'inherit' }}>{d.title}</Link></td>
                      <td className="text-muted">{d.typeLabel}</td>
                      <td className="text-muted">{d.rev}</td>
                      <td><span className={d.tagClass}>{d.statusLabel}</span></td>
                      <td className="text-muted">{d.modifiedF}</td>
                    </ClickRow>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          </div>

          <div className={styles.col}>
            <section>
              <div className="sec-head"><h2 className="sec-title">{tr('Deadlines')}</h2>{ctx.screens.retention && <Link href="/archivage" className="sec-link">{tr('See all')}</Link>}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {due.slice(0, 4).map((d) => (
                  <Link key={`${d.id}:${d.kind}`} href={d.href} className={`link-plain hairline ${styles.expRow}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ellipsis">{d.title}</div>
                      <div className="text-muted ellipsis sub">{d.typeLabel} · {d.dueL} {d.endF}</div>
                    </div>
                    <span className="tag tag-outline" style={{ flex: 'none' }}>{d.actionLabel}</span>
                  </Link>
                ))}
              </div>
            </section>
            <section>
              <div className="sec-head"><h2 className="sec-title">{tr('Group activity')}</h2>{ctx.screens.admin && <Link href="/administration?tab=audit" className="sec-link">{tr('See all')}</Link>}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activity.map((a) => (
                  <div key={a.id} className="feed">
                    <span className="text-muted feed-when">{a.when}</span>
                    <span style={{ minWidth: 0 }}><span>{a.user}</span> <span className="text-muted">· {a.actionLabel} · </span><Link href={a.href} className="link-plain">{a.currentId}</Link></span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
