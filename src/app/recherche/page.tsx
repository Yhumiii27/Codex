import Link from 'next/link';
import { ActionButton, ActionLink, DialogButton } from '@/components/ui/client';
import { FilterBar, FilterNote } from '@norma/charte/ds/FilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { msg } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { Pager } from '@/components/ui/Pager';
import { deleteSavedSearch } from '@/lib/actions';
import { mayShareSearches } from '@/lib/access';
import { getCtx } from '@/lib/context';
import { fmtDate } from '@/lib/format';
import { facetValueL, listSavedSearches, searchCriteriaL, searchDocs, sortL } from '@/lib/queries';
import { DATE_FIELDS, DATE_LABEL, dueOf, FACET_KEYS, FACET_LABEL, hasCriteria, OVERDUE_KEYS, pageOf, parseSearch, searchHref, SORT_KEYS, sortOf, type FacetKey, type Facets } from '@/lib/search';
import { ATTACHMENTS, CONF_LEVELS, ORIGINS, STATUS_KEYS } from '@/lib/i18n';
import { FacetCheck, PeriodFilter, SearchField, SortSelect } from './SearchClient';
import styles from './search.module.css';
import { screenTitle } from '@/lib/titles';

/** Options shown in a facet before « N de plus ». */
const SHOWN = 8;

export function generateMetadata() {
  return screenTitle(msg('Search'));
}

