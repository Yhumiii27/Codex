import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { ECR_TAGCLS, type T } from '@/lib/i18n';
import type { ChangeRequestView } from '@/lib/queries';
import { vigieLinkConfigured, vigieUrl } from '@/lib/vigie';
import styles from './workflow.module.css';

/**
 * Validations › Mes demandes Vigie: the change and withdrawal requests the user sent (G18), as listChangeRequests gives
 * them to this reader. Outside a document's drafting circle, it already leaves out the change order, the designated
 * author and the revision of a change not in force yet, and shows a graft onto a hidden revision « Acceptée » (D-14).
 * `requests`: still waiting first; `selected`: the one shown; `href`: the URL that selects a request. Dates keep their
 * year: the list holds every request ever sent. The link to Vigie only when its address is configured.
 */
export function MyChangeRequests({ t, views, requests, selected, href }: { t: T; views: ReactNode; requests: ChangeRequestView[]; selected: ChangeRequestView | undefined; href: (id: string) => string }) {
  const c = selected;
  const vigieLink = vigieLinkConfigured();
  const facts = c
    ? ([
        [t.ecr_sent_on, c.sentF],
        [t.ecr_decided_on, c.decidedF],
        [t.eco_ref, c.ecoRef],
        [t.modifier, c.modifier],
        [t.ecr_note, c.decisionNote],
        [t.replacement_proposed, c.replacement ? `${c.replacement.id} · ${c.replacement.title}` : null],
      ] as const).filter((x): x is readonly [string, string] => !!x[1])
    : [];
  // What the status means now: waiting for Vigie, waiting to apply (in words this reader may be given), or where it went.
  const outcome = !c
    ? null
    : c.status === 'submitted'
      ? t.ecr_wait_vigie
      : c.waitL
        ? `${t.ecr_pending_apply} : ${c.waitL}.`
        : c.carrier
          ? `${c.carrier.grafted ? t.change_grafted_on : t.change_opened} ${c.carrier.letter}.`
          : null;

  return (
    <div className="screen" style={{ display: 'flex', minWidth: 0 }} data-screen-label="Validations">
      <aside className={styles.side}>
        {views}
        <div className={styles.list} style={{ paddingTop: 10 }}>
          {requests.length === 0 && <p className="text-muted" style={{ padding: '16px 8px', fontSize: 12.5, margin: 0 }}>{t.vigie_empty}</p>}
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

      <section style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 28px 28px' }}>
        {c && (
          <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 11 }}>{c.id} · {c.docId}</div>
              <h2 style={{ fontSize: 20, margin: '2px 0 8px', lineHeight: 1.25 }}>{c.docTitle}</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={ECR_TAGCLS[c.status] ?? 'tag tag-neutral'}>{c.statusL}</span>
                <span className="tag tag-neutral">{c.kindL}</span>
                <span style={{ display: 'flex', gap: 14, marginLeft: 'auto', fontSize: 12 }}>
                  <Link href={`${c.docHref}?tab=requests`} className="link-plain nowrap">{t.open_record}</Link>
                  {vigieLink && <a href={vigieUrl(c.id)} target="_blank" rel="noreferrer" className="link-plain nowrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="openExternal" size={12} />{t.open_vigie}</a>}
                </span>
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
              <h2 className="sec-title" style={{ marginBottom: 12 }}>{t.ecr_reason}</h2>
              <div style={{ fontSize: 13 }}>{c.reason}</div>
              {c.description && <div className="text-muted" style={{ fontSize: 12.5, marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.description}</div>}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
