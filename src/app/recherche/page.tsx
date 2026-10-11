import Link from 'next/link';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { Icon } from '@/components/ui/Icon';
import { deleteSavedSearch } from '@/lib/actions';
import { mayShareSearches } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { listDocs, listSavedSearches } from '@/lib/queries';
import { FACET_KEYS, hasCriteria, parseSearch, runSearch, searchHref, type FacetKey, type Facets } from '@/lib/search';
import { ATTACHMENTS, CONF_LEVELS, ORIGINS, STATUS_KEYS } from '@/lib/i18n';
import { FacetCheck, SearchField } from './SearchClient';
import styles from './search.module.css';

export default async function SearchPage({ searchParams }: PageProps<'/recherche'>) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const { t } = ctx;
  const { q, facets } = parseSearch(sp);
  const [docs, saved] = await Promise.all([listDocs(ctx), listSavedSearches(ctx)]);
  const { results, count } = runSearch(docs, q, facets);

  const toggled = (k: FacetKey, v: string): Facets => {
    const cur = facets[k] ?? [];
    return { ...facets, [k]: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] };
  };
  // Options of each facet, in reference order (registry, organisation, lifecycle).
  const options: Record<FacetKey, { key: string; label: string }[]> = {
    project: [...ctx.projects, ...ctx.programs].map((p) => ({ key: p.code, label: `${p.code} · ${p.name}` })),
    family: ctx.families.map((f) => ({ key: f.key, label: ctx.label('family', f.key) })),
    type: ctx.types.map((ty) => ({ key: ty.code, label: ctx.label('type', ty.code) })),
    origin: ORIGINS.map((k) => ({ key: k, label: t[`or_${k}`] })),
    attachment: ATTACHMENTS.map((k) => ({ key: k, label: t[`att_${k}`] })),
    department: ctx.departments.map((d) => ({ key: d.code, label: ctx.label('department', d.code) })),
    status: STATUS_KEYS.map((k) => ({ key: k, label: t[`st_${k}`] })),
    conf: CONF_LEVELS.map((k) => ({ key: k, label: t[`conf_${k}`] })),
  };
  const groupLabel: Record<FacetKey, string> = {
    project: t.project_program, family: t.family, type: t.doc_type, origin: t.origin, attachment: t.attachment,
    department: t.department, status: t.status, conf: t.conf,
  };
  const groups = FACET_KEYS.map((k) => ({
    key: k,
    label: groupLabel[k],
    opts: options[k].map((o) => ({ ...o, count: count(k, o.key), checked: !!facets[k]?.includes(o.key) })).filter((o) => o.count || o.checked),
  })).filter((g) => g.opts.length);
  const hasActive = hasCriteria(q, facets);
  // What « Enregistrer la recherche » will keep, as lines to read in its dialog.
  const colon = ctx.lang === 'fr' ? ' : ' : ': ';
  const criteria = [
    ...(q ? [ctx.lang === 'fr' ? `« ${q} »` : `“${q}”`] : []),
    ...FACET_KEYS.filter((k) => facets[k]?.length).map((k) => `${groupLabel[k]}${colon}${facets[k]!.map((v) => options[k].find((o) => o.key === v)?.label ?? v).join(', ')}`),
  ];

  return (
    <div className="screen" style={{ display: 'flex', minWidth: 0 }} data-screen-label="Recherche">
      <aside className={styles.side}>
        <section>
          <h6 className="sec-title" style={{ marginBottom: 8 }}>{t.saved}</h6>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {saved.length === 0 && <p className="text-muted" style={{ margin: 0, padding: '6px 8px', fontSize: 12.5 }}>{t.search_none}</p>}
            {saved.map((x) => (
              <div key={x.id} className={styles.savedRow}>
                <Link href={x.href} className={styles.saved} title={x.title}>
                  <Icon name="bookmark" size={14} className={x.scope === 'personal' ? 'text-muted' : undefined} style={{ flex: 'none', color: x.scope === 'personal' ? undefined : 'var(--color-accent)' }} />
                  <span className={styles.savedLabel}>{x.labelL}</span>
                  {x.scope !== 'group' && <span className={`text-muted ${styles.scope}`}>{x.scope === 'personal' ? t.search_mine : x.department}</span>}
                </Link>
                {x.mayDelete && (
                  <ActionButton className={styles.remove} ariaLabel={`${t.search_delete} · ${x.labelL}`} title={t.search_delete} confirm={`${t.search_delete_confirm}\n${x.labelL}`} action={deleteSavedSearch.bind(null, x.id)}>
                    <Icon name="close" size={12} sw={2} />
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
        </section>
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h6 className="sec-title">{t.filters}</h6>
            {hasActive && <Link href="/recherche" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }}>{t.clear}</Link>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>{g.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {g.opts.map((o) => <FacetCheck key={o.key} href={searchHref(q, toggled(g.key, o.key))} checked={o.checked} label={o.label} count={o.count} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
      <section className={styles.main}>
        <div style={{ padding: '18px 24px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SearchField q={q} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{results.length} {t.results}</span>
            <span style={{ flex: 1 }} />
            {hasActive && ctx.can('read') && (
              <DialogButton spec={{ kind: 'saveSearch', q, facets: facets as Record<string, string[]>, criteria, mayShare: mayShareSearches(ctx) }} style={{ fontSize: 12 }} icon="bookmark">{t.search_save}</DialogButton>
            )}
            <a href={searchHref(q, facets, '/api/export/search')} className="btn btn-secondary" style={{ fontSize: 12 }}><Icon name="download" size={14} />{t.export_list}</a>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
          {results.length === 0 && <p className="text-muted" style={{ padding: '20px 8px' }}>{t.no_results}</p>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {results.map((d) => {
              const code = d.attachedCode;
              return (
                <Link key={d.id} href={d.href} className={`hairline ${styles.result}`}>
                  <Icon name="doc" size={18} style={{ flex: 'none', opacity: 0.55, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14 }}>{d.title}</span>
                      {code && <span className="tag tag-accent">{code}</span>}
                      <span className={d.tagClass}>{d.statusLabel}</span>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{d.id} · {d.typeLabel} · {t.rev_short} {d.rev} · {d.path}</div>
                  </div>
                  <div className="text-muted nowrap" style={{ fontSize: 12, flex: 'none' }}>{d.modifiedF}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