export default async function SearchPage({ searchParams }: PageProps<'/recherche'>) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const { tr } = ctx;
  const search = parseSearch(sp);
  const { q, facets, period } = search;
  // The database filters, counts and sorts the documents the user may see; only the page shown is read whole.
  const [{ results, total, page, pages, tally }, saved] = await Promise.all([searchDocs(ctx, search, { page: pageOf(sp.page) }), listSavedSearches(ctx)]);

  const toggled = (k: FacetKey, v: string): Facets => {
    const cur = facets[k] ?? [];
    return { ...facets, [k]: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] };
  };
  const ref = (k: FacetKey, keys: readonly string[]) => keys.map((key) => ({ key, label: facetValueL(ctx, k, key) }));
  // Values found in the documents (and those chosen), by label, or by number of documents for the keywords.
  const found = (k: FacetKey, byCount = false) => {
    const n = tally(k);
    return [...new Set([...n.keys(), ...(facets[k] ?? [])])]
      .map((key) => ({ key, label: facetValueL(ctx, k, key) }))
      .sort((a, b) => (byCount ? (n.get(b.key) ?? 0) - (n.get(a.key) ?? 0) : 0) || a.label.localeCompare(b.label, ctx.lang));
  };
  // Options of each facet: reference order (registry, organisation, lifecycle), or values found in the documents.
  const options: Record<FacetKey, { key: string; label: string }[]> = {
    project: ref('project', [...ctx.projects, ...ctx.programs].map((p) => p.code)),
    family: ref('family', ctx.families.map((f) => f.key)),
    type: ref('type', ctx.types.map((ty) => ty.code)),
    subtype: found('subtype'),
    origin: ref('origin', ORIGINS),
    attachment: ref('attachment', ATTACHMENTS),
    department: ref('department', ctx.departments.map((d) => d.code)),
    site: ref('site', ctx.sites.map((x) => x.key)),
    owner: found('owner'),
    author: found('author'),
    status: ref('status', STATUS_KEYS),
    overdue: ref('overdue', OVERDUE_KEYS),
    conf: ref('conf', CONF_LEVELS),
    lang: found('lang'),
    keywords: found('keywords', true),
    source: found('source'),
    phase: found('phase'),
    lot: found('lot'),
    discipline: found('discipline'),
    theme: found('theme'),
  };
  const groups = FACET_KEYS.map((k) => {
    const opts = options[k].map((o) => ({ ...o, count: tally(k).get(o.key) ?? 0, checked: !!facets[k]?.includes(o.key) })).filter((o) => o.count || o.checked);
    // Chosen values always show; the others beyond SHOWN fold away (unless only one would).
    const fold = opts.length > SHOWN + 1;
    return {
      key: k, label: tr(FACET_LABEL[k]),
      shown: fold ? opts.filter((o, i) => i < SHOWN || o.checked) : opts,
      more: fold ? opts.filter((o, i) => i >= SHOWN && !o.checked) : [],
    };
  }).filter((g) => g.shown.length);
  const hasActive = hasCriteria(search);
  const sort = sortOf(search);
  // Date at the end of each result: the one the results are sorted by, the modification date otherwise.
  const dateShown = sort === 'issued' ? { label: tr('Issue date'), of: (d: (typeof results)[number]) => d.issuedF }
    : sort === 'due' ? { label: tr('Next due date'), of: (d: (typeof results)[number]) => fmtDate(dueOf(d), ctx.lang) }
    : { label: tr('Modification date'), of: (d: (typeof results)[number]) => d.modifiedF };
  const check = (k: FacetKey, o: { key: string; label: string; count: number; checked: boolean }) => (
    <FacetCheck key={o.key} href={searchHref({ ...search, facets: toggled(k, o.key) })} checked={o.checked} label={o.label} count={o.count} />
  );

  return (
    <>
      <PageHeader
        title={tr('Advanced search')}
        actions={<>
          {hasActive && ctx.can('read') && (
            <DialogButton spec={{ kind: 'saveSearch', search, criteria: searchCriteriaL(ctx, search), mayShare: mayShareSearches(ctx) }} icon="bookmark">{tr('Save search')}</DialogButton>
          )}
          <ActionLink native href={searchHref(search, '/api/export/search')} icon="download">{tr('Export list')}</ActionLink>
        </>}
        toolbar={
          <FilterBar>
            <SortSelect value={sort} options={SORT_KEYS.map((k) => ({ key: k, label: sortL(ctx, k) }))} />
            <FilterNote>{total} {total === 1 ? tr('result') : tr('results')}</FilterNote>
          </FilterBar>
        }
      />
    <div className="screen panes" data-screen-label="Recherche">
      <aside className={styles.side}>
        <section>
          <h2 className="sec-title" style={{ marginBottom: 8 }}>{tr('Saved searches')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {saved.length === 0 && <p className="text-muted" style={{ margin: 0, padding: '6px 8px', fontSize: 12.5 }}>{tr('No saved search.')}</p>}
            {saved.map((x) => (
              <div key={x.id} className={styles.savedRow}>
                <Link href={x.href} className={styles.saved} title={x.title}>
                  <Icon name="bookmark" size={14} className={x.scope === 'personal' ? 'text-muted' : undefined} style={{ flex: 'none', color: x.scope === 'personal' ? undefined : 'var(--color-accent)' }} />
                  <span className={styles.savedLabel}>{x.labelL}</span>
                  {x.scope !== 'group' && <span className={`text-muted ${styles.scope}`}>{x.scope === 'personal' ? tr('Mine') : x.department}</span>}
                </Link>
                {x.mayDelete && (
                  <ActionButton className={styles.remove} ariaLabel={`${tr('Delete search')} · ${x.labelL}`} title={tr('Delete search')} confirm={`${tr('Delete this saved search?')}\n${x.labelL}`} action={deleteSavedSearch.bind(null, x.id)}>
                    <Icon name="close" size={12} sw={2} />
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
        </section>
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 className="sec-title">{tr('Filters')}</h2>
            {hasActive && <Link href={searchHref({ sort: search.sort })} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }}>{tr('Clear')}</Link>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>{g.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {g.shown.map((o) => check(g.key, o))}
                  {g.more.length > 0 && (
                    <details className={styles.more}>
                      <summary>{g.more.length} {tr('more')}</summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{g.more.map((o) => check(g.key, o))}</div>
                    </details>
                  )}
                </div>
              </div>
            ))}
            <PeriodFilter
              field={period?.field ?? 'modified'} from={period?.from ?? ''} to={period?.to ?? ''}
              fields={DATE_FIELDS.map((k) => ({ key: k, label: tr(DATE_LABEL[k]) }))}
            />
          </div>
        </section>
      </aside>
      <section className={styles.main}>
        <div className={styles.fieldRow}>
          <SearchField q={q} />
        </div>
        {/* A page opens at its top: the list is mounted again for each page. */}
        <div key={page} className={styles.results}>
          {total === 0 && <p className="text-muted" style={{ padding: '20px 8px' }}>{tr('No document matches these criteria.')}</p>}
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
                      {d.expired && <span className="tag tag-outline">{tr('Expired#indicator')}</span>}
                      {d.reviewOverdue && <span className="tag tag-outline">{tr('Review overdue')}</span>}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{d.id} · {d.typeLabel} · {tr('Rev.')} {d.rev} · {d.path}</div>
                  </div>
                  <div className="text-muted nowrap" style={{ fontSize: 12, flex: 'none' }} title={dateShown.label}>{dateShown.of(d)}</div>
                </Link>
              );
            })}
          </div>
          {pages > 1 && <div className={styles.pager}><Pager tr={tr} page={page} pages={pages} href={(n) => searchHref(search, '/recherche', n)} /></div>}
        </div>
      </section>
    </div>
    </>
  );
}
