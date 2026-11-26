import { Fragment } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { Translate } from '@/i18n';
import { ECR_TAGCLS } from '@/lib/i18n';
import type { ChangeRequestView } from '@/lib/queries';
import styles from './workflow.module.css';

/**
 * Validations › Mes demandes Vigie: the change and withdrawal requests the user sent (G18), as listChangeRequests gives
 * them to this reader. Outside a document's drafting circle, it already leaves out the change order, the designated
 * author and the revision of a change not in force yet, and shows a graft onto a hidden revision « Acceptée » (D-14).
 * `requests`: still waiting first; `selected`: the one shown; `href`: the URL that selects a request. Dates keep their
 * year: the list holds every request ever sent. The record and Vigie (when its address is configured) are opened from
 * the page header (validations/page.tsx).
 */
export function MyChangeRequests({ tr, requests, selected, href }: { tr: Translate; requests: ChangeRequestView[]; selected: ChangeRequestView | undefined; href: (id: string) => string }) {
  const c = selected;
  const facts = c
    ? ([
        [tr('Sent on'), c.sentF],
        [tr('Vigie decision'), c.decidedF],
        [tr('ECO'), c.ecoRef],
        [tr('Designated author'), c.modifier],
        [tr('Vigie note'), c.decisionNote],
        [tr('Proposed replacement'), c.replacement ? `${c.replacement.id} · ${c.replacement.title}` : null],
      ] as const).filter((x): x is readonly [string, string] => !!x[1])
    : [];
  // What the status means now: waiting for Vigie, waiting to apply (in words this reader may be given), or where it went.
  const outcome = !c
    ? null
    : c.status === 'submitted'
      ? tr('Waiting for Vigie’s decision.')
      : c.waitL
        ? `${tr('Pending application')} : ${c.waitL}.`
        : c.carrier
          ? `${c.carrier.grafted ? tr('Grafted onto revision') : tr('Opened revision')} ${c.carrier.letter}.`
          : null;

  return (
    <div className="screen panes" data-screen-label="Validations">
      <aside className={styles.side}>
        <div className={styles.list} style={{ paddingTop: 10 }}>
          {requests.length === 0 && <p className="text-muted" style={{ padding: '16px 8px', fontSize: 12.5, margin: 0 }}>{tr('No change or withdrawal request sent to Vigie.')}</p>}
          {requests.map((r) => (
            <Link key={r.id} href={href(r.id)} scroll={false} className={styles.item} style={{ background: r.id === c?.id ? 'color-mix(in srgb,var(--color-accent) 10%,transparent)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0 }}>
                <span className="text-muted ellipsis" style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{r.docId} · {r.kindL}</span>
                <span className="text-muted tabnum nowrap" style={{ fontSize: 11 }}>{r.sentDayF}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.3 }}>{r.docTitle}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{r.id} · {r.statusL}</div>
            </Link>
          ))}
        </div>
      </aside>

      <section className={styles.detail}>
        {c && (
          <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 11 }}>{c.id} · {c.docId}</div>
              <h2 style={{ fontSize: 20, margin: '2px 0 8px', lineHeight: 1.25 }}>{c.docTitle}</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={ECR_TAGCLS[c.status] ?? 'tag tag-neutral'}>{c.statusL}</span>
                <span className="tag tag-neutral">{c.kindL}</span>
              </div>
            </div>
            {outcome && (
              <div className="card" role="note" style={{ padding: '12px 16px', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Icon name={c.status === 'implemented' ? 'tick' : 'info'} size={15} sw={1.8} style={{ flex: 'none', color: 'var(--color-accent)' }} />
                <span style={{ fontSize: 13 }}>{outcome}</span>
              </div>
            )}
            <dl className="dl" style={{ gap: '9px 16px', fontSize: 12.5 }}>
              {facts.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></Fragment>)}
            </dl>
            <section>
              <h2 className="sec-title" style={{ marginBottom: 12 }}>{tr('Reason')}</h2>
              <div style={{ fontSize: 13 }}>{c.reason}</div>
              {c.description && <div className="text-muted" style={{ fontSize: 12.5, marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.description}</div>}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
