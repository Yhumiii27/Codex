import { ActionButton, DialogButton } from '@/components/ui/client';
import { addVocabTerm, adoptSubtype } from '@/lib/actions';
import type { Ctx } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { vocabOverview, type VocabRow } from '@/lib/queries';
import type { VocabKind } from '@/lib/vocab-rules';
import styles from './admin.module.css';

/**
 * Administration › Vocabulaires (point 59 of docs/reste-a-faire.md): the terms of the source organisations and of the
 * keywords, with the documents that carry them (drafts and confidential ones included: administration only), their
 * other spellings; adding, renaming, merging a duplicate; the values documents carry without a term; the sub-types
 * documents carry outside their type's list, which an administrator may add to it (the list stays open, MET-17).
 */
export async function Vocabularies({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  const o = await vocabOverview(ctx);
  const one = (kind: VocabKind, title: string) => {
    const { terms, unlisted } = o[kind];
    const others = (x: VocabRow) => terms.filter((y) => y.id !== x.id).map((y) => ({ id: y.id, name: y.name }));
    return (
      <section aria-label={title} className={styles.vocab}>
        <div className={styles.vocabHead}>
          <h2 className="sec-title" style={{ margin: 0 }}>{title} <span className="tabnum">({terms.length})</span></h2>
          <DialogButton spec={{ kind: 'vocabTerm', vocab: kind }} className="btn btn-secondary" icon="plus" iconSw={1.8}>{t.vocab_new}</DialogButton>
        </div>
        <div className={styles.tableScroll}>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.vocab_term}</th><th>{t.vocab_aliases}</th><th style={{ textAlign: 'right' }}>{t.vocab_uses}</th><th>{t.created}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
            <tbody>
              {terms.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="text-muted">{x.aliases.length ? x.aliases.join(' · ') : '—'}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{x.uses}</td>
                  <td className="text-muted nowrap">{fmtDate(x.createdAt, lang)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <DialogButton spec={{ kind: 'vocabTerm', vocab: kind, term: { id: x.id, name: x.name } }} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.vocab_rename} · ${x.name}`} style={{ width: 30, height: 30 }} />
                      {terms.length > 1 && (
                        <DialogButton spec={{ kind: 'vocabMerge', vocab: kind, from: { id: x.id, name: x.name }, others: others(x) }} className="btn btn-ghost nowrap" style={{ fontSize: 12 }} ariaLabel={`${t.vocab_merge} · ${x.name}`}>
                          {t.vocab_merge}
                        </DialogButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {terms.length === 0 && <tr><td colSpan={5} className="text-muted">{t.vocab_none}</td></tr>}
            </tbody>
          </table>
        </div>
        {unlisted.length > 0 && (
          <div className={styles.vocabUnlisted}>
            <span className="text-muted">{t.vocab_unlisted}</span>
            {unlisted.map((v) => (
              <span key={v.value} className={`tag tag-neutral ${styles.holder}`}>
                {v.value} <span className="tabnum" style={{ opacity: 0.7 }}>· {v.uses}</span>
                <ActionButton action={addVocabTerm.bind(null, kind, v.value)} className="btn btn-ghost" style={{ fontSize: 11.5, padding: '0 6px' }}>{t.vocab_add_value}</ActionButton>
              </span>
            ))}
          </div>
        )}
      </section>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, maxWidth: 880 }}>{t.vocab_intro}</p>
      <div className={styles.vocabSplit}>
        {one('source_org', t.vocab_source_orgs)}
        {one('keyword', t.vocab_keywords)}
      </div>
      <section aria-label={t.vocab_subtypes}>
        <h2 className="sec-title" style={{ marginBottom: 6 }}>{t.vocab_subtypes}</h2>
        <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>{t.vocab_subtypes_hint}</p>
        {o.subtypes.length === 0 ? <p className="text-muted" style={{ fontSize: 12.5 }}>{t.vocab_subtypes_none}</p> : (
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.type}</th><th>{t.subtype}</th><th style={{ textAlign: 'right' }}>{t.vocab_uses}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
            <tbody>
              {o.subtypes.map((x) => (
                <tr key={`${x.typeCode}:${x.value}`}>
                  <td className="nowrap">{x.typeCode} · <span className="text-muted">{ctx.label('type', x.typeCode)}</span></td>
                  <td>{x.value}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{x.uses}</td>
                  <td style={{ textAlign: 'right' }}>
                    <ActionButton action={adoptSubtype.bind(null, x.typeCode, x.value)} className="btn btn-ghost nowrap" style={{ fontSize: 12 }}>{t.subtype_adopt}</ActionButton>
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
