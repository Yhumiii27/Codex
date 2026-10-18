import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { HStepper, type StepItem } from '@/components/ui/Stepper';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { mayReassignStep } from '@/lib/access';
import { decideStep } from '@/lib/actions';
import { getCtx } from '@/lib/context';
import { getDoc, listChangeRequests, listRevisions, listWorkflows, type WorkflowView } from '@/lib/queries';
import { CommentBox } from './CommentBox';
import { MyChangeRequests } from './MyChangeRequests';
import styles from './workflow.module.css';

const FILTERS = ['mine', 'requested', 'active', 'done'] as const;
type Filter = (typeof FILTERS)[number];
/** `f` of the view « Mes demandes Vigie » (`c`: the request shown), beside the workflow filters. */
const VIGIE = 'vigie';

/** `done` once the workflow has an outcome: a rejection stops it at the rejecting step, a recall at the step it reached. */
const PICK: Record<Filter, (w: WorkflowView) => boolean> = {
  mine: (w) => w.mine,
  requested: (w) => w.requested,
  active: (w) => !w.done,
  done: (w) => w.done,
};

export default async function WorkflowPage({ searchParams }: PageProps<'/validations'>) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const ctx = await getCtx();
  const { t } = ctx;
  if (!ctx.screens.workflow) return <Forbidden text={t.forbidden} back={t.back_home} />;
  // Records managers follow every workflow; others the ones they request or take part in. Beside them, the change and
  // withdrawal requests the user sent to Vigie, on documents they may still read (f=vigie).
  const [every, sent] = await Promise.all([listWorkflows(ctx), listChangeRequests(ctx, { mine: true })]);
  const all = every.filter((w) => w.visible);
  const href = (f: Filter, id?: string) => `/validations?f=${f}${id ? `&r=${encodeURIComponent(id)}` : ''}`;
  const vigieHref = (id?: string) => `/validations?f=${VIGIE}${id ? `&c=${encodeURIComponent(id)}` : ''}`;
  // "Circuits" leads to the first filter with something in it.
  const landing: Filter = FILTERS.find((k) => all.some(PICK[k])) ?? 'mine';
  const views = (view: 'circuits' | typeof VIGIE) => (
    <div style={{ padding: '14px 12px 0' }}>
      <Seg
        name="wfView"
        value={view}
        style={{ display: 'flex', width: '100%' }}
        optStyle={{ flex: '1 1 auto', justifyContent: 'center', padding: '6px 6px', fontSize: 12, gap: 5, whiteSpace: 'nowrap' }}
        options={[
          { key: 'circuits', label: t.wf_circuits, count: all.length, href: href(landing) },
          { key: VIGIE, label: t.wf_vigie, count: sent.length, href: vigieHref() },
        ]}
      />
    </div>
  );

  // Without a filter or a circuit asked for, someone who takes part in no circuit lands on the requests they sent.
  if (sp.f === VIGIE || (!sp.f && !sp.r && !all.length && sent.length)) {
    const picked = sp.c ? sent.find((c) => c.id === sp.c) : undefined;
    // Not one of the user's requests (another person's, or on a document they no longer read): back to their list.
    if (sp.c && !picked) redirect(vigieHref());
    // Those still waiting for Vigie or for their application first, then the most recent.
    const waiting = (c: (typeof sent)[number]) => c.status === 'submitted' || c.status === 'accepted';
    const list = [...sent].sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
    return <MyChangeRequests t={t} views={views(VIGIE)} requests={list} selected={picked ?? list[0]} href={vigieHref} />;
  }
  const requested = sp.r ? all.find((w) => w.id === sp.r) : undefined;
  const explicit = (FILTERS as readonly string[]).includes(sp.f ?? '') ? (sp.f as Filter) : null;
  const hidden = sp.r && !requested ? every.find((w) => w.id === sp.r) : undefined;
  if (hidden) {
    // A circuit the user took part in but no longer sees: once it is over, its approvers leave the drafting circle
    // (D-14), right after their own rejection or final approval for instance. Back to the list, without it.
    if (hidden.requested || hidden.steps.some((st) => st.assigneeId === ctx.user.id)) redirect(`/validations${explicit ? `?f=${explicit}` : ''}`);
    // Any other existing circuit: say so rather than silently showing another one.
    return <Forbidden text={t.no_access} back={t.back_home} />;
  }
  // Without an explicit filter: land on "mine", unless the requested workflow is elsewhere or nothing waits for me.
  const filter: Filter =
    explicit ??
    (requested
      ? PICK.mine(requested) ? 'mine' : requested.requested ? 'requested' : requested.done ? 'done' : 'active'
      : landing);
  const list = all.filter(PICK[filter]);
  if (filter === 'done') list.reverse();
  // My requests: the ones still running first.
  if (filter === 'requested') list.sort((a, b) => Number(a.done) - Number(b.done));
  const r = requested ?? list[0] ?? all[0];
  const filterLabel = (k: Filter) => t[`wf_${k}`];

  if (!r) {
    return (
      <div className="screen" style={{ display: 'flex', minWidth: 0 }} data-screen-label="Validations">
        <aside className={styles.side}>
          {views('circuits')}
          <p className="text-muted" style={{ padding: '16px 20px', fontSize: 12.5, margin: 0 }}>{t.wf_empty}</p>
        </aside>
        <section style={{ flex: 1, minWidth: 0 }} />
      </div>
    );
  }
  const [found, revs] = await Promise.all([getDoc(ctx, r.docId), listRevisions(ctx, r.docId)]);
  const doc = found && found !== 'hidden' ? found.doc : null;
  const rev = revs.find((x) => x.id === r.revisionId);
  const over = r.done;
  const canAct = PICK.mine(r);
  // An archived, obsolete or frozen document freezes its circuit: nobody decides until the lock is lifted.
  const lockText = r.locked ? t[r.locked] : undefined;
  const approveDenied = lockText ?? (ctx.can('approve') ? undefined : `${t.not_allowed} : ${t.perm_approve}`);
  // The last approval puts the revision in force: the "publish" permission as well.
  const lastStep = r.step === r.steps.length - 1;
  const publishDenied = approveDenied ?? (lastStep && !ctx.can('publish') ? `${t.not_allowed} : ${t.perm_publish}` : undefined);
  // The requester or a records manager may recall a running circuit (lib/access.ts, mayRecall); a lock stops them too.
  const closeSpec = { workflowId: r.id, step: r.step, stepName: r.stepName, docId: r.docId, title: r.docTitle, letter: r.letter };
  const recallBtn = r.recallable && <DialogButton spec={{ kind: 'recall', ...closeSpec }} className="btn btn-ghost" deniedTitle={lockText}>{t.recall}</DialogButton>;
  // Never offered as delegates: the requester, the revision's author (designated, or the owner) and its working versions' authors.
  const excluded = [...new Set([r.requesterId, rev?.modifierId ?? doc?.ownerId, ...(rev?.versions.map((v) => v.authorId) ?? [])].filter((x): x is string => !!x))];
  // A records manager hands on a step someone else holds (an absent person, point 19): the rules of a delegation.
  const reassignBtn = !canAct && !over && r.current && mayReassignStep(ctx) && (
    <DialogButton spec={{ kind: 'reassign', workflowId: r.id, stepName: r.stepName, step: r.step, excluded, holder: r.current.assigneeId, holderName: r.current.assignee }} className="btn btn-ghost" deniedTitle={lockText}>{t.reassign}</DialogButton>
  );

  const steps: StepItem[] = r.steps.map((st) => {
    if ((r.outcome === 'rejected' || r.outcome === 'recalled') && st.idx >= r.step) {
      // The circuit stopped here: the rejecting step, then steps that will not happen (all of them after a recall).
      return st.idx === r.step && r.outcome === 'rejected'
        ? { key: st.idx, state: 'current', title: st.nameL, lines: [st.assignee, t.wf_rejected] }
        : { key: st.idx, state: 'todo', title: st.nameL, lines: [st.assignee] };
    }
    return { key: st.idx, state: st.state, title: st.nameL, lines: [st.assignee, `${st.stateLabel} ${st.dateF}`.trim()] };
  });

  return (
    <div className="screen" style={{ display: 'flex', minWidth: 0 }} data-screen-label="Validations">
      <aside className={styles.side}>
        {views('circuits')}
        <div style={{ padding: '8px 12px 10px' }}>
          <Seg
            name="wfFilter"
            value={filter}
            style={{ display: 'flex', width: '100%' }}
            optStyle={{ flex: '1 1 auto', justifyContent: 'center', padding: '6px 3px', fontSize: 11.5, gap: 4, whiteSpace: 'nowrap' }}
            options={FILTERS.map((k) => ({ key: k, label: filterLabel(k), count: all.filter(PICK[k]).length, href: href(k, r.id) }))}
          />
        </div>
        <div className={styles.list}>
          {list.length === 0 && <p className="text-muted" style={{ padding: '16px 8px', fontSize: 12.5, margin: 0 }}>{t.wf_empty}</p>}
          {list.map((w) => (
            <Link key={w.id} href={href(filter, w.id)} scroll={false} className={styles.item} style={{ background: w.id === r.id ? 'color-mix(in srgb,var(--color-accent) 10%,transparent)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0 }}>
                <span className="text-muted ellipsis" style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{w.docId} · {t.revision} {w.letter}</span>
                <span className="text-muted tabnum nowrap" style={{ fontSize: 11 }}>{w.progress}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.3 }}>{w.docTitle}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {w.done ? w.outcomeL ?? t.wf_finished : `${t.step} : ${w.stepName}`} · {t.due} {w.dueF}
              </div>
            </Link>
          ))}
        </div>
      </aside>

      <section style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 28px 28px' }}>
        <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11 }}>{r.docId} · {t.revision} {r.letter} · {t.requested_by} {r.requester}</div>
            <h3 style={{ fontSize: 20, margin: '2px 0 8px', lineHeight: 1.25 }}>{r.docTitle}</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tag tag-neutral">{doc?.typeLabel ?? ctx.label('type', r.typeCode)}</span>
              <span className="tag tag-neutral">{t.revision} {r.letter}</span>
              {doc && <span className="tag tag-neutral">{doc.contextL}</span>}
              <span className="text-muted" style={{ fontSize: 12, marginLeft: 4 }}>{t.due} {r.dueF}</span>
              {doc && <Link href={doc.href} className="link-plain nowrap" style={{ fontSize: 12, marginLeft: 'auto' }}>{t.open_record}</Link>}
            </div>
          </div>
          <section>
            <h6 className="sec-title" style={{ marginBottom: 14 }}>{t.steps}</h6>
            <HStepper items={steps} />
          </section>
          {canAct && (
            <div className="card elev-sm" style={{ padding: '14px 16px', gap: 12 }}>
              {r.current?.sign && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="pen" size={15} style={{ color: 'var(--color-accent)' }} />{t.sign_note}</div>}
              {lockText && <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="lock" size={15} style={{ color: 'var(--color-accent)' }} />{lockText} {t.wf_closed_hint}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton className="btn btn-primary" disabled={!!publishDenied} title={publishDenied} action={decideStep.bind(null, r.id, true, r.step)} after={href(filter, r.id)}><Icon name="tick" size={14} sw={1.8} />{t.approve}</ActionButton>
                {r.step > 0 && <DialogButton spec={{ kind: 'reject', ...closeSpec }} icon="close" deniedTitle={approveDenied}>{t.reject}</DialogButton>}
                <DialogButton spec={{ kind: 'delegate', workflowId: r.id, stepName: r.stepName, step: r.step, excluded }} className="btn btn-ghost" deniedTitle={lockText}>{t.delegate}</DialogButton>
                {recallBtn}
              </div>
            </div>
          )}
          {!canAct && (recallBtn || reassignBtn) && (
            <div className="card elev-sm" style={{ padding: '14px 16px', gap: 12 }}>
              {recallBtn && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.recall_note}</div>}
              {reassignBtn && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.reassign_hint.replace('{who}', r.current!.assignee)}</div>}
              {lockText && <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="lock" size={15} style={{ color: 'var(--color-accent)' }} />{lockText} {t.wf_closed_hint}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{reassignBtn}{recallBtn}</div>
            </div>
          )}
          {over && (
            <div className="card" style={{ padding: '12px 16px', flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon name={r.outcome === 'approved' ? 'tick' : 'close'} sw={1.8} style={{ color: 'var(--color-accent)' }} />
              <span style={{ fontSize: 13 }}>{r.outcomeL ?? t.wf_finished}</span>
              {r.closer && <span className="text-muted" style={{ fontSize: 12 }}>{r.closer}{r.closedF ? ` · ${r.closedF}` : ''}</span>}
              {rev && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {t.revision} {rev.letter} · {rev.statusLabel}
                  {rev.status === 'approved' && rev.effectiveAt ? ` · ${t.effective_at} ${rev.effectiveF}` : rev.status === 'in_force' && rev.inForceAt ? ` · ${rev.inForceF}` : ''}
                </span>
              )}
            </div>
          )}
          <section>
            <h6 className="sec-title" style={{ marginBottom: 12 }}>{t.comments}</h6>
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
  );
}
