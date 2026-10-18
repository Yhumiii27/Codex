import Form from 'next/form';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { ActionButton, DialogButton } from '@/components/ui/client';
import { mayBackUp, mayCheckIntegrity, mayCleanStorage, mayExportAll, mayLinkTemplate, mayTransferHoldings } from '@/lib/access';
import { backUpData, checkFileIntegrity, purgeOrphanFiles, removeFunctionHolder, renameProvisionalFiles, togglePermission } from '@/lib/actions';
import { antivirusStatus } from '@/lib/antivirus';
import { backupList, backupSettings } from '@/lib/backup';
import { getCtx, type Ctx } from '@/lib/context';
import { featuredOf } from '@/lib/departments';
import { fileRules, fmtMax } from '@/lib/filetypes';
import { lockOf } from '@/lib/lifecycle';
import { ENFORCED_PERMS, MATRIX_ROLE, MATRIX_ROLE_LABEL, MATRIX_ROLES, PERMS, SIMULATED_MATRIX_ROLES, type TKey } from '@/lib/i18n';
import { AUDIT_ID_MAX, auditPage, getMatrix, integrityL, latestIntegrityCheck, listFunctionHolders, listTemplates, orgUsage, registryUsage, retentionByType, typeView, type AuditFilter, type RegistryUsage } from '@/lib/queries';
import { fmtDateTime, fmtSize, parisStamp, parseIsoDay } from '@/lib/format';
import { MAX_PER_RUN, orphanReport, type OrphanScan } from '@/lib/orphans';
import { provisionalReport, type ProvisionalScan } from '@/lib/provisional';
import { schedulerOverview, type TaskView } from '@/lib/scheduler';
import { inUse } from '@/lib/org-rules';
import { DEPARTMENT_HEAD_FUNCTION } from '@/lib/registry-rules';
import { FACET_LABEL, oneEach } from '@/lib/search';
import { AddValue } from './AddValue';
import { Transfer } from './Transfer';
import { Vocabularies } from './Vocabularies';
import { FamilyFilter } from './FamilyFilter';
import { countBy, typeSpec } from './shared';
import styles from './admin.module.css';
import { screenTitle } from '@/lib/titles';

const TABS = ['registry', 'functions', 'roles', 'org', 'vocab', 'transfer', 'templates', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, TKey> = { registry: 'registry', functions: 'functions_tab', roles: 'ad_roles', org: 'organisation', vocab: 'tab_vocab', transfer: 'tab_transfer', templates: 'templates_qms', audit: 'ad_audit' };

const sub = { fontSize: 11 } as const;

export function generateMetadata() {
  return screenTitle('nav_admin');
}

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
          // The handover is for records managers only (access.ts mayTransferHoldings): the tab is not shown to others.
          options={TABS.filter((k) => k !== 'transfer' || mayTransferHoldings(ctx)).map((k) => ({ key: k, label: t[TAB_LABEL[k]], href: `/administration${k === 'registry' ? '' : `?tab=${k}`}` }))}
        />
        <span style={{ flex: 1 }} />
        {tab === 'registry' && (
          // One group, so that once the line wraps the filter and the buttons stay together on the right.
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{family ? typesByFamily.get(family) ?? 0 : ctx.types.length} {t.types_count}</span>
            <FamilyFilter
              value={family}
              ariaLabel={t.family}
              allLabel={t.all_families}
              options={ctx.families.filter((f) => typesByFamily.has(f.key)).map((f) => ({ key: f.key, label: lang === 'fr' ? f.labelFr : f.labelEn, count: typesByFamily.get(f.key)! }))}
            />
            <DialogButton spec={{ kind: 'family' }} className="btn btn-secondary" icon="plus" iconSw={1.8}>{t.new_family}</DialogButton>
            <DialogButton spec={{ kind: 'type', family: family || undefined }} className="btn btn-primary" icon="plus" iconSw={1.8}>{t.new_type}</DialogButton>
          </div>
        )}
        {tab === 'functions' && <DialogButton spec={{ kind: 'function' }} className="btn btn-primary" icon="plus" iconSw={1.8}>{t.new_function}</DialogButton>}
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
        {tab === 'vocab' && <Vocabularies ctx={ctx} />}
        {tab === 'transfer' && <Transfer ctx={ctx} person={sp.person ?? ''} replacement={sp.replacement ?? ''} />}
        {tab === 'templates' && <Templates ctx={ctx} />}
        {tab === 'audit' && <Audit ctx={ctx} sp={sp} />}
      </div>
    </div>
  );
}

