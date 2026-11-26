import Form from 'next/form';
import Link from 'next/link';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@norma/charte/ds/Segmented';
import { FilterBar, FilterNote } from '@norma/charte/ds/FilterBar';
import { PageHeader } from '@/components/shell/PageHeader';
import { ActionButton, ActionLink, DialogButton } from '@/components/ui/client';
import { mayBackUp, mayCheckIntegrity, mayCleanStorage, mayExportAll, mayLinkTemplate, mayTransferHoldings } from '@/lib/access';
import { backUpData, checkFileIntegrity, restoreBackedUpFiles, purgeOrphanFiles, removeFunctionHolder, renameProvisionalFiles, togglePermission } from '@/lib/actions';
import { antivirusStatus } from '@/lib/antivirus';
import { backupKind, backupList, backupSettings, filesBackupList } from '@/lib/backup';
import { getCtx, type Ctx } from '@/lib/context';
import { featuredOf } from '@/lib/departments';
import { fileRules, fmtMax } from '@/lib/filetypes';
import { lockOf } from '@/lib/lifecycle';
import { ENFORCED_PERMS, MATRIX_ROLE, MATRIX_ROLES, PERMS, SIMULATED_MATRIX_ROLES } from '@/lib/i18n';
import { AUDIT_ID_MAX, auditPage, getMatrix, integrityL, latestIntegrityCheck, listFunctionHolders, listTemplates, orgUsage, registryUsage, retentionByType, typeView, type AuditFilter, type RegistryUsage } from '@/lib/queries';
import { fmtDateTime, fmtSize, parisStamp, parseIsoDay } from '@/lib/format';
import { MAX_PER_RUN, orphanReport, type OrphanScan } from '@/lib/orphans';
import { provisionalReport, type ProvisionalScan } from '@/lib/provisional';
import { schedulerOverview, type TaskView } from '@/lib/scheduler';
import { inUse } from '@/lib/org-rules';
import { DEPARTMENT_HEAD_FUNCTION } from '@/lib/registry-rules';
import { FACET_LABEL, oneEach } from '@/lib/search';
import { Transfer } from './Transfer';
import { Vocabularies } from './Vocabularies';
import { FamilyFilter } from './FamilyFilter';
import { countBy, typeSpec } from './shared';
import styles from './admin.module.css';
import { screenTitle } from '@/lib/titles';
import { msg } from '@/i18n';
import { ACTIVITY_LABEL, ATTACHMENT_LABEL, FAMILY_GROUP_LABEL, FUNCTION_SCOPE_LABEL, LOCK_LABEL, MATRIX_ROLE_LABEL, ORIGIN_LABEL, PERM_LABEL, SCHEDULE_REASON_LABEL, SCHEDULE_STATUS_LABEL, SCHEDULE_TASK_LABEL, labelOf } from '@/i18n/labels';

