import type { ReactNode } from 'react';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { ClickRow } from '@/components/ui/client';
import { getCtx } from '@/lib/context';
import { markInactive } from '@/lib/org-rules';
import { departmentPage } from '@/lib/queries';
import { FACET_LABEL } from '@/lib/search';
import { titled } from '@/lib/titles';
import { DepartmentPicker } from '../DepartmentPicker';
import styles from '../departments.module.css';

/** Documents in force and due dates listed on the page; the others are one link away (/recherche, Archivage). */
const DOCS_SHOWN = 8;
const DUE_SHOWN = 8;

/** A KPI card, as on the home page: a link when it leads to a list of the very items it counts. */
function Kpi({ href, children }: { href?: string; children: ReactNode }) {
  const cls = `card ${styles.kpi}`;
  return href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

/** « Qualité — Codex »: the department's label (reference data, the same for every user); an unknown code, the screen's name. */
export async function generateMetadata({ params }: PageProps<'/departements/[code]'>) {
  const { code } = await params;
  const ctx = await getCtx();
  const known = ctx.departments.some((d) => d.code === code);
  return titled(known ? ctx.label('department', code) : ctx.t.nav_departments);
}

export default async function DepartmentPage({ params }: PageProps<'/departements/[code]'>) {
  const { code } = await params;
  const ctx = await getCtx();
  const { t } = ctx;
  const colon = ctx.lang === 'fr' ? ' : ' : ': ';
  // Department codes are three capital letters: nothing to decode, anything else is unknown.
  const page = await departmentPage(ctx, code);
  if (!page) return <Forbidden text={t.dept_unknown} back={t.back_home} />;
  const docs = page.inForce.slice(0, DOCS_SHOWN);

  return (
    <div className="screen" style={{ overflow: 'auto', padding: 'var(--space-8)' }} data-screen-label="Département">
      <div style={{ maxWidth: 1180 }}>
        <div className={styles.top}>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.title}>
              {page.label}{page.label !== page.code && <> <span className="tag tag-outline tabnum" style={{ verticalAlign: 'middle' }}>{page.code}</span></>}
              {!page.active && <> <span className="tag tag-neutral" style={{ verticalAlign: 'middle' }}>{t.inactive}</span></>}
            </h2>
            <div className="text-muted">{t.department_short}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Inactive departments stay listed, marked: their pages show their documents. */}
            <DepartmentPicker value={page.code} ariaLabel={t.department_short} options={markInactive(ctx.departments.map((d) => ({ key: d.code, label: ctx.label('department', d.code), active: d.active })), t.inactive.toLowerCase())} />
            <Link href={page.href.all} className="btn btn-secondary"><Icon name="search" size={14} />{t.dept_search}</Link>
          </div>
        </div>
        <p className={`text-muted ${styles.hint}`}><Icon name="info" size={14} style={{ flex: 'none', marginTop: 1 }} />{page.active ? '' : `${t.dept_inactive_hint} `}{page.featuredDefault ? t.dept_hint : t.dept_hint_set}</p>

        <div className={styles.kpis}>
          <Kpi href={page.href.inForce}><div className="card-kicker">{t.dept_in_force}</div><div className={styles.kpiValue}>{page.inForce.length}</div><div className="card-meta">{t.dept_in_force_sub}</div></Kpi>
          <Kpi><div className="card-kicker">{t.kpi_exp}</div><div className={styles.kpiValue}>{page.deadlines.length}</div><div className="card-meta">{t.kpi_exp_sub}</div></Kpi>
          <Kpi><div className="card-kicker">{t.dept_wf}</div><div className={styles.kpiValue}>{page.workflows.length}</div><div className="card-meta">{t.dept_wf_sub}</div></Kpi>
        </div>

        <div className={styles.cols}>
          <div className={styles.col}>
            <section>
              <div className="sec-head" style={{ marginBottom: 6 }}><h2 className="sec-title">{t.dept_in_force}</h2><Link href={page.href.inForce} className="sec-link">{t.see_all}</Link></div>
              {docs.length ? (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.revision}</th><th>{t.modified}</th></tr></thead>
                  <tbody>
                    {docs.map((d) => (
                      <ClickRow key={d.id} href={d.href}>
                        <td className="ellipsis" style={{ maxWidth: 0, width: '100%', minWidth: 160 }} title={`${d.id} · ${d.title}`}><Link href={d.href} className="link-plain" style={{ color: 'inherit' }}>{d.title}</Link></td>
                        <td className="text-muted ellipsis" style={{ maxWidth: 170 }} title={d.typeLabel}>{d.typeLabel}</td>
                        <td className="text-muted">{d.rev}</td>
                        <td className="text-muted nowrap">{d.modifiedF}</td>
                      </ClickRow>
                    ))}
                  </tbody>
                </table>
              ) : <p className={`text-muted ${styles.empty}`}>{t.dept_in_force_empty}</p>}
            </section>
            <section>
              <div className="sec-head"><h2 className="sec-title">{t.dept_wf}</h2></div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {page.workflows.map((w) => (
                  <Link key={w.id} href={ctx.screens.workflow ? w.href : `/documents/${encodeURIComponent(w.docId)}`} className={`link-plain hairline ${styles.row}`}>
                    <Icon name="check" size={16} style={{ flex: 'none', color: 'var(--color-accent)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ellipsis">{w.docTitle}</div>
                      <div className="text-muted ellipsis sub">{w.docId} · {t.rev_short} {w.letter} · {t.step}{colon}{w.stepName} · {t.due} {w.dueF}</div>
                    </div>
                    {w.lateL && <span className="tag tag-outline" style={{ flex: 'none' }} title={w.lateTitle ?? undefined}>{w.lateL}</span>}
                    <span className="tag tag-outline" style={{ flex: 'none' }}>{w.progress}</span>
                  </Link>
                ))}
                {page.workflows.length === 0 && <p className={`text-muted ${styles.empty}`}>{t.dept_wf_empty}</p>}
              </div>
            </section>
          </div>

          <div className={styles.col}>
            <section>
              <div className="sec-head"><h2 className="sec-title">{t.featured_filters}</h2>{ctx.screens.admin && <Link href="/administration?tab=org" className="sec-link">{t.featured_set}</Link>}</div>
              {page.featured.length ? (
                <div className={styles.facets}>
                  {page.featured.map((f) => (
                    <div key={f.key}>
                      <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{t[FACET_LABEL[f.key]]}</div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {f.values.map((v) => (
                          <Link key={v.value} href={v.href} className={styles.value} title={v.label}>
                            <span className="ellipsis" style={{ flex: 1 }}>{v.label}</span>
                            <span className="text-muted tabnum" style={{ fontSize: 11 }}>{v.count}</span>
                          </Link>
                        ))}
                        {f.more > 0 && <Link href={page.href.all} className={`text-muted ${styles.more}`}>{f.more} {t.facet_more}</Link>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className={`text-muted ${styles.empty}`}>{page.featuredKeys.length ? t.featured_empty : t.featured_none_set}</p>}
            </section>
            <section>
              <div className="sec-head"><h2 className="sec-title">{t.saved}</h2><Link href="/recherche" className="sec-link">{t.adv_search}</Link></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {page.saved.map((x) => (
                  <Link key={x.id} href={x.href} className={styles.saved} title={x.title}>
                    <Icon name="bookmark" size={14} style={{ flex: 'none', color: 'var(--color-accent)' }} />
                    <span className="ellipsis" style={{ flex: 1 }}>{x.labelL}</span>
                    {x.scope === 'department' && <span className="text-muted" style={{ flex: 'none', fontSize: 11 }}>{x.department}</span>}
                  </Link>
                ))}
                {page.saved.length === 0 && <p className={`text-muted ${styles.empty}`}>{t.dept_saved_empty}</p>}
              </div>
            </section>
            <section>
              <div className="sec-head"><h2 className="sec-title">{t.ret_due}</h2>{ctx.screens.retention && <Link href="/archivage" className="sec-link">{t.see_all}</Link>}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {page.deadlines.slice(0, DUE_SHOWN).map((d) => (
                  <Link key={`${d.id}:${d.kind}`} href={d.href} className={`link-plain hairline ${styles.row}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ellipsis">{d.title}</div>
                      <div className="text-muted ellipsis sub">{d.typeLabel} · {d.dueL} {d.endF}</div>
                    </div>
                    <span className="tag tag-outline" style={{ flex: 'none' }}>{d.actionLabel}</span>
                  </Link>
                ))}
                {page.deadlines.length === 0 && <p className={`text-muted ${styles.empty}`}>{t.dept_due_empty}</p>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
