import { Fragment } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Pager } from '@/components/ui/Pager';
import { Seg } from '@/components/ui/Seg';
import { ClickRow, DialogButton } from '@/components/ui/client';
import { getCtx, type Ctx } from '@/lib/context';
import {
  EXPLORER_AXES as AXES, EXPLORER_DUES as DUES, EXPLORER_STATUSES as STATUSES, explorerDocs, listChangeRequests, listDocLinks, NO_ATTACHMENT as NONE, stateNotice,
  type ExplorerAxis as Axis, type ExplorerDue as DueF, type ExplorerStatus as StatusF,
} from '@/lib/queries';
import { oneEach, pageOf } from '@/lib/search';
import styles from './explorer.module.css';

// Classification axes (docs/modele-cible.md §2), status filters and dates past due of the explorer: lib/queries.ts
// explorerDocs counts and pages the documents the user may see. Dates past due are the record's indicators
// (lib/review.ts, docView), a filter of their own in the tree, combined with the status: they are no status (D-17), and
// the status bar keeps the design's width.
const DEFAULT_AXIS: Axis = 'family';
const HOV = 'color-mix(in srgb,var(--color-accent) 10%,transparent)';

type Params = { axis?: string; node?: string; sub?: string; status?: string; due?: string; sel?: string; page?: string };

function href(p: Params) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  return `/explorateur${q.size ? `?${q}` : ''}`;
}

/** Node values of an axis in reference order (registry, organisation, projects then programmes), with their labels. */
function axisNodes(ctx: Ctx, axis: Axis): { key: string; label: string }[] {
  const { t } = ctx;
  switch (axis) {
    case 'family': return ctx.families.map((f) => ({ key: f.key, label: ctx.label('family', f.key) }));
    case 'department': return ctx.departments.map((d) => ({ key: d.code, label: ctx.label('department', d.code) }));
    case 'project': return [
      ...ctx.projects.map((p) => ({ key: p.code, label: `${p.code} · ${p.name}` })),
      ...ctx.programs.map((p) => ({ key: p.code, label: `${p.code} · ${p.name}` })),
      { key: NONE, label: t.no_attachment },
    ];
    case 'type': return ctx.types.map((ty) => ({ key: ty.code, label: ctx.label('type', ty.code) })).sort((a, b) => a.label.localeCompare(b.label, ctx.lang));
    case 'origin': return [{ key: 'interne', label: t.or_interne }, { key: 'externe', label: t.or_externe }];
  }
}