const TABS = ['registry', 'functions', 'roles', 'org', 'vocab', 'transfer', 'templates', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { registry: msg('Type register'), functions: msg('Functions & workflows'), roles: msg('Roles & permissions'), org: msg('Organisation'), vocab: msg('Vocabularies'), transfer: msg('Handover (departure)'), templates: msg('Templates (QMS)'), audit: msg('Audit log') };

const sub = { fontSize: 11 } as const;

export function generateMetadata() {
  return screenTitle(msg('Administration'));
}

export default async function AdminPage({ searchParams }: PageProps<'/administration'>) {
  // One value per parameter: a repeated one (?doc=a&doc=b) keeps its first.
  const sp = oneEach(await searchParams);
  const ctx = await getCtx();
  const { tr, lang } = ctx;
  if (!ctx.screens.admin) return <Forbidden text={tr('The simulated role cannot access this screen.')} back={tr('Back to home')} />;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'registry';
  const family = ctx.families.some((f) => f.key === sp.family) ? sp.family! : '';
  const typesByFamily = countBy(ctx.types, (x) => x.family);

  return (
    <>
      {/* Administration (Norma 2.0): its tabs and the register's family filter in the toolbar, each tab's creations in
          the page header (the main one rightmost). */}
      <PageHeader
        title={tr(TAB_LABEL[tab])}
        crumbs={[tr('Administration')]}
        actions={<>
          {tab === 'registry' && <DialogButton spec={{ kind: 'family' }} className="btn btn-secondary" icon="plus" iconSw={1.8}>{tr('New family')}</DialogButton>}
          {tab === 'org' && <DialogButton spec={{ kind: 'org', what: 'site' }} className="btn btn-secondary" icon="plus" iconSw={1.8}>{tr('New site')}</DialogButton>}
          {tab === 'audit' && <ActionLink native href="/api/export/audit" icon="download">{tr('Export (CSV)')}</ActionLink>}
        </>}
        primary={
          tab === 'registry' ? <DialogButton spec={{ kind: 'type', family: family || undefined }} className="btn btn-primary" icon="plus" iconSw={1.8}>{tr('New type')}</DialogButton>
          : tab === 'functions' ? <DialogButton spec={{ kind: 'function' }} className="btn btn-primary" icon="plus" iconSw={1.8}>{tr('New function')}</DialogButton>
          : tab === 'org' ? <DialogButton spec={{ kind: 'org', what: 'department' }} className="btn btn-primary" icon="plus" iconSw={1.8}>{tr('New department')}</DialogButton>
          : tab === 'templates' ? <DialogButton spec={{ kind: 'new', preset: { typeCode: 'FRM' } }} className="btn btn-primary" icon="plus" iconSw={1.8}>{tr('New template')}</DialogButton>
          : undefined
        }
        toolbar={
          <FilterBar>
            <Segmented
              className="codex-seg"
              wrap
              value={tab}
              // The handover is for records managers only (access.ts mayTransferHoldings): the tab is not shown to others.
              options={TABS.filter((k) => k !== 'transfer' || mayTransferHoldings(ctx)).map((k) => ({ value: k, label: tr(TAB_LABEL[k]), href: `/administration${k === 'registry' ? '' : `?tab=${k}`}` }))}
            />
            {tab === 'registry' && (
              <FamilyFilter
                value={family}
                ariaLabel={tr('Family')}
                allLabel={tr('All families')}
                options={ctx.families.filter((f) => typesByFamily.has(f.key)).map((f) => ({ key: f.key, label: lang === 'fr' ? f.labelFr : f.labelEn, count: typesByFamily.get(f.key)! }))}
              />
            )}
            {tab === 'registry' && <FilterNote>{family ? typesByFamily.get(family) ?? 0 : ctx.types.length} {tr('types')}</FilterNote>}
          </FilterBar>
        }
      />
    <div className="screen" data-screen-label="Administration">
      <div className="codex-table-scroll">
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
    </>
  );
}

/**
 * Register of document types (owned by Codex, read by Keystone): one row per type, edited in the 'type' dialog, then
 * the families. An entry something refers to keeps its code and cannot be deleted (lib/queries.ts registryUsage).
 */
async function Registry({ ctx, family }: { ctx: Ctx; family: string }) {
  const { tr, lang } = ctx;
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
            <th>{tr('Code')}</th><th>{tr('Type')}</th><th>{tr('Family')}</th><th>{tr('Origin')}</th><th>{tr('Attachment')}</th><th>{tr('Workflow')}</th>
            <th>{tr('Confidentiality')}</th><th>{tr('Retention#column')}</th><th title={tr('Review periodicity')}>{tr('Review')}</th><th>ISO</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th><span className="sr-only">{tr('Actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {types.map((x) => (
            <tr key={x.code} style={x.active ? undefined : { opacity: 0.55 }}>
              <td className="nowrap" style={{ verticalAlign: 'top' }}>{x.code}</td>
              <td style={{ minWidth: 180 }}>
                <div>{x.label}</div>
                {x.subtypesL.length > 0 && <div className="text-muted" style={sub}>{x.subtypesL.join(' · ')}</div>}
                {(x.clientDeliverable || !x.active) && <div className="text-muted" style={sub}>{[x.clientDeliverable && tr('Client deliverable'), !x.active && tr('Inactive')].filter(Boolean).join(' · ')}</div>}
              </td>
              <td className="text-muted">{x.familyLabel}</td>
              <td className="text-muted">{x.origins.map((o) => labelOf(tr, ORIGIN_LABEL, o)).join(', ')}</td>
              <td className="text-muted">{x.attachments.map((a) => labelOf(tr, ATTACHMENT_LABEL, a)).join(', ')}</td>
              <td className="text-muted" style={{ minWidth: 160 }}>{x.circuitL}</td>
              <td><div>{x.confDefaultL}</div><div className="text-muted" style={sub}>{x.confL}</div></td>
              <td className="text-muted" style={{ minWidth: 150 }} title={x.basisL || undefined}>{x.retentionL}</td>
              <td className="text-muted nowrap">{x.reviewL}</td>
              <td className="text-muted">{x.iso ?? '—'}</td>
              <td className="tabnum" style={{ textAlign: 'right' }}>{counts.get(x.code) ?? 0}</td>
              <td style={{ textAlign: 'right', width: 44 }}>
                <DialogButton spec={typeSpec(x, usage.types.has(x.code), retention.get(x.code))} className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${x.code}`} style={{ width: 30, height: 30 }} />
              </td>
            </tr>
          ))}
          {types.length === 0 && <tr><td colSpan={12} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
        </tbody>
      </table>
      <section aria-label={tr('Families')}>
        <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Families')}</h2>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>{tr('Family')}</th><th>{tr('Key')}</th><th>{tr('Deck group')}</th><th style={{ textAlign: 'right' }}>{tr('types')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
          <tbody>
            {families.map((f) => {
              const label = lang === 'fr' ? f.labelFr : f.labelEn;
              return (
                <tr key={f.key}>
                  <td><div>{label}</div>{lang === 'fr' ? <div className="text-muted" style={sub}>{f.labelEn}</div> : <div className="text-muted" style={sub}>{f.labelFr}</div>}</td>
                  <td className="text-muted tabnum">{f.key}</td>
                  <td className="text-muted nowrap">{labelOf(tr, FAMILY_GROUP_LABEL, f.grp)}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{typesByFamily.get(f.key) ?? 0}</td>
                  <td className="tabnum" style={{ textAlign: 'right' }}>{docsByFamily.get(f.key) ?? 0}</td>
                  <td style={{ textAlign: 'right', width: 44 }}>
                    <DialogButton
                      spec={{ kind: 'family', family: { key: f.key, labelFr: f.labelFr, labelEn: f.labelEn, grp: f.grp, used: usage.families.has(f.key) } }}
                      className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${label}`} style={{ width: 30, height: 30 }}
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
  const { tr } = ctx;
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
        <thead><tr><th>{tr('Function')}</th><th>{tr('Scope')}</th><th>{tr('Holders')}</th><th style={{ textAlign: 'right' }}>{tr('Document types')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
        <tbody>
          {fns.map((f) => (
            <tr key={f.key}>
              <td className="nowrap" style={{ verticalAlign: 'top' }}>{f.label}</td>
              <td className="text-muted nowrap" style={{ verticalAlign: 'top' }}>{labelOf(tr, FUNCTION_SCOPE_LABEL, f.scope)}</td>
              <td>
                <div className={styles.holders}>
                  {f.holders.length === 0 && <span className="text-muted">—</span>}
                  {f.holders.map((h) => (
                    <span key={h.id} className={`tag tag-neutral ${styles.holder}`} title={h.scopeValue ? scopeTitle(f.scope, h.scopeValue) : undefined}>
                      {h.user}
                      {f.scope !== 'global' && <span style={{ opacity: 0.7 }}>· {h.scopeL}</span>}
                      <ActionButton className={styles.remove} ariaLabel={`${tr('Remove')} · ${h.user}`} title={tr('Remove')} action={removeFunctionHolder.bind(null, h.id)}>
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
                    {tr('Add a holder')}
                  </DialogButton>
                  <DialogButton
                    spec={{ kind: 'function', fn: { key: f.key, labelFr: f.labelFr, labelEn: f.labelEn, scope: f.scope, used: usage.functions.has(f.key), held: f.holders.length > 0 } }}
                    className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${f.label}`} style={{ width: 30, height: 30 }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Programs ctx={ctx} usage={usage} />
      <section>
        <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Workflow')}</h2>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>{tr('Workflow steps')}</th><th>{tr('Document types')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th></tr></thead>
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
  const { tr } = ctx;
  return (
    <section aria-label={tr('Research programmes')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h2 className="sec-title" style={{ margin: 0 }}>{tr('Research programmes')}</h2>
        <span style={{ flex: 1 }} />
        <DialogButton spec={{ kind: 'program' }} className="btn btn-secondary" icon="plus" iconSw={1.8} style={{ fontSize: 12 }}>{tr('New programme')}</DialogButton>
      </div>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{tr('Code')}</th><th>{tr('Name')}</th><th>{tr('Manager')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
        <tbody>
          {ctx.programs.map((p) => (
            <tr key={p.code} style={p.active ? undefined : { opacity: 0.55 }}>
              <td className="nowrap tabnum">{p.code}</td>
              <td><div>{p.name}</div>{!p.active && <div className="text-muted" style={sub}>{tr('Inactive')}</div>}</td>
              <td className="text-muted">{ctx.userName(p.managerId)}</td>
              <td className="tabnum" style={{ textAlign: 'right' }}>{usage.docs.programs.get(p.code) ?? 0}</td>
              <td style={{ textAlign: 'right', width: 44 }}>
                <DialogButton
                  spec={{ kind: 'program', program: { code: p.code, name: p.name, managerId: p.managerId, active: p.active, used: usage.programs.has(p.code) } }}
                  className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${p.code}`} style={{ width: 30, height: 30 }}
                />
              </td>
            </tr>
          ))}
          {ctx.programs.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
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
  const { tr } = ctx;
  const matrix = await getMatrix();
  const own = MATRIX_ROLE[ctx.role];
  return (
    <>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 4px' }}>{tr('Click a cell to grant or revoke the permission.')}</p>
      <p className="text-muted" style={{ fontSize: 11, margin: '0 0 10px' }}>{tr('Greyed cells: permission with no action in Codex (Destroy) or role with no simulated equivalent (Reader, Administrator).')}</p>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{tr('Role')}</th>{PERMS.map((p) => <th key={p} style={{ textAlign: 'center' }}>{labelOf(tr, PERM_LABEL, p)}</th>)}</tr></thead>
        <tbody>
          {MATRIX_ROLES.map((r) => (
            <tr key={r}>
              <td className="nowrap">{labelOf(tr, MATRIX_ROLE_LABEL, r)}</td>
              {PERMS.map((p) => {
                const on = !!matrix.get(`${r}:${p}`);
                const label = `${labelOf(tr, MATRIX_ROLE_LABEL, r)} · ${labelOf(tr, PERM_LABEL, p)}`;
                const color = on ? 'var(--color-accent)' : 'var(--color-neutral-700)';
                const fixed = !SIMULATED_MATRIX_ROLES.includes(r) || !ENFORCED_PERMS.includes(p) ? tr('Not enforced in the simulation') : p === 'admin' && r === own ? tr('Cannot revoke: your role would lose access to administration.') : null;
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
  const { tr, lang } = ctx;
  // Counts cover every document, drafts and confidential ones included (administration only).
  const [usage, fns] = await Promise.all([orgUsage(), listFunctionHolders(ctx)]);
  const heads = fns.find((f) => f.key === DEPARTMENT_HEAD_FUNCTION)?.holders ?? [];
  const inactive = { opacity: 0.55 };
  return (
    <>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" size={14} style={{ flex: 'none', marginTop: 1 }} />{tr('Provisional values, pending the organisation chart. The 3-letter department code is part of the ID of documents without attachment: it never changes. Labels can be edited; a value in use is made inactive instead of being deleted.')}
      </p>
      <div className={styles.split}>
        <section>
          <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Department / Function')}</h2>
          {/* The table scrolls within its column rather than spilling over the sites beside it. */}
          <div className={styles.tableScroll}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr><th>{tr('Code')}</th><th>{tr('Label (FR)')}</th><th>{tr('Label (EN)')}</th><th>{tr('Manager')}</th><th style={{ textAlign: 'right' }}>{tr('People')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th>{tr('Featured filters')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
              <tbody>
                {ctx.departments.map((d) => {
                  const featured = featuredOf(d);
                  const label = ctx.label('department', d.code);
                  const used = usage.departments.get(d.code);
                  return (
                    <tr key={d.code} style={d.active ? undefined : inactive}>
                      <td className="nowrap tabnum"><Link href={`/departements/${encodeURIComponent(d.code)}`} className="link-plain">{d.code}</Link></td>
                      <td><div>{d.labelFr}</div>{!d.active && <div className="text-muted" style={sub}>{tr('Inactive')}</div>}</td>
                      <td className="text-muted">{d.labelEn}</td>
                      <td className="text-muted">{heads.filter((h) => h.scopeValue === d.code).map((h) => h.user).join(', ') || '—'}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{used?.people ?? 0}</td>
                      <td className="tabnum" style={{ textAlign: 'right' }}>{used?.documents ?? 0}</td>
                      {/* The default facets are named on hover only: every department follows them until it has its own. */}
                      <td style={{ paddingTop: 0, paddingBottom: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <span className={`ellipsis${d.featured == null ? ' text-muted' : ''}`} style={{ maxWidth: 180 }} title={featured.map((k) => tr(FACET_LABEL[k])).join(', ') || tr('None')}>
                            {d.featured == null ? tr('Default filters') : featured.map((k) => tr(FACET_LABEL[k])).join(', ') || tr('None')}
                          </span>
                          <DialogButton
                            spec={{ kind: 'featured', department: { code: d.code, label }, featured, isDefault: d.featured == null }}
                            className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Featured filters')} · ${d.code}`} style={{ width: 28, height: 28, flex: 'none' }}
                          />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', width: 44 }}>
                        <DialogButton
                          spec={{ kind: 'org', what: 'department', value: { id: d.code, labelFr: d.labelFr, labelEn: d.labelEn, active: d.active, used: inUse(used) } }}
                          className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${d.code}`} style={{ width: 30, height: 30 }}
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
          <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Site')}</h2>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>{tr('Site')}</th><th style={{ textAlign: 'right' }}>{tr('People')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
            <tbody>
              {ctx.sites.map((x) => {
                const label = ctx.label('site', x.key);
                const other = lang === 'fr' ? x.labelEn : x.labelFr;
                const used = usage.sites.get(x.key);
                return (
                  <tr key={x.key} style={x.active ? undefined : inactive}>
                    <td>
                      <div>{label}</div>
                      <div className="text-muted" style={sub}>{[other !== label && other, x.key, !x.active && tr('Inactive')].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{used?.people ?? 0}</td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{used?.documents ?? 0}</td>
                    <td style={{ textAlign: 'right', width: 44 }}>
                      <DialogButton
                        spec={{ kind: 'org', what: 'site', value: { id: x.key, labelFr: x.labelFr, labelEn: x.labelEn, active: x.active, used: inUse(used) } }}
                        className="btn btn-ghost btn-icon" icon="pen" ariaLabel={`${tr('Edit#permission')} · ${label}`} style={{ width: 30, height: 30 }}
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
  const { tr } = ctx;
  const tpls = await listTemplates(ctx);
  return (
    <table className="table" style={{ fontSize: 13 }}>
      <thead><tr><th>{tr('Reference')}</th><th>{tr('Title')}</th><th>{tr('Revision')}</th><th>{tr('Owner')}</th><th>{tr('Department / Function')}</th><th>{tr('Target types')}</th><th style={{ textAlign: 'right' }} title={tr('Documents created from this template, among those you may read')}>{tr('Uses')}</th><th><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
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
                  <DialogButton spec={{ kind: 'templateTypes', docId: x.id, title: x.label, types: x.types, version: x.version }} className="btn btn-ghost" style={{ fontSize: 12 }} deniedTitle={lock ? tr(LOCK_LABEL[lock]) : undefined}>{tr('Target types')}</DialogButton>
                )}
                <Link href={href} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Open record')}</Link>
              </td>
            </tr>
          );
        })}
        {tpls.length === 0 && <tr><td colSpan={8} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No document matches these criteria.')}</td></tr>}
      </tbody>
    </table>
  );
}

/**
 * What Codex checks on every file it receives (lib/filetypes.ts, lib/antivirus.ts), above the journal where the files
 * the scan refuses are recorded: a scan left off by the configuration is said here, not only in the server log.
 */
function FilesPolicy({ ctx }: { ctx: Ctx }) {
  const { tr, lang } = ctx;
  const rules = fileRules(process.env);
  const av = antivirusStatus();
  return (
    <p className={`${styles.filesPolicy} text-muted`}>
      <strong>{tr('Uploaded files')}</strong>
      <span>{tr('{max} at most').replace('{max}', fmtMax(rules.maxBytes, lang))}</span>
      <span title={rules.extensions.join(' ')}>{tr('{n} accepted formats').replace('{n}', String(rules.extensions.length))}</span>
      {av
        ? <span>{tr('virus scanning by clamd ({address})').replace('{address}', av.address)} · {av.onError === 'accept' ? tr('file accepted unscanned when the scan fails') : tr('upload refused when the scan fails')}</span>
        : <span className={styles.filesOff}>{tr('virus scanning off (CODEX_CLAMD not set)')}</span>}
    </p>
  );
}

/**
 * Orphan files of the store (lib/orphans.ts), for a records manager: a link that runs the dry run (?orphans=1, nothing
 * removed), then the list and the button that removes those of the local store. SharePoint's are listed only (O-01).
 */
async function Orphans({ ctx, open }: { ctx: Ctx; open: boolean }) {
  const { tr, lang } = ctx;
  if (!open) {
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{tr('Orphan files')}</strong>
        <Link href="/administration?tab=audit&orphans=1" className="link-plain" scroll={false}>{tr('Look for them')}</Link>
      </p>
    );
  }
  const report = await orphanReport();
  const h = String(report.graceHours);
  const counts = (x: OrphanScan) => [
    tr('Orphans older than {h} h: {n} ({size})').replace('{h}', h).replace('{n}', String(x.orphans.length)).replace('{size}', fmtSize(x.bytes, lang)),
    ...(x.recent ? [tr('recent, kept: {n}').replace('{n}', String(x.recent))] : []),
    ...(x.foreign ? [tr('other files, left in place: {n}').replace('{n}', String(x.foreign))] : []),
  ].join(' · ');
  const list = (x: OrphanScan) => x.orphans.length > 0 && (
    <table className={`table ${styles.orphanTable}`}>
      <thead><tr><th>{tr('File')}</th><th>{tr('Size')}</th><th>{tr('Last written')}</th></tr></thead>
      <tbody>
        {x.orphans.slice(0, MAX_PER_RUN).map((f) => (
          <tr key={f.key}>
            <td className={styles.orphanKey}>{f.key}</td>
            <td className="nowrap tabnum">{fmtSize(f.size, lang)}</td>
            <td className="nowrap tabnum text-muted">{fmtDateTime(parisStamp(new Date(f.touched).toISOString()), lang)}</td>
          </tr>
        ))}
        {x.orphans.length > MAX_PER_RUN && <tr><td colSpan={3} className="text-muted">{tr('… and {n} more, at the next run').replace('{n}', String(x.orphans.length - MAX_PER_RUN))}</td></tr>}
      </tbody>
    </table>
  );
  // The removal is given the keys shown here: an orphan that turns up while the page is open is not removed with them.
  const shown = report.local.orphans.slice(0, MAX_PER_RUN).map((f) => f.key);
  const n = shown.length;
  return (
    <section className={styles.orphans} aria-label={tr('Orphan files')}>
      <div className={styles.orphansHead}>
        <strong>{tr('Orphan files')}</strong>
        <span style={{ flex: 1 }} />
        {n > 0 && (
          <ActionButton action={purgeOrphanFiles.bind(null, shown)} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Permanently remove the listed orphan files ({n}) from local storage? Each file is checked again just before, and the removal is journaled.').replace('{n}', String(n))} after="/administration?tab=audit&orphans=1">
            {tr('Remove these files ({n})').replace('{n}', String(n))}
          </ActionButton>
        )}
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{tr('Close')}</Link>
      </div>
      <p className="text-muted">{tr('Stored files that no working version refers to (interrupted upload, unfinished rename). This search removes nothing. A file written less than {h} h ago is never counted: it may belong to an upload in progress.').replace('{h}', h)}</p>
      <p><span className={styles.orphanStore}>{tr('Local storage')}</span>{report.local.orphans.length || report.local.recent || report.local.foreign ? counts(report.local) : tr('No orphan file.')}</p>
      {list(report.local)}
      {report.sharepoint && (
        'error' in report.sharepoint
          ? <p><span className={styles.orphanStore}>{tr('SharePoint (_staging folder)')}</span><span className={styles.filesOff}>{tr('SharePoint could not be listed: see the server log.')}</span></p>
          : (
            <>
              <p><span className={styles.orphanStore}>{tr('SharePoint (_staging folder)')}</span>{counts(report.sharepoint)} · <span className="text-muted">{tr('Listed only: removal on SharePoint waits for a trial on a real tenant (O-01).')}</span></p>
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
  const { tr, lang } = ctx;
  if (!open) {
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{tr('Files under a provisional name')}</strong>
        <Link href="/administration?tab=audit&provisional=1" className="link-plain" scroll={false}>{tr('Look for them')}</Link>
      </p>
    );
  }
  const report = await provisionalReport();
  const h = String(report.graceHours);
  const counts = (x: ProvisionalScan) => [
    tr('To rename: {n}').replace('{n}', String(x.due.length)),
    ...(x.recent ? [tr('recent, left: {n}').replace('{n}', String(x.recent))] : []),
    ...(x.missing ? [tr('file missing from storage, left: {n}').replace('{n}', String(x.missing))] : []),
  ].join(' · ');
  const list = (x: ProvisionalScan) => x.due.length > 0 && (
    <table className={`table ${styles.orphanTable}`}>
      <thead><tr><th>{tr('File')}</th><th>{tr('Name given')}</th><th>{tr('Last written')}</th></tr></thead>
      <tbody>
        {x.due.slice(0, MAX_PER_RUN).map((f) => (
          <tr key={`${f.versionId}`}>
            <td className={styles.orphanKey}>{f.key}</td>
            <td className={styles.orphanKey}>{f.name}</td>
            <td className="nowrap tabnum text-muted">{f.touched == null ? '—' : fmtDateTime(parisStamp(new Date(f.touched).toISOString()), lang)}</td>
          </tr>
        ))}
        {x.due.length > MAX_PER_RUN && <tr><td colSpan={3} className="text-muted">{tr('… and {n} more, at the next run').replace('{n}', String(x.due.length - MAX_PER_RUN))}</td></tr>}
      </tbody>
    </table>
  );
  const sp = report.sharepoint && !('error' in report.sharepoint) ? report.sharepoint : null;
  // The rename is given the keys shown here (both stores, at most MAX_PER_RUN): nothing found since is renamed with them.
  const shown = [...report.local.due, ...(sp?.due ?? [])].slice(0, MAX_PER_RUN).map((f) => f.key);
  const n = shown.length;
  const any = (x: ProvisionalScan) => x.due.length || x.recent || x.missing;
  return (
    <section className={styles.orphans} aria-label={tr('Files under a provisional name')}>
      <div className={styles.orphansHead}>
        <strong>{tr('Files under a provisional name')}</strong>
        <span style={{ flex: 1 }} />
        {n > 0 && (
          <ActionButton action={renameProvisionalFiles.bind(null, shown)} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Give the listed files ({n}) their name {ID}_{version}? Each one is checked again just before; the rename is journaled.').replace('{n}', String(n))} after="/administration?tab=audit&provisional=1">
            {tr('Rename these files ({n})').replace('{n}', String(n))}
          </ActionButton>
        )}
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{tr('Close')}</Link>
      </div>
      <p className="text-muted">{tr('Files whose record is written but which never got their name {ID}_{version} (an upload interrupted between the record and the rename, storage out of reach). They are still served as usual. This search changes nothing. A file touched less than {h} h ago is not counted: a rename may be running.').replace('{h}', h)}</p>
      <p><span className={styles.orphanStore}>{tr('Local storage')}</span>{any(report.local) ? counts(report.local) : tr('No file under a provisional name.')}</p>
      {list(report.local)}
      {report.sharepoint && (
        'error' in report.sharepoint
          ? <p><span className={styles.orphanStore}>{tr('SharePoint (_staging folder)')}</span><span className={styles.filesOff}>{tr('SharePoint could not be listed: see the server log.')}</span></p>
          : (
            <>
              <p><span className={styles.orphanStore}>{tr('SharePoint (_staging folder)')}</span>{any(report.sharepoint) ? counts(report.sharepoint) : tr('No file under a provisional name.')} · <span className="text-muted">{tr('Renamed on SharePoint through the same interface as uploads, not yet tried on a real tenant (O-01).')}</span></p>
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
  const { tr, lang } = ctx;
  const when = (iso: string | null) => (iso ? fmtDateTime(parisStamp(iso), lang) : '—');
  if ((await backupKind()) === 'files') return <FilesBackups ctx={ctx} open={open} />;
  if (!open) {
    const all = await backupList(false);
    const latest = all?.[0];
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{tr('Backups')}</strong>
        {all ? <span>{latest ? tr('latest: {date}').replace('{date}', when(latest.createdAt)) : tr('No backup.')}</span> : <span className={styles.filesOff}>{tr('The backup directory could not be read: see the server log.')}</span>}
        <Link href="/administration?tab=audit&backups=1" className="link-plain" scroll={false}>{tr('Show')}</Link>
      </p>
    );
  }
  const { dir, keep } = backupSettings();
  const list = await backupList();
  return (
    <section className={styles.orphans} aria-label={tr('Backups')}>
      <div className={styles.orphansHead}>
        <strong>{tr('Backups')}</strong>
        <span style={{ flex: 1 }} />
        <ActionButton action={backUpData} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Back up the database and files now? Writes wait while the database is copied (a few seconds). The archive is written to {dir}; the {n} most recent and the latest of each of the last {n} days are kept, the others removed.').replace('{dir}', dir).replaceAll('{n}', String(keep))} after="/administration?tab=audit&backups=1">
          {tr('Back up now')}
        </ActionButton>
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{tr('Close')}</Link>
      </div>
      <p className="text-muted">{tr('Archive of the database and of the files it refers to, with a manifest and the SHA-256 of each item, in {dir}; the {n} most recent and the latest of each of the last {n} days are kept. At most one backup per quarter of an hour from the application. Restoring is done with the server stopped, from the command line (npm run restore, docs/sauvegarde.md). No backup is scheduled: how often, and where archives are kept, remain to be decided.').replace('{dir}', dir).replaceAll('{n}', String(keep))}</p>
      {!list
        ? <p className={styles.filesOff}>{tr('The backup directory could not be read: see the server log.')}</p>
        : list.length === 0
        ? <p>{tr('No backup.')}</p>
        : (
          <table className={`table ${styles.orphanTable}`}>
            <thead><tr><th>{tr('Timestamp')}</th><th>{tr('Made by')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th>{tr('Files')}</th><th>{tr('Archive#backup')}</th></tr></thead>
            <tbody>
              {list.map((b) => {
                const m = b.manifest;
                return (
                  <tr key={b.name}>
                    <td className="nowrap tabnum" title={b.name}>{when(b.createdAt)}</td>
                    <td>{m ? (m.mode === 'online' ? ctx.userName(m.by) : tr('command line')) : <span className={styles.filesOff}>{tr('unreadable manifest')}</span>}</td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{m ? m.counts.documents : '—'}</td>
                    <td className="tabnum">
                      {m ? `${m.files.count} (${fmtSize(m.files.bytes, lang)})` : '—'}
                      {m && m.files.missing.length > 0 && <span className={styles.filesOff}> · {tr('missing from storage: {n}').replace('{n}', String(m.files.missing.length))}</span>}
                      {m && m.files.sharepoint > 0 && <span className="text-muted"> · {tr('on SharePoint, not included: {n}').replace('{n}', String(m.files.sharepoint))}</span>}
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
 * Backups on a PostgreSQL server (lib/files-backup-core.mjs): the database is backed up by the server's tools, Codex
 * backs up the files it points to. The states of the backup, the button that backs up now and the one that puts back
 * the files the store lacks.
 */
async function FilesBackups({ ctx, open }: { ctx: Ctx; open: boolean }) {
  const { tr, lang } = ctx;
  const when = (iso: string | null) => (iso ? fmtDateTime(parisStamp(iso), lang) : '—');
  if (!open) {
    const all = await filesBackupList(false);
    const latest = all?.[0];
    return (
      <p className={`${styles.filesPolicy} text-muted`}>
        <strong>{tr('Backups')}</strong>
        <span>{tr('files only')}</span>
        {all ? <span>{latest ? tr('latest: {date}').replace('{date}', when(latest.createdAt)) : tr('No backup.')}</span> : <span className={styles.filesOff}>{tr('The backup directory could not be read: see the server log.')}</span>}
        <Link href="/administration?tab=audit&backups=1" className="link-plain" scroll={false}>{tr('Show')}</Link>
      </p>
    );
  }
  const { dir, keep } = backupSettings();
  const list = await filesBackupList();
  return (
    <section className={styles.orphans} aria-label={tr('Backups')}>
      <div className={styles.orphansHead}>
        <strong>{tr('Backups')}</strong>
        <span className="text-muted">{tr('files only')}</span>
        <span style={{ flex: 1 }} />
        <ActionButton action={backUpData} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Copy the new files to {dir} now? Only the files not backed up yet are copied; the {n} most recent states and the latest of each of the last {n} days are kept.').replace('{dir}', dir).replaceAll('{n}', String(keep))} after="/administration?tab=audit&backups=1">
          {tr('Back up now')}
        </ActionButton>
        <ActionButton action={restoreBackedUpFiles} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Put back into storage, from the backup, the files the database refers to and that are missing there? No file present is replaced or removed. To do after the database was restored or the volume of the files lost.')} after="/administration?tab=audit&backups=1">
          {tr('Put back missing files')}
        </ActionButton>
        <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }} scroll={false}>{tr('Close')}</Link>
      </div>
      <p className="text-muted">{tr('The database is on the shared PostgreSQL server: it is backed up with the server’s tools (pg_dump, every night). Here, Codex backs up the files it refers to, in {dir}: each file is copied once, checked by its SHA-256, and each backup keeps the state of the library at that instant; the {n} most recent states and the latest of each of the last {n} days are kept. At most one backup per quarter of an hour from the application; how often it runs by itself is set by CODEX_SCHEDULE_BACKUP. Put this folder on another disk than the files, and copy it off the server (docs/stockage-serveur.md).').replace('{dir}', dir).replaceAll('{n}', String(keep))}</p>
      {!list
        ? <p className={styles.filesOff}>{tr('The backup directory could not be read: see the server log.')}</p>
        : list.length === 0
        ? <p>{tr('No backup.')}</p>
        : (
          <table className={`table ${styles.orphanTable}`}>
            <thead><tr><th>{tr('Timestamp')}</th><th>{tr('Made by')}</th><th style={{ textAlign: 'right' }}>{tr('Documents')}</th><th>{tr('Files listed')}</th><th>{tr('Copied')}</th></tr></thead>
            <tbody>
              {list.map((b) => {
                const m = b.state;
                return (
                  <tr key={b.name}>
                    <td className="nowrap tabnum" title={b.name}>{when(b.createdAt)}</td>
                    <td>{m ? ctx.userName(m.by) : <span className={styles.filesOff}>{tr('unreadable manifest')}</span>}</td>
                    <td className="tabnum" style={{ textAlign: 'right' }}>{m ? m.counts.documents : '—'}</td>
                    <td className="tabnum">
                      {m ? `${m.files.count} (${fmtSize(m.files.bytes, lang)})` : '—'}
                      {m && m.files.missing.length > 0 && <span className={styles.filesOff}> · {tr('missing from storage: {n}').replace('{n}', String(m.files.missing.length))}</span>}
                      {m && m.files.altered.length > 0 && <span className={styles.filesOff}> · {tr('altered, not copied: {n}').replace('{n}', String(m.files.altered.length))}</span>}
                    </td>
                    <td className="nowrap tabnum text-muted">{m ? `${m.files.copied} (${fmtSize(m.files.copiedBytes, lang)})` : '—'}</td>
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
  const { tr, lang } = ctx;
  const last = await latestIntegrityCheck();
  const x = last?.integrity;
  const items = x ? [...x.altered.map((v) => ({ ...v, kind: tr('altered') })), ...x.missing.map((v) => ({ ...v, kind: tr('missing from storage') }))] : [];
  return (
    <section className={styles.orphans} aria-label={tr('File integrity')}>
      <div className={styles.orphansHead}>
        <strong>{tr('File integrity')}</strong>
        <span className={x && (x.alteredCount || x.missingCount || x.failed) ? styles.filesOff : 'text-muted'}>
          {last && x ? `${tr('last check: {date}').replace('{date}', fmtDateTime(parisStamp(last.at), lang))} · ${integrityL(ctx, x)}` : tr('Never checked.')}
        </span>
        <span style={{ flex: 1 }} />
        <ActionButton action={checkFileIntegrity} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} confirm={tr('Read every stored file again and compare each one with the SHA-256 fingerprint recorded at its upload? This takes as long as reading every file; nothing is changed or removed, the outcome is journaled.')} after="/administration?tab=audit">
          {tr('Check now')}
        </ActionButton>
      </div>
      <p className="text-muted">{tr('Every file gets a SHA-256 fingerprint when uploaded. This check reads every stored file again and reports those whose content no longer matches (altered) or that are missing; it records the fingerprint of files uploaded before it was computed. A full download is checked on the way too: an altered file is cut short and journaled. Server stopped: npm run integrity.')}</p>
      {items.length > 0 && (
        <table className={`table ${styles.orphanTable}`}>
          <thead><tr><th>{tr('Document')}</th><th>{tr('Working version')}</th><th>{tr('Finding')}</th></tr></thead>
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
  const { tr } = ctx;
  return (
    <p className={`${styles.filesPolicy} text-muted`}>
      <strong>{tr('Full export')}</strong>
      <a href="/api/export/full" className="link-plain" download>{tr('Download the archive (ZIP)')}</a>
      <span>{tr('All the data (documents, revisions, working versions, circuits, Vigie requests, links, register, organisation, journal) and every file, drafts and confidential documents included, with a manifest and the SHA-256 of each item: to leave Codex or feed another system. Format: docs/export.md. The start and the end of the export are journaled. Server stopped: npm run export.')}</span>
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
  const { tr, lang } = ctx;
  if (x.error === 'interrupted') return tr('interrupted (server stopped during the run)');
  if (x.status === 'error') return x.error ?? '';
  const sum = x.summary ?? {};
  const n = (key: string, v: unknown) => (typeof v === 'number' ? tr(key).replace('{n}', String(v)) : null);
  const parts = [
    n(msg('entered into force: {n}'), sum.promoted), n(msg('decisions applied: {n}'), sum.decisions),
    n(msg('files renamed: {n}'), sum.renamed), n(msg('still provisional: {n}'), sum.provisional),
    n(msg('files removed: {n}'), sum.removed), sum.bytes ? fmtSize(Number(sum.bytes), lang) : null, sum.failed ? n(msg('failures: {n}'), sum.failed) : null, n(msg('orphans left: {n}'), sum.left),
    n(msg('files checked: {n}'), sum.checked), sum.altered ? n(msg('altered: {n}'), sum.altered) : null, sum.missing ? n(msg('missing: {n}'), sum.missing) : null,
    typeof sum.archive === 'string' ? tr('archive: {v}').replace('{v}', sum.archive) : null, sum.size ? fmtSize(Number(sum.size), lang) : null, n(msg('files: {n}'), sum.files),
    typeof sum.reason === 'string' && Object.hasOwn(SCHEDULE_REASON_LABEL, sum.reason) ? labelOf(tr, SCHEDULE_REASON_LABEL, sum.reason) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The scheduler (lib/scheduler.ts), for whoever reaches Administration: each task with its setting, its last run and the
 * next. The settings are this process's variables; the runs, those any process on the database made.
 */
async function Scheduler({ ctx }: { ctx: Ctx }) {
  const { tr, lang } = ctx;
  // The figures of each run to records managers only (summaryShown, D-14).
  const view = await schedulerOverview(ctx);
  const when = (ts: string | null) => (ts ? fmtDateTime(parisStamp(ts), lang) : null);
  return (
    <section className={styles.orphans} aria-label={tr('Scheduler')}>
      <div className={styles.orphansHead}><strong>{tr('Scheduler')}</strong></div>
      <p className="text-muted">{tr('Tasks the server runs by itself at a regular interval, each set by its environment variable (docs/exploitation.md §4). Only the deferred entry into force is on by default; the maintenance tasks wait for the hosting choices. Each run is written to the technical log, and what it changes to the audit trail, under the Codex actor.')}</p>
      {!view.enabled ? <p className={styles.filesOff}>{tr('Scheduler off (CODEX_SCHEDULER=off): approved revisions enter into force on their date only when a page is opened.')}</p> : !view.started && <p className={styles.filesOff}>{tr('The scheduler does not run in this process: approved revisions enter into force when a page is opened.')}</p>}
      <table className={`table ${styles.orphanTable}`}>
        <thead><tr><th>{tr('Task')}</th><th>{tr('Frequency')}</th><th>{tr('Last run')}</th><th>{tr('Result')}</th><th>{tr('Next')}</th></tr></thead>
        <tbody>
          {view.tasks.map((x) => (
            <tr key={x.task}>
              <td>{labelOf(tr, SCHEDULE_TASK_LABEL, x.task)}<div className="text-muted" style={sub}>{x.env}</div></td>
              <td className="nowrap">{x.interval == null ? <span className="text-muted">{tr('off')}</span> : tr('every {d}').replace('{d}', fmtInterval(x.interval, lang))}</td>
              <td className="nowrap tabnum">{when(x.lastStart) ?? <span className="text-muted">{tr('never')}</span>}</td>
              <td className={x.status === 'error' ? styles.filesOff : undefined}>
                {x.status && <>{labelOf(tr, SCHEDULE_STATUS_LABEL, x.status)}{runSummary(ctx, x) && ` · ${runSummary(ctx, x)}`}</>}
              </td>
              <td className="nowrap tabnum">{x.interval == null ? '—' : when(x.next) ?? <span className="text-muted">{tr('at the first look')}</span>}</td>
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
  const { tr, lang } = ctx;
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
  const actions = Object.keys(ACTIVITY_LABEL).map((k) => ({ key: k, label: labelOf(tr, ACTIVITY_LABEL, k) })).sort((a, b) => a.label.localeCompare(b.label, lang));
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
          <input className="input" name="doc" defaultValue={f.doc ?? ''} placeholder={tr('Document or target')} aria-label={tr('Document or target')} style={{ width: 200 }} />
          <select className="input" name="who" defaultValue={f.who ?? ''} aria-label={tr('User')} style={{ width: 'auto' }}>
            <option value="">{tr('Everyone')}</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="input" name="act" defaultValue={f.action ?? ''} aria-label={tr('Action')} style={{ width: 'auto' }}>
            <option value="">{tr('All actions')}</option>
            {actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <label className={styles.auditDay}><span className="text-muted">{tr('From')}</span><input className="input" type="date" name="from" defaultValue={f.from ?? ''} max={f.to} /></label>
          <label className={styles.auditDay}><span className="text-muted">{tr('To')}</span><input className="input" type="date" name="to" defaultValue={f.to ?? ''} min={f.from} /></label>
          <button type="submit" className="btn btn-secondary" style={step}>{tr('Apply')}</button>
          {filtered && <Link href="/administration?tab=audit" className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Clear')}</Link>}
        </Form>
      </div>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{tr('Timestamp')}</th><th>{tr('User')}</th><th>{tr('Action')}</th><th>{tr('Target')}</th><th>{tr('Detail')}</th></tr></thead>
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
          {rows.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ padding: '16px 8px' }}>{tr('No entry matches these criteria.')}</td></tr>}
        </tbody>
      </table>
      {(newer != null || older != null || at.before != null || at.after != null) && (
        <nav aria-label={tr('Pages')} className={styles.auditPager}>
          {(at.before != null || at.after != null) && <Link href={href({})} className="btn btn-ghost" style={{ fontSize: 12 }}>{tr('Most recent')}</Link>}
          <span style={{ flex: 1 }} />
          {newer != null
            ? <Link href={href({ after: String(newer) })} rel="prev" className="btn btn-secondary" style={step}><Icon name="chevronLeft" size={14} />{tr('Newer')}</Link>
            : <span className="btn btn-secondary" style={{ ...step, opacity: 0.45, cursor: 'default' }} aria-disabled="true"><Icon name="chevronLeft" size={14} />{tr('Newer')}</span>}
          {older != null
            ? <Link href={href({ before: String(older) })} rel="next" className="btn btn-secondary" style={step}>{tr('Older')}<Icon name="chevronRight" size={14} /></Link>
            : <span className="btn btn-secondary" style={{ ...step, opacity: 0.45, cursor: 'default' }} aria-disabled="true">{tr('Older')}<Icon name="chevronRight" size={14} /></span>}
        </nav>
      )}
    </>
  );
}
