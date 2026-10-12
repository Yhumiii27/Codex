import Form from 'next/form';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { removeFunctionHolder, togglePermission } from '@/lib/actions';
import { getCtx, type Ctx } from '@/lib/context';
import { featuredOf } from '@/lib/departments';
import { ENFORCED_PERMS, MATRIX_ROLE, MATRIX_ROLE_LABEL, MATRIX_ROLES, PERMS, SIMULATED_MATRIX_ROLES, type TKey } from '@/lib/i18n';
import { AUDIT_ID_MAX, auditPage, getMatrix, listDocs, listFunctionHolders, listTemplates, typeView, type AuditFilter } from '@/lib/queries';
import { parseIsoDay } from '@/lib/format';
import { FACET_LABEL, oneEach } from '@/lib/search';
import { AddValue } from './AddValue';
import { FamilyFilter } from './FamilyFilter';
import { countBy, typeSpec } from './shared';
import styles from './admin.module.css';

const TABS = ['registry', 'functions', 'roles', 'org', 'templates', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, TKey> = { registry: 'registry', functions: 'functions_tab', roles: 'ad_roles', org: 'organisation', templates: 'templates_qms', audit: 'ad_audit' };

const sub = { fontSize: 11 } as const;

export default async function AdminPage({ searchParams }: PageProps<'/administration'>) {
  // One value per parameter: a repeated one (?doc=a&doc=b) keeps its first.
  const sp = oneEach(await searchParams);
  const ctx = await getCtx();
  const { t, lang } = ctx;
  if (!ctx.screens.admin) return <Forbidden text={t.forbidden} back={t.back_home} />;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'registry';
  const family = ctx.families.some((f) => f.key === sp.family) ? sp.family! : '';
  const typesByFamily = countBy(ctx.types, (x) => x.family);

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Administration">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px 10px', flexWrap: 'wrap' }}>
        <Seg
          name="adminTab"
          value={tab}
          style={{ flex: 'none' }}
          optStyle={{ padding: '6px 12px', fontSize: 12.5 }}
          options={TABS.map((k) => ({ key: k, label: t[TAB_LABEL[k]], href: `/administration${k === 'registry' ? '' : `?tab=${k}`}` }))}
        />
        <span style={{ flex: 1 }} />
        {tab === 'registry' && (
          <>
            <span className="text-muted" style={{ fontSize: 12 }}>{family ? typesByFamily.get(family) ?? 0 : ctx.types.length} {t.types_count}</span>
            <FamilyFilter
              value={family}
              ariaLabel={t.family}
              allLabel={t.all_families}
              options={ctx.families.filter((f) => typesByFamily.has(f.key)).map((f) => ({ key: f.key, label: lang === 'fr' ? f.labelFr : f.labelEn, count: typesByFamily.get(f.key)! }))}
            />
          </>
        )}
        {tab === 'org' && (
          <>
            <AddValue what="site" label={t.new_site} />
            <AddValue what="department" label={t.new_department} primary />
          </>
        )}
        {tab === 'templates' && <DialogButton spec={{ kind: 'new', preset: { typeCode: 'FRM' } }} className="btn btn-primary" icon="plus" iconSw={1.8}>{t.new_template}</DialogButton>}
        {tab === 'audit' && <a href="/api/export/audit" className="btn btn-secondary"><Icon name="download" size={14} />{t.export_csv}</a>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 24px 24px' }}>
        {tab === 'registry' && <Registry ctx={ctx} family={family} />}
        {tab === 'functions' && <Functions ctx={ctx} />}
        {tab === 'roles' && <Roles ctx={ctx} />}
        {tab === 'org' && <Organisation ctx={ctx} />}
        {tab === 'templates' && <Templates ctx={ctx} />}
        {tab === 'audit' && <Audit ctx={ctx} sp={sp} />}
      </div>
    </div>
  );
}

/** Register of document types (owned by Codex, read by Keystone): one row per type, edited in the 'type' dialog. */
async function Registry({ ctx, family }: { ctx: Ctx; family: string }) {
  const { t, lang } = ctx;
  // Counts cover every document, drafts and confidential ones included (administration only).
  const counts = countBy(await listDocs(ctx, { includeHidden: true }), (d) => d.typeCode);
  const types = ctx.types.filter((x) => !family || x.family === family).map((x) => typeView(ctx, x));
  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead>
        <tr>
          <th>{t.rule_id}</th><th>{t.type}</th><th>{t.family}</th><th>{t.origin}</th><th>{t.attachment}</th><th>{t.circuit}</th>
          <th>{t.conf}</th><th>{t.retention}</th><th title={t.review_months}>{t.review_short}</th><th>ISO</th><th style={{ textAlign: 'right' }}>{t.count}</th><th />
        </tr>
      </thead>
      <tbody>
        {types.map((x) => (
          <tr key={x.code} style={x.active ? undefined : { opacity: 0.55 }}>
            <td className="nowrap" style={{ verticalAlign: 'top' }}>{x.code}</td>
            <td style={{ minWidth: 180 }}>
              <div>{x.label}</div>
              {x.subtypesL.length > 0 && <div className="text-muted" style={sub}>{x.subtypesL.join(' · ')}</div>}
              {(x.clientDeliverable || !x.active) && <div className="text-muted" style={sub}>{[x.clientDeliverable && t.client_deliverable, !x.active && t.inactive].filter(Boolean).join(' · ')}</div>}
            </td>
            <td className="text-muted">{x.familyLabel}</td>
            <td className="text-muted">{x.origins.map((o) => t[`or_${o}`]).join(', ')}</td>
            <td className="text-muted">{x.attachments.map((a) => t[`att_${a}`]).join(', ')}</td>
            <td className="text-muted" style={{ minWidth: 160 }}>{x.circuitL}</td>
            <td><div>{x.confDefaultL}</div><div className="text-muted" style={sub}>{x.confL}</div></td>
            <td className="text-muted" style={{ minWidth: 150 }} title={x.retentionBasis || undefined}>{x.retentionL}</td>
            <td className="text-muted nowrap">{x.reviewL}</td>
            <td className="text-muted">{x.iso ?? '—'}</td>
            <td className="tabnum" style={{ textAlign: 'right' }}>{counts.get(x.code) ?? 0}</td>
            <td style={{ textAlign: 'right', width: 44 }}>
              <DialogButton spec={typeSpec(x, lang)} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${x.code}`} style={{ width: 30, height: 30 }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Functions that approval circuits are made of, their holders, and the circuits of the register. */
async function Functions({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const fns = await listFunctionHolders(ctx);
  const scopeTitle = (scope: string, v: string) => (scope === 'department' ? ctx.label('department', v) : scope === 'project' ? ctx.label('project', v) : scope === 'research' ? ctx.label('program', v) : v);
  // Distinct circuits of the register, with the types that follow each one.
  const circuits = new Map<string, { circuitL: string; codes: string[] }>();
  for (const x of ctx.types) {
    const key = x.circuit.join('>');
    if (!circuits.has(key)) circuits.set(key, { circuitL: typeView(ctx, x).circuitL, codes: [] });
    circuits.get(key)!.codes.push(x.code);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{t.function_label}</th><th>{t.scope}</th><th>{t.holders}</th><th style={{ textAlign: 'right' }}>{t.types_covered}</th><th /></tr></thead>
        <tbody>
          {fns.map((f) => (
            <tr key={f.key}>
              <td className="nowrap" style={{ verticalAlign: 'top' }}>{f.label}</td>
              <td className="text-muted nowrap" style={{ verticalAlign: 'top' }}>{t[`scope_${f.scope}`]}</td>
              <td>
                <div className={styles.holders}>
                  {f.holders.length === 0 && <span className="text-muted">—</span>}
                  {f.holders.map((h) => (
                    <span key={h.id} className={`tag tag-neutral ${styles.holder}`} title={h.scopeValue ? scopeTitle(f.scope, h.scopeValue) : undefined}>
                      {h.user}
                      {f.scope !== 'global' && <span style={{ opacity: 0.6 }}>· {h.scopeL}</span>}
                      <ActionButton className={styles.remove} ariaLabel={`${t.remove} · ${h.user}`} title={t.remove} action={removeFunctionHolder.bind(null, h.id)}>
                        <Icon name="close" size={11} sw={2} />
                      </ActionButton>
                    </span>
                  ))}
                </div>
              </td>
              <td className="tabnum" style={{ textAlign: 'right', verticalAlign: 'top' }}>{ctx.types.filter((x) => x.circuit.includes(f.key)).length}</td>
              <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                <DialogButton spec={{ kind: 'holder', functionKey: f.key, functionLabel: f.label, scope: f.scope }} className="btn btn-ghost nowrap" icon="plus" iconSw={1.8} style={{ fontSize: 12 }}>
                  {t.add_holder}
                </DialogButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section>
        <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.circuit}</h6>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>{t.circuit_steps}</th><th>{t.types_covered}</th><th style={{ textAlign: 'right' }}>{t.count}</th></tr></thead>
          <tbody>
            {[...circuits].sort(([, a], [, b]) => b.codes.length - a.codes.length).map(([key, c]) => (
              <tr key={key || 'none'}>
                <td style={{ minWidth: 240 }}>{c.circuitL}</td>
                <td className="text-muted">{c.codes.join(', ')}</td>
                <td className="tabnum" style={{ textAlign: 'right' }}>{c.codes.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/**
 * Permission matrix. Only cells that change something can be toggled: a row read by a simulated role and a permission
 * Codex checks. The administration cell of one's own role stays granted (no locking oneself out).
 */
async function Roles({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const matrix = await getMatrix();
  const own = MATRIX_ROLE[ctx.role];
  return (
    <>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 4px' }}>{t.matrix_hint}</p>
      <p className="text-muted" style={{ fontSize: 11, margin: '0 0 10px' }}>{t.matrix_not_enforced}</p>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{t.role}</th>{PERMS.map((p) => <th key={p} style={{ textAlign: 'center' }}>{t[`perm_${p}`]}</th>)}</tr></thead>
        <tbody>
          {MATRIX_ROLES.map((r) => (
            <tr key={r}>
              <td className="nowrap">{t[MATRIX_ROLE_LABEL[r]]}</td>
              {PERMS.map((p) => {
                const on = !!matrix.get(`${r}:${p}`);
                const label = `${t[MATRIX_ROLE_LABEL[r]]} · ${t[`perm_${p}`]}`;
                const color = on ? 'var(--color-accent)' : 'var(--color-neutral-700)';
                const fixed = !SIMULATED_MATRIX_ROLES.includes(r) || !ENFORCED_PERMS.includes(p) ? t.not_enforced : p === 'admin' && r === own ? t.admin_lockout : null;
                return (
                  <td key={p} style={{ textAlign: 'center' }}>
                    {fixed
                      ? <span className={styles.cellFixed} role="img" aria-label={`${label} : ${fixed}`} title={fixed} style={{ color }}><Icon name={on ? 'tick' : 'dash'} sw={2} /></span>
                      : <ActionButton className={styles.cell} style={{ color }} ariaLabel={label} action={togglePermission.bind(null, r, p)}><Icon name={on ? 'tick' : 'dash'} sw={2} /></ActionButton>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Departments (3-letter code used in document IDs) and sites — provisional until the organisation chart. Each department
 * has the facets its page puts forward (/departements/[code]): the default ones until it has its own.
 */
async function Organisation({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const [docs, fns] = await Promise.all([listDocs(ctx, { includeHidden: true }), listFunctionHolders(ctx)]);
  const byDept = countBy(docs, (d) => d.department);
  const bySite = countBy(docs, (d) => d.site);
  const people = [...ctx.users.values()].filter((u) => !u.isSystem);
  const peopleByDept = countBy(people, (u) => u.department);
  const peopleBySite = countBy(people, (u) => u.site);
  const heads = fns.find((f) => f.key === 'resp_departement')?.holders ?? [];
  return (
    <>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" size={14} style={{ flex: 'none', marginTop: 1 }} />{t.org_provisional}
      </p>
      <div className={styles.split}>
        <section>
          <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.department}</h6>
          {/* The table scrolls within its column rather than spilling over the sites beside it. */}
          <div className={styles.tableScroll}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t.rule_id}</th><th>{t.label_fr}</th><th>{t.label_en}</th><th>{t.manager}</th><th style={{ textAlign: 'right' }}>{t.people}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th>{t.featured_filters}</th></tr></thead>
              <tbody>
                {ctx.departments.map((d) => {
                  const featured = featuredOf(d);
                  const label = ctx.label('department', d.code);
                  return (
                    <tr key={d.code}>
                      <td className="nowrap tabnum"><Link href={`/departements/${encodeURIComponent(d.code)}`} className="link-plain">{d.code}</Link></td>
                      <td>{d.labelFr}</td>
                      <td className="text-muted">{d.labelEn}</td>
                      <td className="text-muted">{heads.filter((h) => h.scopeValue === d.code).map((h) => h.user).join(', ') || '—'}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{peopleByDept.get(d.code) ?? 0}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{byDept.get(d.code) ?? 0}</td>
                      {/* The default facets are named on hover only: every department follows them until it has its own. */}
                      <td style={{ paddingTop: 0, paddingBottom: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <span className={`ellipsis${d.featured == null ? ' text-muted' : ''}`} style={{ maxWidth: 180 }} title={featured.map((k) => t[FACET_LABEL[k]]).join(', ') || t.featured_none}>
                            {d.featured == null ? t.featured_default : featured.map((k) => t[FACET_LABEL[k]]).join(', ') || t.featured_none}
                          </span>
                          <DialogButton
                            spec={{ kind: 'featured', department: { code: d.code, label }, featured, isDefault: d.featured == null }}
                            className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.featured_filters} · ${d.code}`} style={{ width: 28, height: 28, flex: 'none' }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.site_label}</h6>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.site_label}</th><th style={{ textAlign: 'right' }}>{t.people}</th><th style={{ textAlign: 'right' }}>{t.count}</th></tr></thead>
            <tbody>
              {ctx.sites.map((s) => (
                <tr key={s.key}>
                  <td><div>{s.label}</div><div className="text-muted" style={sub}>{s.key}</div></td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{peopleBySite.get(s.key) ?? 0}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{bySite.get(s.key) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

/** Templates (FRM-QMS-…) in force: the source of "Nouveau depuis un modèle". */
async function Templates({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const tpls = await listTemplates(ctx);
  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead><tr><th>{t.ref}</th><th>{t.title_label}</th><th>{t.revision}</th><th>{t.owner}</th><th>{t.department}</th><th /></tr></thead>
      <tbody>
        {tpls.map((x) => {
          const href = `/documents/${encodeURIComponent(x.id)}`;
          return (
            <tr key={x.id}>
              <td className="nowrap"><Link href={href} className="link-plain">{x.id}</Link></td>
              <td>{x.label}</td>
              <td className="text-muted">{x.rev}</td>
              <td>{x.owner}</td>
              <td className="text-muted">{ctx.label('department', x.department)}</td>
              <td style={{ textAlign: 'right' }}><Link href={href} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.open_record}</Link></td>
            </tr>
          );
        })}
        {tpls.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
      </tbody>
    </table>
  );
}

/**
 * Journal tab: the entries the user may read, newest first, filtered and paged by the database (lib/queries.ts
 * auditPage), the filters and the page in the URL; the CSV export above it gives the whole journal.
 */
async function Audit({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const { t, lang } = ctx;
  const day = (v?: string) => (v && parseIsoDay(v) === v ? v : undefined);
  // An entry of the journal: its ID, a serial of the database (int4).
  const entry = (v?: string) => (v && /^\d{1,10}$/.test(v) && Number(v) <= AUDIT_ID_MAX ? Number(v) : undefined);
  const f: AuditFilter = { who: sp.who || undefined, action: sp.act || undefined, doc: sp.doc?.trim() || undefined, from: day(sp.from), to: day(sp.to) };
  const at = { before: entry(sp.before), after: entry(sp.after) };
  const { rows, older, newer } = await auditPage(ctx, f, at);
  const filtered = Object.values(f).some(Boolean);
  const href = (cursor: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ tab: 'audit', who: f.who, act: f.action, doc: f.doc, from: f.from, to: f.to, ...cursor }).filter((e): e is [string, string] => !!e[1]));
    return `/administration?${p}`;
  };
  const people = [...ctx.users.values()].sort((a, b) => a.name.localeCompare(b.name, lang));
  const actions = (Object.keys(t) as string[]).filter((k) => k.startsWith('act_')).map((k) => ({ key: k.slice(4), label: t[k as TKey] })).sort((a, b) => a.label.localeCompare(b.label, lang));
  const step = { fontSize: 12, padding: '4px 10px' };
  return (
    <>
      {/* Mounted again when the URL changes its filters (Effacer, a link), so that the fields show them. */}
      <div key={JSON.stringify(f)}>
        <Form action="/administration" scroll={false} className={styles.auditFilters}>
          <input type="hidden" name="tab" value="audit" />
          <input className="input" name="doc" defaultValue={f.doc ?? ''} placeholder={t.audit_filter_doc} aria-label={t.audit_filter_doc} style={{ width: 200 }} />
          <select className="input" name="who" defaultValue={f.who ?? ''} aria-label={t.user} style={{ width: 'auto' }}>
            <option value="">{t.audit_all_users}</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="input" name="act" defaultValue={f.action ?? ''} aria-label={t.action} style={{ width: 'auto' }}>
            <option value="">{t.audit_all_actions}</option>
            {actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <label className={styles.auditDay}><span className="text-muted">{t.audit_from}</span><input className="input" type="date" name="from" defaultValue={f.from ?? ''} max={f.to} /></label>
          <label className={styles.auditDay}><span className="text-muted">{t.audit_to}</span><input className="input" type="date" name="to" defaultValue={f.to ?? ''} min={f.from} /></label>
          <button type="submit" className="btn btn-secondary" style={step}>{t.apply}</button>
          {filtered && <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }}>{t.clear}</Link>}
        </Form>
      </div>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{t.when}</th><th>{t.user}</th><th>{t.action}</th><th>{t.target}</th><th>{t.detail}</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="text-muted nowrap tabnum">{a.when}</td>
              <td>{a.user}</td>
              <td>{a.actionLabel}</td>
              {/* The ID the entry was written under; the link opens the document under its current one. */}
              <td className={a.docId ? 'nowrap' : undefined}><Link href={a.href} className="link-plain" title={a.currentId !== a.docId ? a.currentId ?? undefined : undefined}>{a.ref}</Link></td>
              <td className="text-muted">{a.detail}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ padding: '16px 8px' }}>{t.audit_none}</td></tr>}
        </tbody>
      </table>
      {(newer != null || older != null || at.before != null || at.after != null) && (
        <nav aria-label={t.pages_nav} className={styles.auditPager}>
          {(at.before != null || at.after != null) && <Link href={href({})} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.audit_latest}</Link>}
          <span style={{ flex: 1 }} />
          {newer != null
            ? <Link href={href({ after: String(newer) })} rel="prev" className="btn btn-secondary" style={step}><Icon name="chevronLeft" size={14} />{t.audit_newer}</Link>
            : <span className="btn btn-secondary" style={{ ...step, opacity: 0.45, cursor: 'default' }} aria-disabled="true"><Icon name="chevronLeft" size={14} />{t.audit_newer}</span>}
          {older != null
            ? <Link href={href({ before: String(older) })} rel="next" className="btn btn-secondary" style={step}>{t.audit_older}<Icon name="chevronRight" size={14} /></Link>
            : <span className="btn btn-secondary" style={{ ...step, opacity: 0.45, cursor: 'default' }} aria-disabled="true">{t.audit_older}<Icon name="chevronRight" size={14} /></span>}
        </nav>
      )}
    </>
  );
}