/**
 * Register of document types (owned by Codex, read by Keystone): one row per type, edited in the 'type' dialog, then
 * the families. An entry something refers to keeps its code and cannot be deleted (lib/queries.ts registryUsage).
 */
async function Registry({ ctx, family }: { ctx: Ctx; family: string }) {
  const { t, lang } = ctx;
  // Counts cover every document, drafts and confidential ones included (administration only).
  const [usage, retention] = await Promise.all([registryUsage(), retentionByType()]);
  const counts = usage.docs.types;
  const types = ctx.types.filter((x) => !family || x.family === family).map((x) => typeView(ctx, x));
  const typesByFamily = countBy(ctx.types, (x) => x.family);
  const docsByFamily = new Map<string, number>();
  for (const x of ctx.types) docsByFamily.set(x.family, (docsByFamily.get(x.family) ?? 0) + (counts.get(x.code) ?? 0));
  const families = ctx.families.filter((f) => !family || f.key === family);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <table className="table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>{t.rule_id}</th><th>{t.type}</th><th>{t.family}</th><th>{t.origin}</th><th>{t.attachment}</th><th>{t.circuit}</th>
            <th>{t.conf}</th><th>{t.retention}</th><th title={t.review_months}>{t.review_short}</th><th>ISO</th><th style={{ textAlign: 'right' }}>{t.count}</th><th><span className="sr-only">{t.col_actions}</span></th>
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
              <td className="text-muted" style={{ minWidth: 150 }} title={x.basisL || undefined}>{x.retentionL}</td>
              <td className="text-muted nowrap">{x.reviewL}</td>
              <td className="text-muted">{x.iso ?? '—'}</td>
              <td className="tabnum" style={{ textAlign: 'right' }}>{counts.get(x.code) ?? 0}</td>
              <td style={{ textAlign: 'right', width: 44 }}>
                <DialogButton spec={typeSpec(x, usage.types.has(x.code), retention.get(x.code))} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${x.code}`} style={{ width: 30, height: 30 }} />
              </td>
            </tr>
          ))}
          {types.length === 0 && <tr><td colSpan={12} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
        </tbody>
      </table>
      <section aria-label={t.families_title}>
        <h2 className="sec-title" style={{ marginBottom: 10 }}>{t.families_title}</h2>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>{t.family}</th><th>{t.key_label}</th><th>{t.family_group}</th><th style={{ textAlign: 'right' }}>{t.types_count}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
          <tbody>
            {families.map((f) => {
              const label = lang === 'fr' ? f.labelFr : f.labelEn;
              return (
                <tr key={f.key}>
                  <td><div>{label}</div>{lang === 'fr' ? <div className="text-muted" style={sub}>{f.labelEn}</div> : <div className="text-muted" style={sub}>{f.labelFr}</div>}</td>
                  <td className="text-muted tabnum">{f.key}</td>
                  <td className="text-muted nowrap">{t[`grp_${f.grp}` as TKey] ?? f.grp}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{typesByFamily.get(f.key) ?? 0}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{docsByFamily.get(f.key) ?? 0}</td>
                  <td style={{ textAlign: 'right', width: 44 }}>
                    <DialogButton
                      spec={{ kind: 'family', family: { key: f.key, labelFr: f.labelFr, labelEn: f.labelEn, grp: f.grp, used: usage.families.has(f.key) } }}
                      className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${label}`} style={{ width: 30, height: 30 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Functions that approval circuits are made of, their holders, and the circuits of the register. */
async function Functions({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const [fns, usage] = await Promise.all([listFunctionHolders(ctx), registryUsage()]);
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
        <thead><tr><th>{t.function_label}</th><th>{t.scope}</th><th>{t.holders}</th><th style={{ textAlign: 'right' }}>{t.types_covered}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
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
                      {f.scope !== 'global' && <span style={{ opacity: 0.7 }}>· {h.scopeL}</span>}
                      <ActionButton className={styles.remove} ariaLabel={`${t.remove} · ${h.user}`} title={t.remove} action={removeFunctionHolder.bind(null, h.id)}>
                        <Icon name="close" size={11} sw={2} />
                      </ActionButton>
                    </span>
                  ))}
                </div>
              </td>
              <td className="tabnum" style={{ textAlign: 'right', verticalAlign: 'top' }}>{ctx.types.filter((x) => x.circuit.includes(f.key)).length}</td>
              <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                  <DialogButton spec={{ kind: 'holder', functionKey: f.key, functionLabel: f.label, scope: f.scope }} className="btn btn-ghost nowrap" icon="plus" iconSw={1.8} style={{ fontSize: 12 }}>
                    {t.add_holder}
                  </DialogButton>
                  <DialogButton
                    spec={{ kind: 'function', fn: { key: f.key, labelFr: f.labelFr, labelEn: f.labelEn, scope: f.scope, used: usage.functions.has(f.key), held: f.holders.length > 0 } }}
                    className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${f.label}`} style={{ width: 30, height: 30 }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Programs ctx={ctx} usage={usage} />
      <section>
        <h2 className="sec-title" style={{ marginBottom: 10 }}>{t.circuit}</h2>
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
 * Research programmes (D-08, D-10): the context of their documents' IDs, and the scope of the functions « par
 * programme », whose holders are named above. A closed programme in use is made inactive rather than deleted.
 */
function Programs({ ctx, usage }: { ctx: Ctx; usage: RegistryUsage }) {
  const { t } = ctx;
  return (
    <section aria-label={t.programs_title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h2 className="sec-title" style={{ margin: 0 }}>{t.programs_title}</h2>
        <span style={{ flex: 1 }} />
        <DialogButton spec={{ kind: 'program' }} className="btn btn-secondary" icon="plus" iconSw={1.8} style={{ fontSize: 12 }}>{t.new_program}</DialogButton>
      </div>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{t.rule_id}</th><th>{t.program_name}</th><th>{t.manager}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
        <tbody>
          {ctx.programs.map((p) => (
            <tr key={p.code} style={p.active ? undefined : { opacity: 0.55 }}>
              <td className="nowrap tabnum">{p.code}</td>
              <td><div>{p.name}</div>{!p.active && <div className="text-muted" style={sub}>{t.inactive}</div>}</td>
              <td className="text-muted">{ctx.userName(p.managerId)}</td>
              <td className="tabnum" style={{ textAlign: 'right' }}>{usage.docs.programs.get(p.code) ?? 0}</td>
              <td style={{ textAlign: 'right', width: 44 }}>
                <DialogButton
                  spec={{ kind: 'program', program: { code: p.code, name: p.name, managerId: p.managerId, active: p.active, used: usage.programs.has(p.code) } }}
                  className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${p.code}`} style={{ width: 30, height: 30 }}
                />
              </td>
            </tr>
          ))}
          {ctx.programs.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
        </tbody>
      </table>
    </section>
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
 * Departments (3-letter code used in document IDs) and sites — provisional until the organisation chart (O-04). Each one
 * is renamed, made inactive or active again, or deleted while nothing refers to it (lib/queries.ts orgUsage), in the
 * 'org' dialog. Each department has the facets its page puts forward (/departements/[code]): the default ones until it
 * has its own.
 */
async function Organisation({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  // Counts cover every document, drafts and confidential ones included (administration only).
  const [usage, fns] = await Promise.all([orgUsage(), listFunctionHolders(ctx)]);
  const heads = fns.find((f) => f.key === DEPARTMENT_HEAD_FUNCTION)?.holders ?? [];
  const inactive = { opacity: 0.55 };
  return (
    <>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" size={14} style={{ flex: 'none', marginTop: 1 }} />{t.org_provisional}
      </p>
      <div className={styles.split}>
        <section>
          <h2 className="sec-title" style={{ marginBottom: 10 }}>{t.department}</h2>
          {/* The table scrolls within its column rather than spilling over the sites beside it. */}
          <div className={styles.tableScroll}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t.rule_id}</th><th>{t.label_fr}</th><th>{t.label_en}</th><th>{t.manager}</th><th style={{ textAlign: 'right' }}>{t.people}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th>{t.featured_filters}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
              <tbody>
                {ctx.departments.map((d) => {
                  const featured = featuredOf(d);
                  const label = ctx.label('department', d.code);
                  const used = usage.departments.get(d.code);
                  return (
                    <tr key={d.code} style={d.active ? undefined : inactive}>
                      <td className="nowrap tabnum"><Link href={`/departements/${encodeURIComponent(d.code)}`} className="link-plain">{d.code}</Link></td>
                      <td><div>{d.labelFr}</div>{!d.active && <div className="text-muted" style={sub}>{t.inactive}</div>}</td>
                      <td className="text-muted">{d.labelEn}</td>
                      <td className="text-muted">{heads.filter((h) => h.scopeValue === d.code).map((h) => h.user).join(', ') || '—'}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{used?.people ?? 0}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{used?.documents ?? 0}</td>
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
                      <td style={{ textAlign: 'right', width: 44 }}>
                        <DialogButton
                          spec={{ kind: 'org', what: 'department', value: { id: d.code, labelFr: d.labelFr, labelEn: d.labelEn, active: d.active, used: inUse(used) } }}
                          className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${d.code}`} style={{ width: 30, height: 30 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2 className="sec-title" style={{ marginBottom: 10 }}>{t.site_label}</h2>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{t.site_label}</th><th style={{ textAlign: 'right' }}>{t.people}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
            <tbody>
              {ctx.sites.map((x) => {
                const label = ctx.label('site', x.key);
                const other = lang === 'fr' ? x.labelEn : x.labelFr;
                const used = usage.sites.get(x.key);
                return (
                  <tr key={x.key} style={x.active ? undefined : inactive}>
                    <td>
                      <div>{label}</div>
                      <div className="text-muted" style={sub}>{[other !== label && other, x.key, !x.active && t.inactive].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{used?.people ?? 0}</td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{used?.documents ?? 0}</td>
                    <td style={{ textAlign: 'right', width: 44 }}>
                      <DialogButton
                        spec={{ kind: 'org', what: 'site', value: { id: x.key, labelFr: x.labelFr, labelEn: x.labelEn, active: x.active, used: inUse(used) } }}
                        className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${t.perm_edit} · ${label}`} style={{ width: 30, height: 30 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

/**
 * Templates (FRM-QMS-…) in force: the source of "Nouveau depuis un modèle", with the types each is meant for, which
 * its owner or a records manager sets here or on its record (lib/actions.ts setTemplateTypes).
 */
async function Templates({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const tpls = await listTemplates(ctx);
  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead><tr><th>{t.ref}</th><th>{t.title_label}</th><th>{t.revision}</th><th>{t.owner}</th><th>{t.department}</th><th>{t.template_types}</th><th style={{ textAlign: 'right' }} title={t.tpl_uses_hint}>{t.uses}</th><th><span className="sr-only">{t.col_actions}</span></th></tr></thead>
      <tbody>
        {tpls.map((x) => {
          const href = `/documents/${encodeURIComponent(x.id)}`;
          const lock = lockOf(x);
          return (
            <tr key={x.id}>
              <td className="nowrap"><Link href={href} className="link-plain">{x.id}</Link></td>
              <td>{x.label}</td>
              <td className="text-muted">{x.rev}</td>
              <td>{x.owner}</td>
              <td className="text-muted">{ctx.label('department', x.department)}</td>
              <td>{x.types.length ? <span title={x.types.map((c) => `${c} · ${ctx.label('type', c)}`).join('\n')}>{x.types.join(', ')}</span> : <span className="text-muted">—</span>}</td>
              <td className="tabnum" style={{ textAlign: 'right' }}>{x.uses}</td>
              <td className="nowrap" style={{ textAlign: 'right' }}>
                {mayLinkTemplate(ctx, x) && (
                  <DialogButton spec={{ kind: 'templateTypes', docId: x.id, title: x.label, types: x.types, version: x.version }} className="btn btn-ghost" style={{ fontSize: 12 }} deniedTitle={lock ? t[lock] : undefined}>{t.template_types}</DialogButton>
                )}
                <Link href={href} className="btn btn-ghost" style={{ fontSize: 12 }}>{t.open_record}</Link>
              </td>
            </tr>
          );
        })}
        {tpls.length === 0 && <tr><td colSpan={8} className="text-muted" style={{ padding: '16px 8px' }}>{t.no_results}</td></tr>}
      </tbody>
    </table>
  );
}

/**
 * What Codex checks on every file it receives (lib/filetypes.ts, lib/antivirus.ts), above the journal where the files
 * the scan refuses are recorded: a scan left off by the configuration is said here, not only in the server log.
 */
function FilesPolicy({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  const rules = fileRules(process.env);
  const av = antivirusStatus();
  return (
    <p className={`${styles.filesPolicy} text-muted`}>
      <strong>{t.files_policy}</strong>
      <span>{t.file_max_hint.replace('{max}', fmtMax(rules.maxBytes, lang))}</span>
      <span title={rules.extensions.join(' ')}>{t.files_formats.replace('{n}', String(rules.extensions.length))}</span>
      {av
        ? <span>{t.av_on.replace('{address}', av.address)} · {av.onError === 'accept' ? t.av_on_error_accept : t.av_on_error_refuse}</span>
        : <span className={styles.filesOff}>{t.av_off}</span>}
    </p>
  );
}

/**
 * Orphan files of the store (lib/orphans.ts), for a records manager: a link that runs the dry run (?orphans=1, nothing
 * removed), then the list and the button that removes those of the local store. SharePoint's are listed only (O-01).
 */
async function Orphans({ ctx, open }: { ctx: Ctx; open: boolean }) {
  const { t, lang } = ctx;
  if (!open) {
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{t.orphans_title}</strong>
        <Link href="/administration?tab=audit&orphans=1" className="link-plain" scroll={false}>{t.orphans_find}</Link>
      </p>
    );
  }
  const report = await orphanReport();
  const h = String(report.graceHours);
  const counts = (x: OrphanScan) => [
    t.orphans_found.replace('{h}', h).replace('{n}', String(x.orphans.length)).replace('{size}', fmtSize(x.bytes, lang)),
    ...(x.recent ? [t.orphans_recent.replace('{n}', String(x.recent))] : []),
    ...(x.foreign ? [t.orphans_foreign.replace('{n}', String(x.foreign))] : []),
  ].join(' · ');
  const list = (x: OrphanScan) => x.orphans.length > 0 && (
    <table className={`table ${styles.orphanTable}`}>
      <thead><tr><th>{t.file}</th><th>{t.size}</th><th>{t.orphans_touched}</th></tr></thead>
      <tbody>
        {x.orphans.slice(0, MAX_PER_RUN).map((f) => (
          <tr key={f.key}>
            <td className={styles.orphanKey}>{f.key}</td>
            <td className="nowrap tabnum">{fmtSize(f.size, lang)}</td>
            <td className="nowrap tabnum text-muted">{fmtDateTime(parisStamp(new Date(f.touched).toISOString()), lang)}</td>
          </tr>
        ))}
        {x.orphans.length > MAX_PER_RUN && <tr><td colSpan={3} className="text-muted">{t.orphans_more.replace('{n}', String(x.orphans.length - MAX_PER_RUN))}</td></tr>}
      </tbody>
    </table>
  );
  // The removal is given the keys shown here: an orphan that turns up while the page is open is not removed with them.
  const shown = report.local.orphans.slice(0, MAX_PER_RUN).map((f) => f.key);
  const n = shown.length;
  return (
    <section className={styles.orphans} aria-label={t.orphans_title}>
      <div className={styles.orphansHead}>
        <strong>{t.orphans_title}</strong>
        <span style={{ flex: 1 }} />
        {n > 0 && (
          <ActionButton action={purgeOrphanFiles.bind(null, shown)} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={t.orphans_confirm.replace('{n}', String(n))} after="/administration?tab=audit&orphans=1">
            {t.orphans_delete.replace('{n}', String(n))}
          </ActionButton>
        )}
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{t.close}</Link>
      </div>
      <p className="text-muted">{t.orphans_hint.replace('{h}', h)}</p>
      <p><span className={styles.orphanStore}>{t.orphans_store_local}</span>{report.local.orphans.length || report.local.recent || report.local.foreign ? counts(report.local) : t.orphans_none}</p>
      {list(report.local)}
      {report.sharepoint && (
        'error' in report.sharepoint
          ? <p><span className={styles.orphanStore}>{t.orphans_store_sharepoint}</span><span className={styles.filesOff}>{t.orphans_sp_error}</span></p>
          : (
            <>
              <p><span className={styles.orphanStore}>{t.orphans_store_sharepoint}</span>{counts(report.sharepoint)} · <span className="text-muted">{t.orphans_sp_list_only}</span></p>
              {list(report.sharepoint)}
            </>
          )
      )}
    </section>
  );
}

/**
 * Files left under their provisional name (lib/provisional.ts), for a records manager: a link that runs the dry run
 * (?provisional=1, nothing changes), then the list and the button that renames those listed.
 */
async function Provisional({ ctx, open }: { ctx: Ctx; open: boolean }) {
  const { t, lang } = ctx;
  if (!open) {
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{t.prov_title}</strong>
        <Link href="/administration?tab=audit&provisional=1" className="link-plain" scroll={false}>{t.prov_find}</Link>
      </p>
    );
  }
  const report = await provisionalReport();
  const h = String(report.graceHours);
  const counts = (x: ProvisionalScan) => [
    t.prov_found.replace('{n}', String(x.due.length)),
    ...(x.recent ? [t.prov_recent.replace('{n}', String(x.recent))] : []),
    ...(x.missing ? [t.prov_missing.replace('{n}', String(x.missing))] : []),
  ].join(' · ');
  const list = (x: ProvisionalScan) => x.due.length > 0 && (
    <table className={`table ${styles.orphanTable}`}>
      <thead><tr><th>{t.file}</th><th>{t.prov_new_name}</th><th>{t.orphans_touched}</th></tr></thead>
      <tbody>
        {x.due.slice(0, MAX_PER_RUN).map((f) => (
          <tr key={`${f.versionId}`}>
            <td className={styles.orphanKey}>{f.key}</td>
            <td className={styles.orphanKey}>{f.name}</td>
            <td className="nowrap tabnum text-muted">{f.touched == null ? '—' : fmtDateTime(parisStamp(new Date(f.touched).toISOString()), lang)}</td>
          </tr>
        ))}
        {x.due.length > MAX_PER_RUN && <tr><td colSpan={3} className="text-muted">{t.orphans_more.replace('{n}', String(x.due.length - MAX_PER_RUN))}</td></tr>}
      </tbody>
    </table>
  );
  const sp = report.sharepoint && !('error' in report.sharepoint) ? report.sharepoint : null;
  // The rename is given the keys shown here (both stores, at most MAX_PER_RUN): nothing found since is renamed with them.
  const shown = [...report.local.due, ...(sp?.due ?? [])].slice(0, MAX_PER_RUN).map((f) => f.key);
  const n = shown.length;
  const any = (x: ProvisionalScan) => x.due.length || x.recent || x.missing;
  return (
    <section className={styles.orphans} aria-label={t.prov_title}>
      <div className={styles.orphansHead}>
        <strong>{t.prov_title}</strong>
        <span style={{ flex: 1 }} />
        {n > 0 && (
          <ActionButton action={renameProvisionalFiles.bind(null, shown)} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={t.prov_confirm.replace('{n}', String(n))} after="/administration?tab=audit&provisional=1">
            {t.prov_rename.replace('{n}', String(n))}
          </ActionButton>
        )}
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{t.close}</Link>
      </div>
      <p className="text-muted">{t.prov_hint.replace('{h}', h)}</p>
      <p><span className={styles.orphanStore}>{t.orphans_store_local}</span>{any(report.local) ? counts(report.local) : t.prov_none}</p>
      {list(report.local)}
      {report.sharepoint && (
        'error' in report.sharepoint
          ? <p><span className={styles.orphanStore}>{t.orphans_store_sharepoint}</span><span className={styles.filesOff}>{t.orphans_sp_error}</span></p>
          : (
            <>
              <p><span className={styles.orphanStore}>{t.orphans_store_sharepoint}</span>{any(report.sharepoint) ? counts(report.sharepoint) : t.prov_none} · <span className="text-muted">{t.prov_sp_untested}</span></p>
              {list(report.sharepoint)}
            </>
          )
      )}
    </section>
  );
}

/**
 * Backups (lib/backup.ts), for a records manager: the date of the latest archive and a link that lists them
 * (?backups=1), with what each holds and the button that backs up now. Restoring is a command (npm run restore).
 */
async function Backups({ ctx, open }: { ctx: Ctx; open: boolean }) {
  const { t, lang } = ctx;
  const when = (iso: string | null) => (iso ? fmtDateTime(parisStamp(iso), lang) : '—');
  if (!open) {
    const all = await backupList(false);
    const latest = all?.[0];
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{t.backup_title}</strong>
        {all ? <span>{latest ? t.backup_last.replace('{date}', when(latest.createdAt)) : t.backup_none}</span> : <span className={styles.filesOff}>{t.backup_list_error}</span>}
        <Link href="/administration?tab=audit&backups=1" className="link-plain" scroll={false}>{t.backup_show}</Link>
      </p>
    );
  }
  const { dir, keep } = backupSettings();
  const list = await backupList();
  return (
    <section className={styles.orphans} aria-label={t.backup_title}>
      <div className={styles.orphansHead}>
        <strong>{t.backup_title}</strong>
        <span style={{ flex: 1 }} />
        <ActionButton action={backUpData} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={t.backup_confirm.replace('{dir}', dir).replaceAll('{n}', String(keep))} after="/administration?tab=audit&backups=1">
          {t.backup_create}
        </ActionButton>
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{t.close}</Link>
      </div>
      <p className="text-muted">{t.backup_hint.replace('{dir}', dir).replaceAll('{n}', String(keep))}</p>
      {!list
        ? <p className={styles.filesOff}>{t.backup_list_error}</p>
        : list.length === 0
        ? <p>{t.backup_none}</p>
        : (
          <table className={`table ${styles.orphanTable}`}>
            <thead><tr><th>{t.when}</th><th>{t.backup_col_by}</th><th style={{ textAlign: 'right' }}>{t.count}</th><th>{t.backup_col_files}</th><th>{t.backup_archive_size}</th></tr></thead>
            <tbody>
              {list.map((b) => {
                const m = b.manifest;
                return (
                  <tr key={b.name}>
                    <td className="nowrap tabnum" title={b.name}>{when(b.createdAt)}</td>
                    <td>{m ? (m.mode === 'online' ? ctx.userName(m.by) : t.backup_by_cli) : <span className={styles.filesOff}>{t.backup_unreadable}</span>}</td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{m ? m.counts.documents : '—'}</td>
                    <td className="tabnum">
                      {m ? `${m.files.count} (${fmtSize(m.files.bytes, lang)})` : '—'}
                      {m && m.files.missing.length > 0 && <span className={styles.filesOff}> · {t.backup_missing_n.replace('{n}', String(m.files.missing.length))}</span>}
                      {m && m.files.sharepoint > 0 && <span className="text-muted"> · {t.backup_sharepoint_n.replace('{n}', String(m.files.sharepoint))}</span>}
                    </td>
                    <td className="nowrap tabnum text-muted">{fmtSize(b.size, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </section>
  );
}

/**
 * Integrity of the stored files (lib/integrity.ts), for a records manager: what the latest check found, the documents
 * whose files it found altered or missing (links to their record), and the button that checks every file again.
 */
async function Integrity({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  const last = await latestIntegrityCheck();
  const x = last?.integrity;
  const items = x ? [...x.altered.map((v) => ({ ...v, kind: t.integrity_altered })), ...x.missing.map((v) => ({ ...v, kind: t.integrity_missing }))] : [];
  return (
    <section className={styles.orphans} aria-label={t.integrity_title}>
      <div className={styles.orphansHead}>
        <strong>{t.integrity_title}</strong>
        <span className={x && (x.alteredCount || x.missingCount || x.failed) ? styles.filesOff : 'text-muted'}>
          {last && x ? `${t.integrity_last.replace('{date}', fmtDateTime(parisStamp(last.at), lang))} · ${integrityL(ctx, x)}` : t.integrity_never}
        </span>
        <span style={{ flex: 1 }} />
        <ActionButton action={checkFileIntegrity} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={t.integrity_confirm} after="/administration?tab=audit">
          {t.integrity_check}
        </ActionButton>
      </div>
      <p className="text-muted">{t.integrity_hint}</p>
      {items.length > 0 && (
        <table className={`table ${styles.orphanTable}`}>
          <thead><tr><th>{t.document}</th><th>{t.working_version}</th><th>{t.integrity_finding}</th></tr></thead>
          <tbody>
            {items.map((v) => (
              <tr key={`${v.kind}-${v.v}`}>
                <td className="nowrap"><Link href={`/documents/${encodeURIComponent(v.doc)}?tab=versions`} className="link-plain">{v.doc}</Link></td>
                <td className="nowrap tabnum">{v.label}</td>
                <td className={styles.filesOff}>{v.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Full export (lib/full-export.ts), for a records manager: a plain link, so that the browser downloads the archive as it
 * is written (GET /api/export/full, journaled at its start and end).
 */
function FullExport({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  return (
    <p className={`${styles.filesPolicy} text-muted`}>
      <strong>{t.export_all_title}</strong>
      <a href="/api/export/full" className="link-plain" download>{t.export_all_download}</a>
      <span>{t.export_all_hint}</span>
    </p>
  );
}

/** An interval as the scheduler table shows it: 30 s, 5 min, 6 h, 1 j. */
function fmtInterval(ms: number, lang: 'fr' | 'en'): string {
  const units: [number, string][] = [[86_400_000, lang === 'fr' ? 'j' : 'd'], [3_600_000, 'h'], [60_000, 'min'], [1000, 's']];
  const [size, unit] = units.find(([u]) => ms % u === 0) ?? [1000, 's'];
  return `${ms / size} ${unit}`;
}

/** The figures of a task's last run, in the reader's language (lib/scheduler.ts TASKS). */
function runSummary(ctx: Ctx, x: TaskView): string {
  const { t, lang } = ctx;
  if (x.error === 'interrupted') return t.sched_interrupted;
  if (x.status === 'error') return x.error ?? '';
  const sum = x.summary ?? {};
  const n = (key: TKey, v: unknown) => (typeof v === 'number' ? t[key].replace('{n}', String(v)) : null);
  const parts = [
    n('sched_sum_promoted', sum.promoted), n('sched_sum_decisions', sum.decisions),
    n('sched_sum_renamed', sum.renamed), n('sched_sum_provisional', sum.provisional),
    n('sched_sum_removed', sum.removed), sum.bytes ? fmtSize(Number(sum.bytes), lang) : null, sum.failed ? n('sched_sum_failed', sum.failed) : null, n('sched_sum_left', sum.left),
    n('sched_sum_checked', sum.checked), sum.altered ? n('sched_sum_altered', sum.altered) : null, sum.missing ? n('sched_sum_missing', sum.missing) : null,
    typeof sum.archive === 'string' ? t.sched_sum_archive.replace('{v}', sum.archive) : null, sum.size ? fmtSize(Number(sum.size), lang) : null, n('sched_sum_files', sum.files),
    typeof sum.reason === 'string' && `sched_reason_${sum.reason}` in t ? t[`sched_reason_${sum.reason}` as TKey] : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The scheduler (lib/scheduler.ts), for whoever reaches Administration: each task with its setting, its last run and the
 * next. The settings are this process's variables; the runs, those any process on the database made.
 */
async function Scheduler({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  // The figures of each run to records managers only (summaryShown, D-14).
  const view = await schedulerOverview(ctx);
  const when = (ts: string | null) => (ts ? fmtDateTime(parisStamp(ts), lang) : null);
  return (
    <section className={styles.orphans} aria-label={t.sched_title}>
      <div className={styles.orphansHead}><strong>{t.sched_title}</strong></div>
      <p className="text-muted">{t.sched_hint}</p>
      {!view.enabled ? <p className={styles.filesOff}>{t.sched_off}</p> : !view.started && <p className={styles.filesOff}>{t.sched_not_started}</p>}
      <table className={`table ${styles.orphanTable}`}>
        <thead><tr><th>{t.sched_col_task}</th><th>{t.sched_col_every}</th><th>{t.sched_col_last}</th><th>{t.sched_col_result}</th><th>{t.sched_col_next}</th></tr></thead>
        <tbody>
          {view.tasks.map((x) => (
            <tr key={x.task}>
              <td>{t[`sched_task_${x.task}` as TKey]}<div className="text-muted" style={sub}>{x.env}</div></td>
              <td className="nowrap">{x.interval == null ? <span className="text-muted">{t.sched_disabled}</span> : t.sched_every.replace('{d}', fmtInterval(x.interval, lang))}</td>
              <td className="nowrap tabnum">{when(x.lastStart) ?? <span className="text-muted">{t.sched_never}</span>}</td>
              <td className={x.status === 'error' ? styles.filesOff : undefined}>
                {x.status && <>{t[`sched_st_${x.status}` as TKey]}{runSummary(ctx, x) && ` · ${runSummary(ctx, x)}`}</>}
              </td>
              <td className="nowrap tabnum">{x.interval == null ? '—' : when(x.next) ?? <span className="text-muted">{t.sched_next_first}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
      <FilesPolicy ctx={ctx} />
      {mayCleanStorage(ctx) && <Orphans ctx={ctx} open={sp.orphans === '1'} />}
      {mayCleanStorage(ctx) && <Provisional ctx={ctx} open={sp.provisional === '1'} />}
      {mayBackUp(ctx) && <Backups ctx={ctx} open={sp.backups === '1'} />}
      {mayCheckIntegrity(ctx) && <Integrity ctx={ctx} />}
      {mayExportAll(ctx) && <FullExport ctx={ctx} />}
      <Scheduler ctx={ctx} />
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
