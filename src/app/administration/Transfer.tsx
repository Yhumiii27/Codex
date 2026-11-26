import Form from 'next/form';
import Link from 'next/link';
import { ActionButton } from '@/components/ui/client';
import { mayTransferHoldings } from '@/lib/access';
import { transferHoldings } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { loc } from '@/lib/format';
import { transferView } from '@/lib/queries';
import { TRANSFER_KINDS, type TransferItem, type TransferNote } from '@/lib/transfer';
import styles from './admin.module.css';
import { TRANSFER_KIND_LABEL, TRANSFER_REASON_LABEL, labelOf } from '@/i18n/labels';

/**
 * Administration › Reprise (point 19 of docs/reste-a-faire.md): the person who leaves and the replacement are chosen in
 * the URL (`person`, `replacement`), the simulation shows what the transfer would do (lib/transfer.ts, rolled back), and
 * the confirmation sends back its digest: a plan that reads otherwise by then is refused. Records managers only.
 */
export async function Transfer({ ctx, person, replacement }: { ctx: Ctx; person: string; replacement: string }) {
  const { tr } = ctx;
  if (!mayTransferHoldings(ctx)) return <p className="text-muted">{tr('The simulated role cannot access this screen.')}</p>;
  const people = [...ctx.users.values()].filter((u) => !u.isSystem).sort((a, b) => a.name.localeCompare(b.name, ctx.lang));
  const plan = person ? await transferView(ctx, person, replacement || null) : null;
  const here = `/administration?tab=transfer&person=${encodeURIComponent(person)}${replacement ? `&replacement=${encodeURIComponent(replacement)}` : ''}`;
  const ok = plan?.items.filter((i) => i.ok).length ?? 0;
  const ko = plan?.items.filter((i) => i.ok === false).length ?? 0;
  const docLink = (i: TransferItem) => i.docId && <Link href={`/documents/${encodeURIComponent(i.docId)}`} className="link-plain tabnum nowrap">{i.docId}</Link>;
  const what = (i: TransferItem) => {
    switch (i.kind) {
      case 'modifier': return <>{docLink(i)} · {tr('Revision')} {i.letter} <span className="text-muted">· {i.title}</span></>;
      case 'step': return <>{docLink(i)}{i.letter ? ` · ${tr('Revision')} ${i.letter}` : ''} · {i.workflowId} · {loc(i.stepName, ctx.lang)} <span className="text-muted">· {i.title}</span></>;
      case 'holder': {
        const fn = ctx.functions.find((f) => f.key === i.functionKey);
        const scope = !i.scope ? tr('Group') : fn?.scope === 'department' ? `${i.scope} · ${ctx.label('department', i.scope)}` : fn?.scope === 'research' ? `${i.scope} · ${ctx.label('program', i.scope)}` : `${i.scope} · ${ctx.label('project', i.scope)}`;
        return <>{ctx.label('function', i.functionKey)} <span className="text-muted">· {scope}</span></>;
      }
      default: return <>{docLink(i)} <span className="text-muted">· {i.title}</span></>;
    }
  };
  const status = (i: TransferItem) => {
    if (i.ok == null) return <span className="text-muted">—</span>;
    if (i.ok) return <span className="tag tag-accent">{tr('Transferable')}</span>;
    return <><span className="tag tag-neutral">{tr('Not transferable')}</span> <span className="text-muted">{labelOf(tr, TRANSFER_REASON_LABEL, i.reason)}</span></>;
  };
  const note = (n: TransferNote) => (n.kind === 'vigie'
    ? tr('Author designated by Vigie for the accepted change {ref} ({doc}): to be changed in Vigie.').replace('{ref}', n.ref).replace('{doc}', n.docId ?? '')
    : (n.kind === 'project' ? tr('Manager of project {ref} · {label}: to be changed in Keystone.') : tr('Manager of programme {ref} · {label}: to be changed in Administration › Functions & workflows.')).replace('{ref}', n.ref).replace('{label}', n.label ?? ''));

  return (
    <div className={styles.transfer}>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, maxWidth: 880 }}>{tr('Choose the person who leaves and their replacement: the simulation shows what will be transferred, what cannot be and why. Confirming does exactly that transfer, in one journaled operation. No replacement is proposed by default, and the person’s account is not disabled (that depends on the authentication provider, not chosen yet).')}</p>
      <Form action="/administration" scroll={false} className={styles.auditFilters}>
        <input type="hidden" name="tab" value="transfer" />
        <label className={styles.auditDay}>
          <span className="text-muted">{tr('Person leaving')}</span>
          <select className="input" name="person" defaultValue={person} style={{ width: 'auto' }} required>
            <option value="">—</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.department ? `${u.name} · ${u.department}` : u.name}</option>)}
          </select>
        </label>
        <label className={styles.auditDay}>
          <span className="text-muted">{tr('Replacement')}</span>
          <select className="input" name="replacement" defaultValue={replacement} style={{ width: 'auto' }}>
            <option value="">—</option>
            {people.filter((u) => u.id !== person).map((u) => <option key={u.id} value={u.id}>{u.department ? `${u.name} · ${u.department}` : u.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">{tr('Simulate')}</button>
      </Form>

      {!person && <p className="text-muted">{tr('Choose the person who leaves.')}</p>}
      {person && !plan && <p className="form-error">{tr('Unknown person.')}</p>}
      {plan && plan.items.length === 0 && <p className="text-muted">{tr('This person holds nothing Codex can transfer.')}</p>}
      {plan && plan.items.length > 0 && (
        <>
          <div className={styles.transferHead}>
            {plan.to
              ? <span>{tr('{ok} transferable · {ko} not transferable').replace('{ok}', String(ok)).replace('{ko}', String(ko))}</span>
              : <span className="text-muted">{tr('Choose a replacement to simulate the transfer.')}</span>}
            {plan.to && ok > 0 && (
              <ActionButton
                action={transferHoldings.bind(null, plan.from, plan.to, plan.digest)}
                className="btn btn-primary"
                confirm={tr('Transfer {n} item(s) from {from} to {to}? Each item transferred is journaled.').replace('{n}', String(ok)).replace('{from}', ctx.userName(plan.from)).replace('{to}', ctx.userName(plan.to))}
                after={here}
              >
                {tr('Confirm the transfer ({n})').replace('{n}', String(ok))}
              </ActionButton>
            )}
          </div>
          {TRANSFER_KINDS.map((k) => {
            const rows = plan.items.filter((i) => i.kind === k);
            if (!rows.length) return null;
            return (
              <section key={k} aria-label={labelOf(tr, TRANSFER_KIND_LABEL, k)}>
                <h2 className="sec-title" style={{ marginBottom: 8 }}>{labelOf(tr, TRANSFER_KIND_LABEL, k)} <span className="text-muted tabnum">({rows.length})</span></h2>
                <table className={`table ${styles.transferTable}`}>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.ref}>
                        <td>{what(i)}</td>
                        <td className={styles.transferStatus}>{status(i)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </>
      )}
      {plan && plan.notes.length > 0 && (
        <section aria-label={tr('Outside this transfer')}>
          <h2 className="sec-title" style={{ marginBottom: 8 }}>{tr('Outside this transfer')}</h2>
          <ul className={styles.transferNotes}>{plan.notes.map((n) => <li key={`${n.kind}:${n.ref}`}>{note(n)}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
