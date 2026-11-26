import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Pager } from '@/components/ui/Pager';
import { Segmented } from '@norma/charte/ds/Segmented';
import { FilterBar } from '@norma/charte/ds/FilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { msg, translatorFor } from '@/i18n';
import { HStepper, type StepItem } from '@/components/ui/Stepper';
import { ActionButton, ActionLink, DialogButton } from '@/components/ui/client';
import { mayReassignStep } from '@/lib/access';
import { decideStep } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import type { LockKey } from '@/lib/lifecycle';
import { getDoc, listChangeRequests, listRevisions, validationsPage, WORKFLOW_FILTERS, type WorkflowFilter } from '@/lib/queries';
import { CommentBox } from './CommentBox';
import { MyChangeRequests } from './MyChangeRequests';
import { vigieLinkConfigured, vigieUrl } from '@/server/integrations/vigie';
import styles from './workflow.module.css';
import { screenTitle } from '@/lib/titles';

const FILTERS = WORKFLOW_FILTERS;
type Filter = WorkflowFilter;

/** The views of the list (lib/queries.ts WORKFLOW_FILTERS). */
const FILTER_LABEL: Record<Filter, string> = { mine: msg('For me'), requested: msg('My requests'), active: msg('In progress'), done: msg('Completed') };

/** Why a circuit is frozen (lib/lifecycle.ts lockOf). */
const LOCK_TEXT: Record<LockKey, string> = {
  locked_archived: msg('Archived document: it cannot be changed.'),
  locked_obsolete: msg('Obsolete document: it cannot be changed.'),
  locked_hold: msg('Document under legal hold: it cannot be changed.'),
};
/** `f` of the view « Mes demandes Vigie » (`c`: the request shown), beside the workflow filters. */
const VIGIE = 'vigie';

export function generateMetadata() {
  return screenTitle('nav_workflow');
}

