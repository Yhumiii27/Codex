import { ActionButton, DialogButton } from '@/components/ui/client';
import { addVocabTerm, adoptSubtype } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { vocabOverview, type VocabRow } from '@/lib/queries';
import type { VocabKind } from '@/lib/vocab-rules';
import styles from './admin.module.css';

/**
 * Administration › Vocabulaires (point 59 of docs/reste-a-faire.md): the terms of the source organisations and of the
 * keywords, with how many documents carry them (drafts and confidential ones included: records managers only,
 * lib/queries.ts vocabOverview; anyone else sees « — »), their other spellings; adding, renaming, merging a duplicate;
 * the values documents carry without a term; the sub-types documents carry outside their type's list, which an
 * administrator may add to it (the list stays open, MET-17).
 */
export async function Vocabularies({ ctx }: { ctx: Ctx }) {
  const { tr, lang } = ctx;
  const o = await vocabOverview(ctx);
  const one = (kind: VocabKind, title: string) => {
    const { terms, unlisted } = o[kind];
    const others = (x: VocabRow) => terms.filter((y) => y.id !== x.id).map((y) => ({ id: y.id, name: y.name }));
    return (
      <section aria-label={title} className={styles.vocab}>
        <div className={styles.vocabHead}>
          <h2 className="sec-title" style={{ margin: 0 }}>{title} <span className="tabnum">({terms.length})</span></h2>
          <DialogButton spec={{ kind: 'vocabTerm', vocab: kind }} className="btn btn-secondary" icon="plus" iconSw={1.8}>{tr('New term')}</DialogButton>
        </div>
        <div className={styles.tableScroll}>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{tr('Term')}</th><th>{tr('Other spellings')}</th><th style={{ textAlign: 'right' }} title={ctx.seesAll ? undefined : tr('Document counts are shown to records managers only (drafts and confidential documents included)')}>{tr('Documents')}</th><th>{tr('Created')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
            <tbody>
              {terms.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="text-muted">{x.aliases.length ? x.aliases.join(' · ') : '—'}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{x.uses ?? '—'}</td>
                  <td className="text-muted nowrap">{fmtDate(x.createdAt, lang)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <DialogButton spec={{ kind: 'vocabTerm', vocab: kind, term: { id: x.id, name: x.name } }} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Rename')} · ${x.name}`} style={{ width: 30, height: 30 }} />
                      {terms.length > 1 && (
                        <DialogButton spec={{ kind: 'vocabMerge', vocab: kind, from: { id: x.id, name: x.name }, others: others(x) }} className="btn btn-ghost nowrap" style={{ fontSize: 12 }} ariaLabel={`${tr('Merge')} · ${x.name}`}>
                          {tr('Merge')}
                        </DialogButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {terms.length === 0 && <tr><td colSpan={5} className="text-muted">{tr('No term.')}</td></tr>}
            </tbody>
          </table>
        </div>
        {unlisted.length > 0 && (
          <div className={styles.vocabUnlisted}>
            <span className="text-muted">{tr('Document values without a term')}</span>
            {unlisted.map((v) => (
              <span key={v.value} className={`tag tag-neutral ${styles.holder}`}>
                {v.value} {v.uses != null && <span className="tabnum" style={{ opacity: 0.7 }}>· {v.uses}</span>}
                <ActionButton action={addVocabTerm.bind(null, kind, v.value)} className="btn btn-ghost" style={{ fontSize: 11.5, padding: '0 6px' }}>{tr('Add to the vocabulary')}</ActionButton>
              </span>
            ))}
          </div>
        )}
      </section>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, maxWidth: 880 }}>{tr('Documents keep the term’s name. A term also answers to other spellings of the same name (case, accents, blanks) and to its aliases. Renaming or merging updates the documents, except those under legal hold, which keep their value: the former spelling stays an alias of the term.')}</p>
      <div className={styles.vocabSplit}>
        {one('source_org', tr('Source organisations'))}
        {one('keyword', tr('Keywords'))}
      </div>
      <section aria-label={tr('Sub-types outside their type’s list')}>
        <h2 className="sec-title" style={{ marginBottom: 6 }}>{tr('Sub-types outside their type’s list')}</h2>
        <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>{tr('Values entered on documents outside their type’s list. The list stays open (examples in the deck, MET-17): “Add to the type” enters it in the register.')}</p>
        {o.subtypes.length === 0 ? <p className="text-muted" style={{ fontSize: 12.5 }}>{tr('Every sub-type of the documents is in its type’s list.')}</p> : (
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{tr('Type')}</th><th>{tr('Sub-type')}</th><th style={{ textAlign: 'right' }} title={ctx.seesAll ? undefined : tr('Document counts are shown to records managers only (drafts and confidential documents included)')}>{tr('Documents')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
            <tbody>
              {o.subtypes.map((x) => (
                <tr key={`${x.typeCode}:${x.value}`}>
                  <td className="nowrap">{x.typeCode} · <span className="text-muted">{ctx.label('type', x.typeCode)}</span></td>
                  <td>{x.value}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{x.uses ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <ActionButton action={adoptSubtype.bind(null, x.typeCode, x.value)} className="btn btn-ghost nowrap" style={{ fontSize: 12 }}>{tr('Add to the type')}</ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