export default async function ExplorerPage({ searchParams }: PageProps<'/explorateur'>) {
  // One value per parameter: a repeated one (?node=a&node=b) keeps its first.
  const sp = oneEach(await searchParams);
  const ctx = await getCtx();
  const { t, lang } = ctx;
  const axis: Axis = (AXES as readonly string[]).includes(sp.axis ?? '') ? (sp.axis as Axis) : DEFAULT_AXIS;
  const status: StatusF = (STATUSES as readonly string[]).includes(sp.status ?? '') ? (sp.status as StatusF) : 'all';
  const due: DueF | undefined = (DUES as readonly string[]).includes(sp.due ?? '') ? (sp.due as DueF) : undefined;
  const node = sp.node || undefined, sub = sp.sub || undefined, sel = sp.sel || undefined;
  const base: Params = { axis: axis === DEFAULT_AXIS ? undefined : axis, status: status === 'all' ? undefined : status, due };

  // Only the documents the user may see (access.ts readableSql), counted by the database; only the page is read whole.
  const { all, nodes: counts, children: types, dues: dueCount, rows, total, page, pages, sel: selDoc } = await explorerDocs(ctx, { axis, node, sub, status, due, sel, page: pageOf(sp.page) });
  const known = axisNodes(ctx, axis);
  // Values found on documents but missing from the reference data still get a node.
  const nodes = [...known, ...[...counts.keys()].filter((k) => !known.some((n) => n.key === k)).map((k) => ({ key: k, label: k }))];
  const nodeLabel = (k: string) => nodes.find((n) => n.key === k)?.label ?? k;
  const treeNodes = nodes
    .filter((n) => counts.has(n.key))
    .map((n) => {
      const selected = node === n.key;
      const children: { key: string; label: string; count: number }[] = [];
      if (selected && axis !== 'type') {
        types.forEach((count, key) => children.push({ key, label: ctx.label('type', key), count }));
        children.sort((a, b) => a.label.localeCompare(b.label, lang));
      }
      return { ...n, count: counts.get(n.key)!, selected, children };
    });

  const parts = [t.all_docs];
  if (node) parts.push(nodeLabel(node));
  if (sub) parts.push(ctx.label('type', sub));
  // A file exists once a revision is in force or approved, or once the draft has a working version ("B.2" rather than "B").
  const selHasFile = !!selDoc && (!!selDoc.revInForce || selDoc.status === 'approved' || selDoc.workingLabel !== selDoc.revWorking);
  // Obsolete or archived: the same warning as on the record; the withdrawal's change order is only looked up then.
  const notice = selDoc && selDoc.state !== 'active' ? stateNotice(ctx, selDoc, selDoc.obsoleteAt ? await listChangeRequests(ctx, { docId: selDoc.id }) : []) : null;
  // And what replaces a withdrawn one, among the documents the user may read (lib/queries.ts listDocLinks).
  const replacedBy = notice && selDoc?.obsoleteAt ? (await listDocLinks(ctx, selDoc.id)).filter((l) => l.rel === 'replaced_by') : [];
  const here: Params = { ...base, node, sub };
  const atPage: Params = { ...here, page: page > 1 ? String(page) : undefined };
  const noUpload = ctx.can('upload') ? undefined : `${t.not_allowed} : ${t.perm_upload}`;
  const axisLabel: Record<Axis, { short: string; full: string }> = {
    family: { short: t.family, full: t.family },
    department: { short: t.ax_department_short, full: t.department },
    project: { short: t.project, full: t.project_program },
    type: { short: t.type, full: t.doc_type },
    origin: { short: t.origin, full: t.origin },
  };

  return (
    <div className="screen" style={{ display: 'flex', minWidth: 0 }} data-screen-label="Explorateur">
      <aside className={styles.tree}>
        <div style={{ padding: '14px 14px 10px' }}>
          <h6 className="sec-title" style={{ marginBottom: 8 }}>{t.classification}</h6>
          <Seg
            name="axis"
            value={axis}
            ariaLabel={t.classification}
            style={{ display: 'flex', width: '100%' }}
            optStyle={{ flex: 1, justifyContent: 'center', padding: '5px 1px', fontSize: 11, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
            options={AXES.map((k) => ({
              key: k,
              label: <span title={axisLabel[k].full}>{axisLabel[k].short}</span>,
              href: href({ axis: k === DEFAULT_AXIS ? undefined : k, status: base.status, due }),
            }))}
          />
        </div>
        <div className={styles.treeBody}>
          <Link href={href(base)} className={styles.node} style={{ background: node ? 'transparent' : HOV, color: node ? 'inherit' : 'var(--color-accent)', gap: 8, paddingLeft: 8 }}>
            <Icon name="folder" size={15} style={{ flex: 'none' }} />
            <span style={{ flex: 1 }}>{t.all_docs}</span>
            <span className="text-muted" style={{ fontSize: 11 }}>{all}</span>
          </Link>
          {treeNodes.map((n) => (
            <div key={n.key} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Link href={href({ ...base, node: n.selected ? undefined : n.key })} className={styles.node} style={{ background: n.selected ? HOV : 'transparent', color: n.selected ? 'var(--color-accent)' : 'inherit' }} title={n.label}>
                <Icon name={n.selected ? 'chevronDown' : 'chevronRight'} size={12} sw={1.8} style={{ flex: 'none', opacity: 0.7 }} />
                <span className="ellipsis" style={{ flex: 1 }}>{n.label}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>{n.count}</span>
              </Link>
              {n.children.map((c) => (
                <Link key={c.key} href={href({ ...base, node: n.key, sub: sub === c.key ? undefined : c.key })} className={`${styles.node} ${styles.child}`} style={{ color: sub === c.key ? 'var(--color-accent)' : 'inherit' }} title={c.label}>
                  <span className="ellipsis" style={{ flex: 1 }}>{c.label}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>{c.count}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.due}>
          <h6 className="sec-title" style={{ padding: '0 6px', marginBottom: 6 }}>{t.facet_overdue}</h6>
          {DUES.map((k) => {
            const on = due === k;
            return (
              <Link key={k} href={href({ ...here, sel, due: on ? undefined : k })} scroll={false} aria-current={on ? 'true' : undefined} className={styles.node} style={{ background: on ? HOV : 'transparent', color: on ? 'var(--color-accent)' : 'inherit', gap: 8, paddingLeft: 8 }}>
                <Icon name="info" size={15} style={{ flex: 'none', opacity: on ? 1 : 0.7 }} />
                <span className="ellipsis" style={{ flex: 1 }}>{t[`f_${k}`]}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>{dueCount[k]}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      <section className={styles.list}>
        <div className={styles.listHead}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="text-muted" style={{ fontSize: 11 }}>{parts.slice(0, -1).join(' › ') || t.classification}</div>
            <div style={{ fontSize: 16 }}>{parts[parts.length - 1]}</div>
          </div>
          <Seg
            name="statusF"
            value={status}
            style={{ flex: 'none', maxWidth: '100%', overflow: 'auto' }}
            optStyle={{ padding: '5px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
            options={STATUSES.map((k) => ({ key: k, label: t[`f_${k}`], href: href({ ...here, sel, status: k === 'all' ? undefined : k }) }))}
          />
          <DialogButton spec={{ kind: 'new' }} className="btn btn-primary" icon="plus" iconSw={1.8} deniedTitle={noUpload}>{t.new_doc_btn}</DialogButton>
        </div>
        {/* A page opens at its top: the list is mounted again for each page. */}
        <div key={page} style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.title_label}</th><th>{t.type}</th><th>{t.rev_short}</th><th>{t.status}</th><th>{t.owner}</th><th>{t.modified}</th><th>{t.retention_short}</th></tr></thead>
            <tbody>
              {rows.map((d) => {
                const selected = d.id === sel;
                return (
                  <ClickRow key={d.id} href={d.href} onSelect={href({ ...atPage, sel: selected ? undefined : d.id })} style={{ boxShadow: selected ? 'inset 2px 0 0 var(--color-accent)' : 'none' }}>
                    <td style={{ maxWidth: 0, width: '100%', minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <Icon name="doc" size={15} style={{ flex: 'none', opacity: 0.55 }} />
                        {/* The keyboard path: Enter selects the row and opens the quick view, whose link opens the record. */}
                        <Link href={href({ ...atPage, sel: selected ? undefined : d.id })} scroll={false} aria-current={selected ? 'true' : undefined} className="ellipsis link-plain" style={{ color: selected ? 'var(--color-accent-300)' : 'inherit' }} title={d.title}>{d.title}</Link>
                      </div>
                      <div className="text-muted ellipsis" style={{ fontSize: 11, paddingLeft: 23 }}>{d.id} · {d.contextL}</div>
                    </td>
                    <td className="text-muted">{d.typeLabel}</td>
                    <td className="text-muted nowrap">
                      <div>{d.rev}</div>
                      {d.revInForce && d.workingLabel && <div style={{ fontSize: 11 }}>{d.workingLabel} {t.in_progress}</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <span className={d.tagClass}>{d.statusLabel}</span>
                        {d.expired && <span className="tag tag-outline">{t.ind_expired}</span>}
                        {d.reviewOverdue && <span className="tag tag-outline">{t.ind_review_late}</span>}
                      </div>
                    </td>
                    <td>{d.owner}</td>
                    <td className="text-muted nowrap">{d.modifiedF}</td>
                    <td className="text-muted nowrap" title={d.retentionL}>{d.untilF}</td>
                  </ClickRow>
                );
              })}
            </tbody>
          </table>
          <div className={styles.foot}>
            <div className="text-muted" style={{ fontSize: 11 }}>{total} {t.docs}</div>
            <Pager t={t} page={page} pages={pages} href={(n) => href({ ...here, sel, page: n > 1 ? String(n) : undefined })} />
          </div>
        </div>
      </section>

      {selDoc && (
        <aside className={styles.quick}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h6 className="sec-title">{t.quick_view}</h6>
            <Link href={href(atPage)} className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} aria-label={t.close} scroll={false}><Icon name="close" size={14} /></Link>
          </div>
          <div>
            <div style={{ fontSize: 15, lineHeight: 1.3, marginBottom: 8 }}>{selDoc.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {selDoc.attachedCode && <span className="tag tag-accent">{selDoc.attachedCode}</span>}
              <span className={selDoc.tagClass}>{selDoc.statusLabel}</span>
              {selDoc.expired && <span className="tag tag-outline">{t.ind_expired}</span>}
              {selDoc.reviewOverdue && <span className="tag tag-outline">{t.ind_review_late}</span>}
              <span className="tag tag-neutral">{t.rev_short} {selDoc.rev}</span>
              <span className="tag tag-neutral">{selDoc.confL}</span>
            </div>
          </div>
          {notice && (
            <div className={styles.stateNotice} data-state={notice.state} role="note">
              <Icon name={notice.state === 'archived' ? 'archive' : 'info'} size={14} style={{ flex: 'none', marginTop: 1 }} />
              <span>
                {notice.text}
                {replacedBy.length > 0 && <> · {t.link_replaced_by} {replacedBy.map((l, i) => <Fragment key={l.id}>{i > 0 && ', '}<Link href={l.doc.href} className={styles.noticeLink} title={l.doc.title}>{l.doc.id}</Link></Fragment>)}</>}
              </span>
            </div>
          )}
          <dl className="dl" style={{ gap: '7px 14px', fontSize: 12 }}>
            <dt className="text-muted">{t.ref}</dt><dd>{selDoc.id}</dd>
            <dt className="text-muted">{t.type}</dt><dd>{selDoc.typeLabel}{selDoc.subtype ? ` · ${selDoc.subtype}` : ''}</dd>
            <dt className="text-muted">{t.family}</dt><dd>{selDoc.familyLabel}</dd>
            <dt className="text-muted">{t.origin}</dt><dd>{selDoc.originL}{selDoc.origin === 'externe' && selDoc.sourceOrg ? ` · ${selDoc.sourceOrg}` : ''}</dd>
            <dt className="text-muted">{t.attachment}</dt><dd>{selDoc.attachment === 'none' ? selDoc.attachmentL : selDoc.contextL}</dd>
            <dt className="text-muted">{t.department_short}</dt><dd>{selDoc.departmentL}</dd>
            {selDoc.site && <><dt className="text-muted">{t.site_label}</dt><dd>{selDoc.siteL}</dd></>}
            <dt className="text-muted">{t.owner}</dt><dd>{selDoc.owner}</dd>
            <dt className="text-muted">{t.revision}</dt><dd>{[selDoc.revInForce, selDoc.workingLabel && `${selDoc.workingLabel} ${t.in_progress}`].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="text-muted">{t.modified}</dt><dd>{selDoc.modifiedF}</dd>
            {selDoc.reviewDueAt && <><dt className="text-muted">{t.review_due_at}</dt><dd>{selDoc.reviewDueF}</dd></>}
            {selDoc.expiresAt && <><dt className="text-muted">{t.expires_at}</dt><dd>{selDoc.expiresF}</dd></>}
            <dt className="text-muted">{t.retention_short}</dt><dd>{selDoc.retentionL} · {selDoc.untilF}</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={selDoc.href} className="btn btn-primary">{t.open_record}</Link>
            {selHasFile
              ? <a href={`/api/documents/${encodeURIComponent(selDoc.id)}/file?download=1`} className="btn btn-secondary"><Icon name="download" size={14} />{t.download}</a>
              : <button type="button" className="btn btn-secondary" aria-disabled title={t.no_version}><Icon name="download" size={14} />{t.download}</button>}
          </div>
        </aside>
      )}
    </div>
  );
}
