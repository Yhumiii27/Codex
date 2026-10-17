import type { ReactNode } from 'react';
import Link from 'next/link';
import { TodoSync } from '@/components/shell/AppProvider';
import { TODO_ICON } from '@/components/shell/todo';
import { Icon } from '@/components/ui/Icon';
import { ClickRow, DialogButton } from '@/components/ui/client';
import { getCtx } from '@/lib/context';
import { addDays, todayIso, todayLong } from '@/lib/format';
import { deadlines, listAudit, listDocs, myTodo } from '@/lib/queries';
import styles from './home.module.css';

/** A KPI card: a link when the role may open its screen, otherwise a plain card (never a dead end). */
function Kpi({ href, ok, children }: { href: string; ok: boolean; children: ReactNode }) {
  const cls = `card ${styles.kpi}`;
  return ok ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export default async function HomePage() {
  const ctx = await getCtx();
  const { t, lang } = ctx;
  const [docs, todo, audit] = await Promise.all([listDocs(ctx), myTodo(ctx), listAudit(ctx, { limit: 500, docsOnly: true, consultations: 'without' })]);
  const actions = todo.items;
  const visible = new Map(docs.map((d) => [d.id, d]));

  // Everything waiting for me, as the sidebar badge and the bell list it (myTodo, handed to them by TodoSync); the KPI
  // counts the approval steps.
  const toApprove = actions.filter((a) => a.kind === 'step').length;
  const due = deadlines(ctx, docs);
  // Revisions that entered into force in the last 7 days and are still the ones in force.
  const weekAgo = addDays(todayIso(), -7);
  const inForceWeek = new Set(
    audit.filter((a) => a.action === 'in_force' && a.local.slice(0, 10) >= weekAgo && !!a.currentId && visible.get(a.currentId)?.revInForce === a.detail).map((a) => a.currentId),
  ).size;
  const recents = docs.slice(0, 5);
  // Activity of the group, limited to documents the user may see, each under its current ID.
  const activity = audit.filter((a) => a.currentId && visible.has(a.currentId)).slice(0, 6);
  const noUpload = ctx.can('upload') ? undefined : `${t.not_allowed} : ${t.perm_upload}`;

  return (
    <div className="screen" style={{ overflow: 'auto', padding: 'var(--space-8)' }} data-screen-label="Accueil">
      <TodoSync todo={todo} />
      <div style={{ maxWidth: 1180 }}>
        <div className={styles.top}>
          <div>
            <h2 className={styles.hello}>{t.hello}, {ctx.user.name.split(' ')[0]}</h2>
            <div className="text-muted">{todayLong(lang)} · {t.home_sub}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <DialogButton spec={{ kind: 'new', preset: { mode: 'template' } }} className="btn btn-primary" icon="plus" iconSw={1.8} deniedTitle={noUpload}>{t.new_from_tpl}</DialogButton>
            <DialogButton spec={{ kind: 'new', preset: { mode: 'file' } }} icon="upload" deniedTitle={noUpload}>{t.upload}</DialogButton>
            <Link href="/recherche" className="btn btn-secondary">{t.adv_search}</Link>
          </div>
        </div>

        <div className={styles.kpis}>
          <Kpi href="/validations" ok={ctx.screens.workflow}><div className="card-kicker">{t.kpi_todo}</div><div className={styles.kpiValue}>{toApprove}</div><div className="card-meta">{t.kpi_todo_sub}</div></Kpi>
          <Kpi href="/archivage" ok={ctx.screens.retention}><div className="card-kicker">{t.kpi_exp}</div><div className={styles.kpiValue}>{due.length}</div><div className="card-meta">{t.kpi_exp_sub}</div></Kpi>
          <Kpi href="/explorateur?status=in_force" ok={ctx.screens.explorer}><div className="card-kicker">{t.kpi_in_force}</div><div className={styles.kpiValue}>{inForceWeek}</div><div className="card-meta">{t.kpi_in_force_sub}</div></Kpi>
        </div>

        <div className={styles.cols}>
          <div className={styles.col}>
            <section>
              {/* The list is whole: no « Tout voir » towards Validations, which only holds the approval steps. */}
              <div className="sec-head"><h6 className="sec-title">{t.todo}</h6></div>
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
                    <Link href={a.href} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.open}</Link>
                  </div>
                ))}
                {actions.length === 0 && (
                  <div className={`card text-muted ${styles.todo}`}>
                    <Icon name="tick" size={18} style={{ flex: 'none' }} />
                    <span>{t.todo_empty}</span>
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="sec-head" style={{ marginBottom: 6 }}><h6 className="sec-title">{t.recents}</h6><Link href="/explorateur" className="sec-link">{t.see_all}</Link></div>
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.revision}</th><th>{t.status}</th><th>{t.modified}</th></tr></thead>
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
            </section>
          </div>

          <div className={styles.col}>
            <section>
              <div className="sec-head"><h6 className="sec-title">{t.ret_due}</h6>{ctx.screens.retention && <Link href="/archivage" className="sec-link">{t.see_all}</Link>}</div>
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
              <div className="sec-head"><h6 className="sec-title">{t.activity}</h6>{ctx.screens.admin && <Link href="/administration?tab=audit" className="sec-link">{t.see_all}</Link>}</div>
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
    </div>
  );
}