export default async function WorkflowPage({ searchParams }: PageProps<'/validations'>) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const ctx = await getCtx();
  // The pager is shared with the other lists and still reads the keyed dictionary (components/ui/Pager.tsx).
  const { t } = ctx;
  const tr = translatorFor(ctx.lang);
  if (!ctx.screens.workflow) return <Forbidden text={tr('The simulated role cannot access this screen.')} back={tr('Back to home')} />;
  // Records managers follow every workflow; others the ones they request or take part in (filtered, counted and paged by
  // the database: lib/queries.ts validationsPage). Beside them, the change and withdrawal requests the user sent to
  // Vigie, on documents they may still read (f=vigie).
  const explicit = (FILTERS as readonly string[]).includes(sp.f ?? '') ? (sp.f as Filter) : null;
  const asked = /^\d{1,6}$/.test(sp.p ?? '') ? Number(sp.p) : null;
  const vigieView = sp.f === VIGIE;
  const [wf, sent] = await Promise.all([
    validationsPage(ctx, { filter: explicit, r: vigieView ? null : sp.r, page: asked }),
    listChangeRequests(ctx, { mine: true }),
  ]);
  const href = (f: Filter, id?: string, page?: number) => `/validations?f=${f}${id ? `&r=${encodeURIComponent(id)}` : ''}${page && page > 1 ? `&p=${page}` : ''}`;
  const vigieHref = (id?: string) => `/validations?f=${VIGIE}${id ? `&c=${encodeURIComponent(id)}` : ''}`;
  // "Circuits" leads to the first filter with something in it.
  const landing: Filter = FILTERS.find((k) => wf.counts[k] > 0) ?? 'mine';
  // The screen's header (Norma 2.0): its two views as the toolbar's tabs, the actions on the circuit shown.
  const header = (view: 'circuits' | typeof VIGIE, more: { crumbs?: string[]; primary?: ReactNode; actions?: ReactNode } = {}) => (
    <PageHeader
      title={tr('Approval workflows')}
      crumbs={more.crumbs}
      primary={more.primary}
      actions={more.actions}
      toolbar={
        <FilterBar>
          <Segmented
            className="codex-seg"
            wrap
            value={view}
            options={[
              { value: 'circuits', label: tr('Workflows'), count: wf.total, href: href(landing) },
              { value: VIGIE, label: tr('My Vigie requests'), count: sent.length, href: vigieHref() },
            ]}
          />
        </FilterBar>
      }
    />
  );

  // Without a filter or a circuit asked for, someone who takes part in no circuit lands on the requests they sent.
  if (vigieView || (!sp.f && !sp.r && !wf.total && sent.length)) {
    const picked = sp.c ? sent.find((c) => c.id === sp.c) : undefined;
    // Not one of the user's requests (another person's, or on a document they no longer read): back to their list.
    if (sp.c && !picked) redirect(vigieHref());
    // Those still waiting for Vigie or for their application first, then the most recent.
    const waiting = (c: (typeof sent)[number]) => c.status === 'submitted' || c.status === 'accepted';
    const list = [...sent].sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
    const shown = picked ?? list[0];
    const vigieLink = vigieLinkConfigured();
    return (
      <>
        {header(VIGIE, {
          actions: shown && <>
            {vigieLink && <ActionLink native href={vigieUrl(shown.id)} icon="openExternal">{tr('Open in Vigie')}</ActionLink>}
            <ActionLink href={`${shown.docHref}?tab=requests`}>{tr('Open record')}</ActionLink>
          </>,
        })}
        <MyChangeRequests tr={tr} requests={list} selected={shown} href={vigieHref} />
      </>
    );
  }
  if (wf.hidden) {
    // A circuit the user took part in but no longer sees: once it is over, its approvers leave the drafting circle
    // (D-14), right after their own rejection or final approval for instance. Back to the list, without it.
    if (wf.hidden.tookPart) redirect(`/validations${explicit ? `?f=${explicit}` : ''}`);
    // Any other existing circuit: say so rather than silently showing another one.
    return <Forbidden text={tr('You do not have access to this document.')} back={tr('Back to home')} />;
  }
  const { filter, list, page, pages } = wf;
  const r = wf.selected;
  const filterLabel = (k: Filter) => tr(FILTER_LABEL[k]);

  if (!r) {
    return (
      <>
        {header('circuits')}
        <div className="screen panes" data-screen-label="Validations">
          <aside className={styles.side}>
            <p className="text-muted" style={{ padding: '16px 20px', fontSize: 12.5, margin: 0 }}>{tr('No workflow in this view.')}</p>
          </aside>
          <section style={{ flex: 1, minWidth: 0 }} />
        </div>
      </>
    );
  }
  const [found, revs] = await Promise.all([getDoc(ctx, r.docId), listRevisions(ctx, r.docId)]);
  const doc = found && found !== 'hidden' ? found.doc : null;
  const rev = revs.find((x) => x.id === r.revisionId);
  const over = r.done;
  const canAct = r.mine;
  // An archived, obsolete or frozen document freezes its circuit: nobody decides until the lock is lifted.
  const lockText = r.locked ? tr(LOCK_TEXT[r.locked]) : undefined;
  const approveDenied = lockText ?? (ctx.can('approve') ? undefined : `${tr('Permission required')} : ${tr('Approve#permission')}`);
  // The last approval puts the revision in force: the "publish" permission as well.
  const lastStep = r.step === r.steps.length - 1;
  const publishDenied = approveDenied ?? (lastStep && !ctx.can('publish') ? `${tr('Permission required')} : ${tr('Publish')}` : undefined);
  // The requester or a records manager may recall a running circuit (lib/access.ts, mayRecall); a lock stops them too.
  const closeSpec = { workflowId: r.id, step: r.step, stepName: r.stepName, docId: r.docId, title: r.docTitle, letter: r.letter };
  const recallBtn = r.recallable && <DialogButton spec={{ kind: 'recall', ...closeSpec }} deniedTitle={lockText}>{tr('Recall the request')}</DialogButton>;
  // Never offered as delegates: the requester, the revision's author (designated, or the owner) and its working versions' authors.
  const excluded = [...new Set([r.requesterId, rev?.modifierId ?? doc?.ownerId, ...(rev?.versions.map((v) => v.authorId) ?? [])].filter((x): x is string => !!x))];
  // A records manager hands on a step someone else holds (an absent person, point 19): the rules of a delegation.
  const reassignBtn = !canAct && !over && r.current && mayReassignStep(ctx) && (
    <DialogButton spec={{ kind: 'reassign', workflowId: r.id, stepName: r.stepName, step: r.step, excluded, holder: r.current.assigneeId, holderName: r.current.assignee }} deniedTitle={lockText}>{tr('Reassign')}</DialogButton>
  );

  const steps: StepItem[] = r.steps.map((st) => {
    if ((r.outcome === 'rejected' || r.outcome === 'recalled') && st.idx >= r.step) {
      // The circuit stopped here: the rejecting step, then steps that will not happen (all of them after a recall).
      return st.idx === r.step && r.outcome === 'rejected'
        ? { key: st.idx, state: 'current', title: st.nameL, lines: [st.assignee, tr('Rejected')] }
        : { key: st.idx, state: 'todo', title: st.nameL, lines: [st.assignee] };
    }
    return { key: st.idx, state: st.state, title: st.nameL, lines: [st.assignee, `${st.stateLabel} ${st.dateF}`.trim()] };
  });

  // The decision on the step shown: approve (main action), reject, delegate, recall; or, for whoever does not hold the
  // step, the hand-over and the recall.
  const decision = canAct ? {
    primary: <ActionButton className="btn btn-primary" disabled={!!publishDenied} title={publishDenied} action={decideStep.bind(null, r.id, true, r.step)} after={href(filter, r.id, page)}><Icon name="tick" size={14} sw={1.8} />{tr('Approve')}</ActionButton>,
    actions: <>
      {r.step > 0 && <DialogButton spec={{ kind: 'reject', ...closeSpec }} icon="close" deniedTitle={approveDenied}>{tr('Reject')}</DialogButton>}
      <DialogButton spec={{ kind: 'delegate', workflowId: r.id, stepName: r.stepName, step: r.step, excluded }} deniedTitle={lockText}>{tr('Delegate')}</DialogButton>
      {recallBtn}
    </>,
  } : { actions: <>{reassignBtn}{recallBtn}</> };

  return (
    <>
    {header('circuits', { crumbs: [tr('Workflows'), filterLabel(filter)], ...decision })}
    <div className="screen panes" data-screen-label="Validations">
      <aside className={styles.side}>
        <div style={{ padding: '12px 12px 10px' }}>
          <Segmented
            className={styles.filters}
            fullWidth
            value={filter}
            label={tr('Workflows')}
            options={FILTERS.map((k) => ({ value: k, label: filterLabel(k), count: wf.counts[k], href: href(k, r.id) }))}
          />
        </div>
        <div className={styles.list}>
          {list.length === 0 && <p className="text-muted" style={{ padding: '16px 8px', fontSize: 12.5, margin: 0 }}>{tr('No workflow in this view.')}</p>}
          {list.map((w) => (
            <Link key={w.id} href={href(filter, w.id, page)} scroll={false} className={styles.item} style={{ background: w.id === r.id ? 'color-mix(in srgb,var(--color-accent) 10%,transparent)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0 }}>
                <span className="text-muted ellipsis" style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{w.docId} · {tr('Revision')} {w.letter}</span>
                <span className="text-muted tabnum nowrap" style={{ fontSize: 11 }}>{w.progress}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.3 }}>{w.docTitle}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {w.done ? w.outcomeL ?? tr('Completed') : `${tr('Step')} : ${w.stepName}`} · {tr('Due')} {w.dueF}
                {w.lateL && <> <span className="tag tag-outline" style={{ fontSize: 10.5, padding: '0 6px', marginLeft: 4 }} title={w.lateTitle ?? undefined}>{w.lateL}</span></>}
              </div>
            </Link>
          ))}
          {pages > 1 && <div style={{ padding: '10px 2px 0', display: 'flex', justifyContent: 'center' }}><Pager t={t} page={page} pages={pages} href={(n) => href(filter, r.id, n)} /></div>}
        </div>
      </aside>

      <section className={styles.detail}>
        <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11 }}>{r.docId} · {tr('Revision')} {r.letter} · {tr('Requested by')} {r.requester}</div>
            <h2 style={{ fontSize: 20, margin: '2px 0 8px', lineHeight: 1.25 }}>{r.docTitle}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tag tag-neutral">{doc?.typeLabel ?? ctx.label('type', r.typeCode)}</span>
              <span className="tag tag-neutral">{tr('Revision')} {r.letter}</span>
              {doc && <span className="tag tag-neutral">{doc.contextL}</span>}
              <span className="text-muted" style={{ fontSize: 12, marginLeft: 4 }}>{tr('Due')} {r.dueF}</span>
              {r.lateL && <span className="tag tag-outline" title={r.lateTitle ?? undefined}>{r.lateL}</span>}
              {doc && <Link href={doc.href} className="link-plain nowrap" style={{ fontSize: 12, marginLeft: 'auto' }}>{tr('Open record')}</Link>}
            </div>
          </div>
          <section>
            <h2 className="sec-title" style={{ marginBottom: 14 }}>{tr('Workflow steps')}</h2>
            <HStepper items={steps} />
          </section>
          {canAct && (r.current?.sign || lockText) && (
            <div className="card elev-sm" style={{ padding: '14px 16px', gap: 12 }}>
              {r.current?.sign && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="pen" size={15} style={{ color: 'var(--color-accent)' }} />{tr('Advanced electronic signature (eIDAS) required at this step.')}</div>}
              {lockText && <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="lock" size={15} style={{ color: 'var(--color-accent)' }} />{lockText} {tr('Locked document: the workflow resumes once the lock is lifted.')}</div>}
            </div>
          )}
          {!canAct && (recallBtn || reassignBtn) && (
            <div className="card elev-sm" style={{ padding: '14px 16px', gap: 12 }}>
              {recallBtn && <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('You may recall this request until the last approval is given: the revision will go back to drafting.')}</div>}
              {reassignBtn && <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('The step is held by {who}. Reserved to records managers, with the rules of a delegation.', { who: r.current!.assignee })}</div>}
              {lockText && <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="lock" size={15} style={{ color: 'var(--color-accent)' }} />{lockText} {tr('Locked document: the workflow resumes once the lock is lifted.')}</div>}
            </div>
          )}
          {over && (
            <div className="card" style={{ padding: '12px 16px', flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon name={r.outcome === 'approved' ? 'tick' : 'close'} sw={1.8} style={{ color: 'var(--color-accent)' }} />
              <span style={{ fontSize: 13 }}>{r.outcomeL ?? tr('Completed')}</span>
              {r.closer && <span className="text-muted" style={{ fontSize: 12 }}>{r.closer}{r.closedF ? ` · ${r.closedF}` : ''}</span>}
              {rev && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {tr('Revision')} {rev.letter} · {rev.statusLabel}
                  {rev.status === 'approved' && rev.effectiveAt ? ` · ${tr('Effective date')} ${rev.effectiveF}` : rev.status === 'in_force' && rev.inForceAt ? ` · ${rev.inForceF}` : ''}
                </span>
              )}
            </div>
          )}
          <section>
            <h2 className="sec-title" style={{ marginBottom: 12 }}>{tr('Comments')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {r.comments.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 12 }}>
                  <div className={styles.avatar}>{c.initials}</div>
                  <div style={{ minWidth: 0 }}><div className="text-muted" style={{ fontSize: 11 }}>{c.who} · {c.whenF}</div><div style={{ fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.text}</div></div>
                </div>
              ))}
              <CommentBox key={r.id} workflowId={r.id} />
            </div>
          </section>
        </div>
      </section>
    </div>
    </>
  );
}
