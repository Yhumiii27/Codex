'use client';

import { useId, useState, type ReactNode } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import type { Attachment, Conf, Origin } from '@/db/schema';
import {
  addFunctionHolder, addOrgValue, addWorkingVersion, createDocument, decideStep, delegateStep, graftChange, recallValidation, requestChange,
  requestValidation, saveSearch, setReaders, simulateUser, simulateVigieDecision, updateMeta, updateType,
} from '@/lib/actions';
import { contextOf, idMatches, seqWidth } from '@/lib/codes';
import { ATTACHMENTS, CONF_LEVELS, ORIGINS, PROJECT_PHASES, SEARCH_SCOPES, SIM_ROLES, type T, type TKey } from '@/lib/i18n';
import { FilePicker, Modal, Select, useSubmit, type SelectOption } from './Modal';
import type { DialogData, DialogSpec, MetaDoc, VersionLite } from './types';

export function Dialogs({ spec }: { spec: DialogSpec }) {
  switch (spec.kind) {
    case 'new': return <NewDocument preset={spec.preset} />;
    case 'notes': return <Notes />;
    case 'user': return <UserSwitcher />;
    case 'working': return <WorkingVersion docId={spec.docId} nextLabel={spec.nextLabel} />;
    case 'meta': return <EditMeta doc={spec.doc} />;
    case 'validate': return <RequestValidation docId={spec.docId} title={spec.title} revLabel={spec.revLabel} circuitL={spec.circuitL} minDate={spec.minDate} />;
    case 'change': return <ChangeRequest docId={spec.docId} title={spec.title} change={spec.change} openRev={spec.openRev} />;
    case 'delegate': return <Delegate workflowId={spec.workflowId} stepName={spec.stepName} step={spec.step} excluded={spec.excluded} />;
    case 'reject': case 'recall': return <CloseWorkflow spec={spec} />;
    case 'compare': return <Compare current={spec.current} other={spec.other} />;
    case 'readers': return <Readers docId={spec.docId} readers={spec.readers} />;
    case 'vigie': return <VigieDecision requestId={spec.requestId} docTitle={spec.docTitle} change={spec.change} modifierId={spec.modifierId} drafters={spec.drafters} deferred={spec.deferred} />;
    case 'graft': return <Graft spec={spec} />;
    case 'type': return <TypeEditor type={spec.type} />;
    case 'holder': return <AddHolder functionKey={spec.functionKey} functionLabel={spec.functionLabel} scope={spec.scope} />;
    case 'org': return <AddOrg what={spec.what} />;
    case 'saveSearch': return <SaveSearch spec={spec} />;
  }
}

// ── Shared bits ─────────────────────────────────────────────────────────

function Actions({ pending, label, onCancel, form, disabled }: { pending: boolean; label: string; onCancel: () => void; form?: string; disabled?: boolean }) {
  const { t } = useApp();
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{t.cancel}</button>
      <button type={form ? 'submit' : 'button'} form={form} className="btn btn-primary" disabled={pending || disabled}>{label}</button>
    </>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null;
}

/**
 * A labelled field. Pass a function to receive the id of the control the label names (input, select, textarea); any
 * other content (segments, radios, check boxes, read-only text) becomes a group named by the label.
 */
function Field({ label, children, span, hint, radio }: { label: ReactNode; children: ReactNode | ((id: string) => ReactNode); span?: boolean; hint?: ReactNode; radio?: boolean }) {
  const id = useId();
  return (
    <div className={span ? 'field span-2' : 'field'}>
      {typeof children === 'function'
        ? <><label htmlFor={id}>{label}</label>{children(id)}</>
        : <><span id={id} className="field-label">{label}</span><div role={radio ? 'radiogroup' : 'group'} aria-labelledby={id}>{children}</div></>}
      {hint && <div className="text-muted field-hint">{hint}</div>}
    </div>
  );
}

/** Small overline that opens a group of fields inside a form grid. */
function GridSection({ children }: { children: ReactNode }) {
  return (
    <div className="span-2 text-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
      {children}
    </div>
  );
}

const codeLabel = (o: { key: string; label: string }): SelectOption => ({ key: o.key, label: `${o.key} · ${o.label}` });

function userOptions(data: DialogData, exclude?: string): SelectOption[] {
  return data.users.filter((u) => u.id !== exclude).map((u) => ({ key: u.id, label: u.department ? `${u.name} · ${u.department}` : u.name }));
}

const roleLabel = (t: T, role: string) => t[`role_${role}` as TKey] ?? role;

// ── Classification (new document, edit metadata) ─────────────────────────

type TypeOpt = DialogData['types'][number];

type Classif = {
  origin: Origin; attachment: Attachment; projectCode: string; programCode: string;
  family: string; typeCode: string; subtype: string; department: string; conf: Conf;
  /** The user picked the confidentiality: a change of type keeps it when the new type allows it. */
  confTouched: boolean;
};

const eligibleTypes = (types: TypeOpt[], origin: Origin, attachment: Attachment) =>
  types.filter((x) => x.origins.includes(origin) && x.attachments.includes(attachment));

/** Keeps the classification consistent with the register: origin, attachment, type and confidentiality the type admits. */
function normalize(types: TypeOpt[], s: Classif, lockProject: boolean): Classif {
  const origins = ORIGINS.filter((o) => types.some((x) => x.origins.includes(o) && (!lockProject || x.attachments.includes('project'))));
  const origin = origins.includes(s.origin) ? s.origin : origins[0] ?? s.origin;
  const atts = lockProject ? (['project'] as Attachment[]) : ATTACHMENTS.filter((a) => types.some((x) => x.origins.includes(origin) && x.attachments.includes(a)));
  const attachment = atts.includes(s.attachment) ? s.attachment : atts[0] ?? s.attachment;
  const el = eligibleTypes(types, origin, attachment);
  const type = el.find((x) => x.code === s.typeCode) ?? el.find((x) => x.family === s.family) ?? el[0];
  const conf = type && !type.confAllowed.includes(s.conf) ? type.confDefault : s.conf;
  return { ...s, origin, attachment, typeCode: type?.code ?? '', family: type?.family ?? s.family, conf };
}

function applyPatch(types: TypeOpt[], prev: Classif, patch: Partial<Classif>, lockProject: boolean): Classif {
  const s = normalize(types, { ...prev, ...patch }, lockProject);
  if (s.typeCode === prev.typeCode) return s;
  // Another type: its sub-types and default confidentiality apply.
  const type = types.find((x) => x.code === s.typeCode);
  const conf = type && (!prev.confTouched || !type.confAllowed.includes(s.conf)) ? type.confDefault : s.conf;
  return { ...s, subtype: '', conf };
}

/** CONTEXTE part of the ID being built (mirrors lib/codes.ts contextOf). */
function idParts(s: Classif) {
  const input = { typeCode: s.typeCode, attachment: s.attachment, projectCode: s.projectCode || null, programCode: s.programCode || null, department: s.department };
  const pending = (s.attachment === 'project' && !s.projectCode) || (s.attachment === 'research' && !s.programCode);
  return { input, prefix: `${s.typeCode}-${pending ? '…' : contextOf(input)}-`, width: seqWidth(input) };
}

function IdPrefix({ prefix, width }: { prefix: string; width: number }) {
  return (
    <span className="tabnum" style={{ color: 'var(--color-accent-300)', fontSize: 14, letterSpacing: '.02em' }}>
      {prefix}<span className="text-muted">{'#'.repeat(width)}</span>
    </span>
  );
}

/**
 * Every classification and metadata field of a document, laid out on the dialog grid.
 * Controlled where a field drives others (origin, attachment, type, confidentiality…); the rest are plain inputs.
 */
function DocFields({ types, st, set, doc, preset, withOwner, locked, lockType }: {
  /** Types the document may take (active ones, plus its current type when editing). */
  types: TypeOpt[];
  st: Classif;
  set: (patch: Partial<Classif>) => void;
  doc?: MetaDoc;
  preset?: { projectCode?: string; title?: string };
  /** Edit dialog: owner and free-text author are editable there. */
  withOwner?: boolean;
  /** Type and context are frozen (an approval workflow resolved its approvers from them); `locked` says why. */
  locked?: string;
  /** A piece Keystone expects: its type is fixed, only the origins that type admits are offered. */
  lockType?: boolean;
}) {
  const { t, lang, data } = useApp();
  const lockProject = !!preset?.projectCode;
  const origins = ORIGINS.filter((o) => types.some((x) => x.origins.includes(o) && (!lockProject || x.attachments.includes('project')) && (!lockType || x.code === st.typeCode)));
  const atts = ATTACHMENTS.filter((a) => types.some((x) => x.origins.includes(st.origin) && x.attachments.includes(a)));
  const el = eligibleTypes(types, st.origin, st.attachment);
  const families = data.families.filter((f) => el.some((x) => x.family === f.key));
  const type = types.find((x) => x.code === st.typeCode);
  const users = userOptions(data);
  const confHint = st.conf === 'restreint' ? t.conf_hint_restreint : st.conf === 'confidentiel' ? t.conf_hint_conf : st.conf === 'tres_confidentiel' ? t.conf_hint_tres : undefined;
  const segOpt = { padding: '6px 12px', fontSize: 12.5 };
  const frozen = (label: string) => <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}><span className="tag tag-neutral">{label}</span></div>;

  return (
    <div className="form-grid">
      <Field label={t.title_label} span>
        {(id) => <input id={id} className="input" name="title" defaultValue={doc?.title ?? preset?.title ?? ''} required />}
      </Field>

      {locked && <p className="text-muted span-2" role="note" style={{ margin: 0, fontSize: 12 }}>{locked}</p>}
      <input type="hidden" name="origin" value={st.origin} />
      <input type="hidden" name="attachment" value={st.attachment} />
      <Field label={t.origin}>
        {locked ? frozen(t[`or_${st.origin}`]) : <Seg name="originSeg" ariaLabel={t.origin} value={st.origin} optStyle={segOpt} options={origins.map((o) => ({ key: o, label: t[`or_${o}`] }))} onPick={(k) => set({ origin: k as Origin })} />}
      </Field>
      <Field label={t.attachment}>
        {lockProject
          ? <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}><span className="tag tag-accent">{t.att_project}</span></div>
          : locked ? frozen(t[`att_${st.attachment}`])
          : <Seg name="attachmentSeg" ariaLabel={t.attachment} value={st.attachment} optStyle={segOpt} options={atts.map((a) => ({ key: a, label: t[`att_${a}`] }))} onPick={(k) => set({ attachment: k as Attachment })} />}
      </Field>

      {st.attachment === 'project' && (
        <Field label={t.project} span>
          {lockProject || locked
            ? <><input type="hidden" name="projectCode" value={st.projectCode} /><div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>{codeLabel({ key: st.projectCode, label: data.projects.find((p) => p.key === st.projectCode)?.label ?? '' }).label}</div></>
            : (id) => <Select id={id} name="projectCode" value={st.projectCode} onChange={(v) => set({ projectCode: v })} options={data.projects.map(codeLabel)} empty="—" required />}
        </Field>
      )}
      {st.attachment === 'research' && (
        <Field label={t.program} span>
          {(id) => <><Select id={id} name={locked ? undefined : 'programCode'} value={st.programCode} onChange={(v) => set({ programCode: v })} options={data.programs.map(codeLabel)} empty="—" required disabled={!!locked} />{locked && <input type="hidden" name="programCode" value={st.programCode} />}</>}
        </Field>
      )}

      {el.length === 0 ? (
        <p className="form-error span-2">{t.no_type}</p>
      ) : (
        <>
          <Field label={t.family}>
            {(id) => <Select id={id} value={st.family} onChange={(v) => set({ family: v, typeCode: '' })} options={families} disabled={!!locked || lockType} />}
          </Field>
          <Field label={t.type} hint={type ? `${t.circuit} : ${type.circuitL}` : undefined}>
            {(id) => <><Select id={id} name={locked || lockType ? undefined : 'typeCode'} value={st.typeCode} onChange={(v) => set({ typeCode: v })} options={el.filter((x) => x.family === st.family).map((x) => ({ key: x.code, label: `${x.code} · ${x.label}` }))} required disabled={!!locked || lockType} />{(locked || lockType) && <input type="hidden" name="typeCode" value={st.typeCode} />}</>}
          </Field>
        </>
      )}
      <Field label={t.subtype} hint={type?.subtypes.length ? t.subtype_hint : undefined}>
        {(id) => <><input id={id} className="input" name="subtype" list="codex-subtypes" value={st.subtype} onChange={(e) => set({ subtype: e.target.value })} autoComplete="off" />
          <datalist id="codex-subtypes">{type?.subtypes.map((x) => <option key={x} value={x} />)}</datalist></>}
      </Field>
      <Field label={t.department}>
        {(id) => <><Select id={id} name={locked ? undefined : 'department'} value={st.department} onChange={(v) => set({ department: v })} options={data.departments.map(codeLabel)} required disabled={!!locked} />{locked && <input type="hidden" name="department" value={st.department} />}</>}
      </Field>
      <Field label={t.site_label}>
        {(id) => <Select id={id} name="site" defaultValue={doc?.site ?? ''} options={data.sites} empty="—" />}
      </Field>
      <Field label={t.conf} hint={confHint}>
        {(id) => <Select id={id} name="conf" value={st.conf} onChange={(v) => set({ conf: v as Conf, confTouched: true })} options={(type?.confAllowed ?? []).map((c) => ({ key: c, label: t[`conf_${c}`] }))} required />}
      </Field>
      <Field label={t.keywords} hint={t.keywords_hint}>
        {(id) => <input id={id} className="input" name="keywords" defaultValue={doc?.keywords.join(', ') ?? ''} />}
      </Field>
      <Field label={t.language}>
        {(id) => <Select id={id} name="lang" defaultValue={doc ? doc.lang ?? '' : lang} options={[{ key: 'fr', label: t.lang_fr }, { key: 'en', label: t.lang_en }]} empty="—" />}
      </Field>
      <Field label={t.review_due_at}>
        {(id) => <input id={id} className="input" type="date" name="reviewDueAt" defaultValue={doc?.reviewDueAt ?? ''} />}
      </Field>
      <Field label={t.expires_at}>
        {(id) => <input id={id} className="input" type="date" name="expiresAt" defaultValue={doc?.expiresAt ?? ''} />}
      </Field>

      {withOwner && (
        <>
          <Field label={t.owner}>
            {(id) => <Select id={id} name="ownerId" defaultValue={doc?.ownerId ?? data.currentUserId} options={users} required />}
          </Field>
          <Field label={t.author_text} hint={t.author_text_hint}>
            {(id) => <input id={id} className="input" name="authorText" defaultValue={doc?.authorText ?? ''} />}
          </Field>
        </>
      )}

      {st.origin === 'externe' && (
        <>
          <GridSection>{t.ctx_externe}</GridSection>
          <Field label={t.source_org}>
            {(id) => <input id={id} className="input" name="sourceOrg" defaultValue={doc?.sourceOrg ?? ''} required />}
          </Field>
          <Field label={t.external_ref}>
            {(id) => <input id={id} className="input" name="externalRef" defaultValue={doc?.externalRef ?? ''} />}
          </Field>
          <Field label={t.received_at}>
            {(id) => <input id={id} className="input" type="date" name="receivedAt" defaultValue={doc?.receivedAt ?? ''} />}
          </Field>
          {!withOwner && (
            <Field label={t.author_text} hint={t.author_text_hint}>
              {(id) => <input id={id} className="input" name="authorText" />}
            </Field>
          )}
        </>
      )}
      {st.attachment === 'project' && (
        <>
          <GridSection>{t.ctx_project}</GridSection>
          <Field label={t.project_phase}>
            {(id) => <><input id={id} className="input" name="projectPhase" list="codex-phases" defaultValue={doc?.projectPhase ?? ''} autoComplete="off" />
              <datalist id="codex-phases">{PROJECT_PHASES.map((k) => <option key={k} value={k} />)}</datalist></>}
          </Field>
          <Field label={t.work_package}>
            {(id) => <input id={id} className="input" name="workPackage" defaultValue={doc?.workPackage ?? ''} />}
          </Field>
          <Field label={t.discipline}>
            {(id) => <input id={id} className="input" name="discipline" defaultValue={doc?.discipline ?? ''} />}
          </Field>
        </>
      )}
      {st.attachment === 'research' && (
        <>
          <GridSection>{t.ctx_research}</GridSection>
          <Field label={t.research_theme}>
            {(id) => <input id={id} className="input" name="researchTheme" defaultValue={doc?.researchTheme ?? ''} />}
          </Field>
          <Field label={t.study_id}>
            {(id) => <input id={id} className="input" name="studyId" defaultValue={doc?.studyId ?? ''} />}
          </Field>
          <Field label={t.ip_status}>
            {(id) => <input id={id} className="input" name="ipStatus" defaultValue={doc?.ipStatus ?? ''} />}
          </Field>
        </>
      )}
      {st.origin === 'interne' && (
        <>
          <GridSection>{t.ctx_interne}</GridSection>
          <Field label={t.process_owner}>
            {(id) => <Select id={id} name="processOwnerId" defaultValue={doc?.processOwnerId ?? ''} options={users} empty="—" />}
          </Field>
        </>
      )}
    </div>
  );
}

// ── New document ────────────────────────────────────────────────────────

type NewPreset = Extract<DialogSpec, { kind: 'new' }>['preset'];
type Mode = 'template' | 'file' | 'blank';

function NewDocument({ preset }: { preset: NewPreset }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  const lockProject = !!preset?.projectCode;
  const types = data.types.filter((x) => x.active);
  // Explicit mode first; otherwise a preset (piece expected by Keystone, new template…) usually comes with its own file.
  const [mode, setMode] = useState<Mode>(preset?.mode ?? (preset?.templateId || (!preset?.projectCode && !preset?.typeCode && data.templates.length) ? 'template' : 'file'));
  const [tplId, setTplId] = useState(preset?.templateId ?? data.templates[0]?.id ?? '');
  const [st, setSt] = useState<Classif>(() => {
    const presetType = types.find((x) => x.code === preset?.typeCode);
    const s = normalize(types, {
      origin: presetType && !presetType.origins.includes('interne') ? presetType.origins[0] : 'interne',
      attachment: lockProject ? 'project' : 'none',
      projectCode: preset?.projectCode ?? '', programCode: '',
      family: presetType?.family ?? '', typeCode: preset?.typeCode ?? '', subtype: '',
      department: data.currentDepartment ?? data.departments[0]?.key ?? '',
      conf: 'interne', confTouched: false,
    }, lockProject);
    const type = types.find((x) => x.code === s.typeCode);
    return type ? { ...s, conf: type.confDefault } : s;
  });
  const set = (patch: Partial<Classif>) => setSt((prev) => applyPatch(types, prev, patch, lockProject));
  const { prefix, width } = idParts(st);
  // A piece Keystone expects is filled by a document of its type only (createDocument refuses any other).
  const lockType = preset?.expectedId != null && !!preset.typeCode && st.typeCode === preset.typeCode;

  return (
    <Modal title={t.new_doc} width={680} actions={<Actions pending={pending} label={t.create_doc} onCancel={close} form="new-form" disabled={!st.typeCode || (mode === 'template' && !tplId)} />}>
      <form
        id="new-form"
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => createDocument(fd)); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {lockProject && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span className="tag tag-accent">{preset!.projectCode}</span>
            {preset?.label && <span className="text-muted">{t.deposit_for} : {preset.label}</span>}
            {preset?.expectedId != null && <input type="hidden" name="expectedId" value={preset.expectedId} />}
          </div>
        )}

        <Field label={t.initial_content}>
          <Seg
            name="createMode"
            ariaLabel={t.initial_content}
            value={mode}
            optStyle={{ padding: '6px 12px', fontSize: 12.5 }}
            options={[{ key: 'template', label: t.from_template }, { key: 'file', label: t.from_file }, { key: 'blank', label: t.blank_doc }]}
            onPick={(k) => setMode(k as Mode)}
          />
        </Field>
        {mode === 'template' && (
          <Field label={t.choose_tpl} radio>
            <input type="hidden" name="templateId" value={tplId} />
            {data.templates.length === 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.tpl_none}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 186, overflow: 'auto' }}>
              {data.templates.map((x) => (
                <label key={x.id} className="radio hover-tint" style={{ padding: '7px 8px', borderRadius: 'var(--radius-md)', gap: 10 }}>
                  <input type="radio" name="tpl" checked={tplId === x.id} onChange={() => setTplId(x.id)} /><span className="dot" />
                  <span className="ellipsis" style={{ flex: 1, fontSize: 13 }}>{x.label}</span>
                  <span className="text-muted nowrap" style={{ fontSize: 11 }}>{x.id} · {t.revision} {x.rev} · {x.owner}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        {mode === 'file' && <FilePicker label={t.choose_file} required />}
        {mode === 'blank' && <div className="text-muted" style={{ fontSize: 12.5 }}>{t.blank_hint}</div>}

        <DocFields types={types} st={st} set={set} preset={preset} lockType={lockType} />

        {st.typeCode && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{t.id_preview}</span>
            <IdPrefix prefix={prefix} width={width} />
            <span className="text-muted sub">{t.id_seq_hint}</span>
          </div>
        )}
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// ── Edit metadata ───────────────────────────────────────────────────────

function EditMeta({ doc }: { doc: MetaDoc }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // A type withdrawn from the register stays available to the documents that already have it.
  const types = data.types.filter((x) => x.active || x.code === doc.typeCode);
  const [st, setSt] = useState<Classif>(() => normalize(types, {
    origin: doc.origin, attachment: doc.attachment, projectCode: doc.projectCode ?? '', programCode: doc.programCode ?? '',
    family: types.find((x) => x.code === doc.typeCode)?.family ?? '', typeCode: doc.typeCode, subtype: doc.subtype ?? '',
    department: doc.department, conf: doc.conf, confTouched: true,
  }, false));
  const set = (patch: Partial<Classif>) => setSt((prev) => applyPatch(types, prev, patch, false));
  const { input, prefix, width } = idParts(st);
  const moved = !!st.typeCode && !idMatches(doc.id, input);

  return (
    <Modal title={t.edit_meta} width={680} actions={<Actions pending={pending} label={t.save} onCancel={close} form="meta-form" disabled={!st.typeCode} />}>
      <form
        id="meta-form"
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => updateMeta(fd)); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <input type="hidden" name="docId" value={doc.id} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span className="tag tag-neutral tabnum">{doc.id}</span>
          {moved && doc.idMayChange && (
            <span style={{ color: 'var(--color-accent-300)' }} role="status">
              {t.id_will_change} → <IdPrefix prefix={prefix} width={width} />
            </span>
          )}
          {moved && !doc.idMayChange && <span className="text-muted">{t.id_frozen}</span>}
        </div>
        <DocFields types={types} st={st} set={set} doc={doc} withOwner locked={doc.classificationLocked ? t.circuit_running : undefined} />
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// ── Working version, approval, change requests ───────────────────────────

function WorkingVersion({ docId, nextLabel }: { docId: string; nextLabel: string }) {
  const { t, close } = useApp();
  const { pending, error, run } = useSubmit();
  return (
    <Modal title={t.new_working_version} actions={<Actions pending={pending} label={t.upload} onCancel={close} form="working-form" />}>
      <form id="working-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => addWorkingVersion(fd)); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="docId" value={docId} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span className="tag tag-neutral tabnum">{docId}</span>
          <span className="text-muted" style={{ marginLeft: 'auto' }}>{t.working_version} → <span style={{ color: 'var(--color-accent-300)' }}>{nextLabel}</span></span>
        </div>
        <FilePicker label={t.choose_file} required />
        <Field label={t.version_comment}>{(id) => <textarea id={id} className="input" name="comment" rows={3} />}</Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function RequestValidation({ docId, title, revLabel, circuitL, minDate }: { docId: string; title: string; revLabel: string; circuitL: string; minDate: string }) {
  const { t, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [effective, setEffective] = useState('');
  return (
    <Modal
      title={t.request_title}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => requestValidation(docId, effective || null))}>{t.request_validation}</button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{title}</div>
        <div className="text-muted sub tabnum">{docId} · {t.revision} {revLabel}</div>
      </div>
      <Field label={t.circuit}>
        <div style={{ fontSize: 13 }}>{t.step_author} → {circuitL}</div>
      </Field>
      <Field label={t.effective_at} hint={t.effective_hint}>
        {(id) => <input id={id} className="input" type="date" min={minDate} value={effective} onChange={(e) => setEffective(e.target.value)} />}
      </Field>
      <ErrorLine error={error} />
    </Modal>
  );
}

function ChangeRequest({ docId, title, change, openRev }: { docId: string; title: string; change: 'modification' | 'obsolescence'; openRev?: { letter: string; status: 'draft' | 'in_review' | 'approved' } }) {
  const { t, lang, close } = useApp();
  const { pending, error, run } = useSubmit();
  return (
    <Modal title={change === 'modification' ? t.request_change : t.request_obsolete} actions={<Actions pending={pending} label={t.send} onCancel={close} form="change-form" />}>
      <form
        id="change-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(() => requestChange(docId, change, String(fd.get('reason') ?? ''), String(fd.get('description') ?? '')));
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{title}</div>
          <div className="text-muted sub tabnum">{docId}</div>
        </div>
        {/* A change asked while a revision is open waits for its entry into force, or is grafted onto it while it is drafted (D-26). */}
        {change === 'modification' && openRev ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>
            {t.change_hint_sent} {t.change_hint_open} ({t.rev_short} {openRev.letter}, {t[`open_rev_${openRev.status}`]}). {t.change_hint_open_wait} {openRev.letter}
            {openRev.status === 'draft' ? `${lang === 'fr' ? ' ;' : ';'} ${t.change_hint_open_graft}` : ''}.
          </p>
        ) : (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{change === 'modification' ? t.change_hint_modification : t.change_hint_obsolescence}</p>
        )}
        <Field label={t.ecr_reason}>{(id) => <input id={id} className="input" name="reason" maxLength={300} required />}</Field>
        <Field label={t.ecr_description}>{(id) => <textarea id={id} className="input" name="description" rows={4} maxLength={4000} />}</Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function Delegate({ workflowId, stepName, step, excluded }: { workflowId: string; stepName: string; step: number; excluded: string[] }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // Only people who may decide this step: never the author or requester, always someone whose role can approve.
  const others = userOptions(data, data.currentUserId).filter((o) => !excluded.includes(o.key) && data.users.find((u) => u.id === o.key)?.approver);
  const [to, setTo] = useState(others[0]?.key ?? '');
  return (
    <Modal
      title={t.delegate_title}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending || !to} onClick={() => run(() => delegateStep(workflowId, to, step), { staleError: t.wrong_step })}>{t.delegate}</button>
      </>}
    >
      <div className="text-muted" style={{ fontSize: 12.5 }}>{t.step} : {stepName}</div>
      <Field label={t.delegate_to}>{(id) => <Select id={id} name="to" value={to} onChange={setTo} options={others} />}</Field>
      <ErrorLine error={error} />
    </Modal>
  );
}

/**
 * Rejects the current step, with its reason, or recalls the request, with an optional one (lib/actions.ts decideStep,
 * recallValidation). A circuit that moved on in the meantime closes the dialog and refreshes the page.
 */
function CloseWorkflow({ spec }: { spec: Extract<DialogSpec, { kind: 'reject' | 'recall' }> }) {
  const { t, close } = useApp();
  const { pending, error, run } = useSubmit();
  const reject = spec.kind === 'reject';
  return (
    <Modal title={reject ? t.reject_title : t.recall_title} actions={<Actions pending={pending} label={reject ? t.reject : t.recall} onCancel={close} form="close-workflow-form" />}>
      <form
        id="close-workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const why = String(new FormData(e.currentTarget).get('reason') ?? '');
          run(() => (reject ? decideStep(spec.workflowId, false, spec.step, why) : recallValidation(spec.workflowId, spec.step, why)), { staleError: t.wrong_step });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId} · {t.revision} {spec.letter} · {t.step} : {spec.stepName}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{reject ? t.reject_hint : t.recall_hint}</p>
        <Field label={reject ? t.ecr_reason : t.reason_optional}>
          {(id) => <textarea id={id} className="input" name="reason" rows={4} maxLength={2000} required={reject} />}
        </Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function Compare({ current, other }: { current: VersionLite; other: VersionLite }) {
  const { t, close } = useApp();
  const rows: [string, (v: VersionLite) => string][] = [
    [t.working_version, (v) => v.label], [t.date, (v) => v.dateF], [t.author, (v) => v.author], [t.version_comment, (v) => v.commentL],
    [t.file, (v) => v.fileName ?? '—'], [t.size, (v) => v.sizeF], [t.pages, (v) => (v.pages ? String(v.pages) : '—')],
  ];
  return (
    <Modal title={t.compare_title} width={620} actions={<button type="button" className="btn btn-primary" onClick={close}>{t.close}</button>}>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th /><th>{t.selected_version}</th><th>{t.current_version}</th></tr></thead>
        <tbody>
          {rows.map(([label, get]) => {
            const a = get(other), b = get(current);
            return <tr key={label}><td className="text-muted nowrap">{label}</td><td>{a}</td><td style={{ color: a !== b ? 'var(--color-accent-300)' : undefined }}>{b}</td></tr>;
          })}
        </tbody>
      </table>
    </Modal>
  );
}

function Readers({ docId, readers }: { docId: string; readers: string[] }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [sel, setSel] = useState(() => new Set(readers));
  const toggle = (id: string) => setSel((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <Modal
      title={t.readers}
      width={600}
      actions={<>
        <span className="text-muted" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>{sel.size} {t.selected}</span>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => setReaders(docId, [...sel]))}>{t.save}</button>
      </>}
    >
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.readers_hint}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 12px', maxHeight: 340, overflow: 'auto' }}>
        {data.users.map((u) => (
          <label key={u.id} className="hover-tint" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '5px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} style={{ margin: 0 }} />
            <span className="ellipsis" style={{ flex: 1 }}>{u.name}</span>
            {u.department && <span className="text-muted sub">{u.department}</span>}
          </label>
        ))}
      </div>
      <ErrorLine error={error} />
    </Modal>
  );
}

function VigieDecision({ requestId, docTitle, change, modifierId, drafters, deferred }: { requestId: string; docTitle: string; change: 'modification' | 'obsolescence'; modifierId: string; drafters: string[]; deferred?: string }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // On an archived, obsolete or frozen document, or for a change while a revision is open, an acceptance is recorded
  // and applies later (`deferred` says when).
  const [accept, setAccept] = useState(true);
  // Only the people who may draft the document, as the server checks (lib/lifecycle.ts, mayDraft).
  const users = userOptions(data).filter((o) => drafters.includes(o.key));
  const [modifier, setModifier] = useState(users.some((o) => o.key === modifierId) ? modifierId : users[0]?.key ?? '');
  const designate = accept && change === 'modification';
  return (
    <Modal
      title={t.vigie_sim}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending || (designate && !modifier)} onClick={() => run(() => simulateVigieDecision(requestId, accept, designate ? modifier : null))}>
          {accept ? t.vigie_accept : t.vigie_reject}
        </button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{docTitle}</div>
        <div className="text-muted sub tabnum">{requestId} · {t[`kind_${change}`]}</div>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.vigie_hint}</p>
      <Field label={t.vigie_decision} radio hint={accept ? deferred : undefined}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {([true, false] as const).map((v) => (
            <label key={String(v)} className="radio" style={{ fontSize: 13 }}>
              <input type="radio" name="decision" checked={accept === v} onChange={() => setAccept(v)} /><span className="dot" />{v ? t.ecr_accepted : t.ecr_rejected}
            </label>
          ))}
        </div>
      </Field>
      {designate && (
        <Field label={t.modifier} hint={t.vigie_modifier_hint}>{(id) => <Select id={id} name="modifier" value={modifier} onChange={setModifier} options={users} />}</Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

/** Confirms the graft of an accepted change onto the revision being drafted (lib/actions.ts graftChange, D-26). */
function Graft({ spec }: { spec: Extract<DialogSpec, { kind: 'graft' }> }) {
  const { t, close } = useApp();
  const { pending, error, run } = useSubmit();
  return (
    <Modal
      title={`${t.graft_on} ${spec.letter}`}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => graftChange(spec.requestId))}>{t.graft_confirm}</button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{spec.title}</div>
        <div className="text-muted sub tabnum">{spec.docId} · {t.revision} {spec.letter} · {spec.ecoRef}</div>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.graft_hint}</p>
      <Field label={t.ecr_reason}><div style={{ fontSize: 13 }}>{spec.reason}</div></Field>
      <Field label={`${t.graft_author} ${spec.letter}`}><div style={{ fontSize: 13 }}>{spec.author}</div></Field>
      {spec.vigieModifier && (
        <Field label={t.graft_vigie_modifier} hint={t.graft_vigie_modifier_hint}><div style={{ fontSize: 13 }}>{spec.vigieModifier}</div></Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

// ── Notes and session simulation ─────────────────────────────────────────

const NOTES: Record<'fr' | 'en', [string, string][]> = {
  fr: [
    ['Source de vérité.', 'Codex est la GED du groupe EPC2I et fait foi pour les métadonnées, les droits, les révisions, les circuits de validation et le journal d’audit. Les fichiers sont rangés derrière une interface de stockage unique (disque local, ou bibliothèque SharePoint pilotée par Codex). Keystone fournit les projets et lit le registre des types.'],
    ['Classement.', 'Deux axes indépendants — Origine (interne / externe) et Rattachement (aucun, projet Keystone, programme de recherche) — puis Famille › Type › Sous-type, Département et Site. Chaque type du registre fixe les origines et rattachements admis, le circuit de validation, la conservation et la confidentialité.'],
    ['Identifiant.', 'TYPE-CONTEXTE-SEQ, attribué à la création : code projet (PID-HLT-026-001), code programme (PRT-R2601-004), QMS pour les modèles (FRM-QMS-012), sinon le département propriétaire sur quatre chiffres (PRO-QUA-0001). Avant la première approbation, un reclassement recalcule l’identifiant et garde l’ancien comme alias ; ensuite il ne change plus.'],
    ['Révisions.', 'En lettres (A, B…), avec des versions de travail A.1, A.2… pendant la rédaction. Brouillon → En révision → Approuvé → En vigueur (à la date d’effet) ; la révision précédente est remplacée. Le circuit du type est fait de fonctions résolues au lancement ; ni l’auteur de la révision ni le demandeur ne la valident.'],
    ['Vigie.', 'Les demandes de modification (ECR / ECO) et de retrait partent vers Vigie, qui décide : un ECO accepté ouvre la révision suivante en brouillon pour le modificateur désigné, un retrait accepté rend le document obsolète. Tant que Vigie n’est pas branché, un gestionnaire documentaire simule la décision.'],
    ['Confidentialité.', 'Public < Restreint (client ou partenaire désigné) < Interne < Confidentiel (département ou équipe projet) < Très confidentiel (lecteurs désignés). Brouillons et versions de travail restent visibles du seul cercle de rédaction : propriétaire, modificateur, valideurs en cours et gestionnaires documentaires.'],
    ['Simulation.', 'Pas d’authentification pour l’instant : choisissez la personne et le rôle simulés depuis le profil en bas de la barre latérale ; navigation, droits et visibilité suivent. Interface bilingue FR / EN ; les titres des documents restent dans leur langue.'],
  ],
  en: [
    ['Source of truth.', 'Codex is the EPC2I group’s document management system and the reference for metadata, permissions, revisions, approval workflows and the audit trail. Files sit behind a single storage interface (local disk, or a SharePoint library driven by Codex). Keystone provides the projects and reads the type register.'],
    ['Classification.', 'Two independent axes — Origin (internal / external) and Attachment (none, Keystone project, research programme) — then Family › Type › Sub-type, Department and Site. Each type of the register sets the origins and attachments it admits, its approval workflow, retention and confidentiality.'],
    ['Identifier.', 'TYPE-CONTEXT-SEQ, assigned on creation: project code (PID-HLT-026-001), programme code (PRT-R2601-004), QMS for templates (FRM-QMS-012), otherwise the owning department with four digits (PRO-QUA-0001). Before the first approval a reclassification recalculates the ID and keeps the old one as an alias; afterwards it never changes.'],
    ['Revisions.', 'Lettered (A, B…), with working versions A.1, A.2… while drafting. Draft → In review → Approved → In force (on the effective date); the previous revision is superseded. The type’s workflow is made of functions resolved at launch; neither the revision’s author nor the requester approves it.'],
    ['Vigie.', 'Change requests (ECR / ECO) and withdrawal requests go to Vigie, which decides: an accepted ECO opens the next revision as a draft for the designated author, an accepted withdrawal makes the document obsolete. Until Vigie is connected, a records manager simulates the decision.'],
    ['Confidentiality.', 'Public < Restricted (designated client or partner) < Internal < Confidential (department or project team) < Highly confidential (named readers). Drafts and working versions stay visible to the drafting circle only: owner, designated author, current approvers and records managers.'],
    ['Simulation.', 'No sign-in yet: pick the simulated person and role from the profile at the bottom of the sidebar; navigation, permissions and visibility follow. Bilingual FR / EN interface; document titles stay in their own language.'],
  ],
};

function Notes() {
  const { t, lang, close } = useApp();
  return (
    <Modal title={t.notes} width={560} actions={<button type="button" className="btn btn-primary" onClick={close}>{t.close}</button>}>
      <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {NOTES[lang].map(([head, body]) => (
          <p key={head} style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>{head}</strong> {body}</p>
        ))}
      </div>
    </Modal>
  );
}

function UserSwitcher() {
  const { t, data, close } = useApp();
  const [userId, setUserId] = useState(data.currentUserId);
  const [role, setRole] = useState(data.currentRole);
  const { pending, error, run } = useSubmit();
  const deptLabel = (code: string | null) => (code ? `${code} · ${data.departments.find((d) => d.key === code)?.label ?? code}` : '—');
  const order = (code: string | null) => { const i = data.departments.findIndex((d) => d.key === code); return i < 0 ? data.departments.length : i; };
  // People grouped by department, in the organisation's order.
  const options = [...data.users]
    .sort((a, b) => order(a.department) - order(b.department) || a.name.localeCompare(b.name))
    .map((u) => ({ key: u.id, label: u.name, group: deptLabel(u.department) }));
  const picked = data.users.find((u) => u.id === userId);
  return (
    <Modal
      title={t.sim_title}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => simulateUser(userId, role))}>{t.apply}</button>
      </>}
    >
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.sim_hint}</p>
      <Field label={t.sim_user} hint={picked && `${t.department} : ${deptLabel(picked.department)} · ${t.default_role} : ${roleLabel(t, picked.role)}`}>
        {(id) => <Select id={id} name="user" value={userId} onChange={(v) => { setUserId(v); setRole(data.users.find((u) => u.id === v)?.role ?? role); }} options={options} />}
      </Field>
      <Field label={t.sim_role} radio>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SIM_ROLES.map((r) => (
            <label key={r} className="radio hover-tint" style={{ padding: '6px 8px', borderRadius: 'var(--radius-md)', gap: 10, fontSize: 13 }}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} /><span className="dot" />{t[`role_${r}`]}
            </label>
          ))}
        </div>
      </Field>
      <ErrorLine error={error} />
    </Modal>
  );
}

// ── Administration ──────────────────────────────────────────────────────

const TRIGGERS = ['creation', 'in_force', 'superseded', 'project_end', 'contract_end', 'fiscal_year_end', 'expiry', 'asset_life', 'employee_departure', 'permanent'] as const;
const DISPOSITIONS = ['destroy', 'review', 'archive', 'permanent'] as const;

type TypeSpec = Extract<DialogSpec, { kind: 'type' }>['type'];

function TypeEditor({ type }: { type: TypeSpec }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [circuit, setCircuit] = useState<string[]>(type.circuit);
  const [allowed, setAllowed] = useState<Conf[]>(type.confAllowed);
  const [confDefault, setConfDefault] = useState<Conf>(type.confDefault);
  const [active, setActive] = useState(type.active);
  const free = data.functions.filter((f) => !circuit.includes(f.key));
  const [addKey, setAddKey] = useState(free[0]?.key ?? '');
  const fn = (k: string) => data.functions.find((f) => f.key === k);
  const move = (i: number, d: -1 | 1) => setCircuit((xs) => { const ys = [...xs]; [ys[i], ys[i + d]] = [ys[i + d], ys[i]]; return ys; });
  const remove = (i: number) => setCircuit((xs) => xs.filter((_, j) => j !== i));
  const add = () => {
    if (!addKey || circuit.includes(addKey)) return;
    const next = [...circuit, addKey];
    setCircuit(next);
    setAddKey(data.functions.find((f) => !next.includes(f.key))?.key ?? '');
  };
  const toggleConf = (c: Conf) => {
    const next = CONF_LEVELS.filter((x) => (x === c ? !allowed.includes(c) : allowed.includes(x)));
    setAllowed(next);
    if (!next.includes(confDefault) && next.length) setConfDefault(next[0]);
  };
  const iconBtn = { width: 26, height: 26 };

  return (
    <Modal title={`${type.code} — ${type.label}`} width={620} actions={<Actions pending={pending} label={t.save} onCancel={close} form="type-form" disabled={!allowed.length} />}>
      <form id="type-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => updateType(fd)); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="code" value={type.code} />
        {circuit.map((k) => <input key={k} type="hidden" name="circuit" value={k} />)}
        <input type="hidden" name="active" value={active ? 'on' : 'off'} />

        <Field label={t.circuit_steps}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <li className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', fontSize: 13 }}>
              <span className="tabnum" style={{ width: 14 }}>0</span><span>{t.step_author}</span>
            </li>
            {circuit.map((k, i) => {
              const f = fn(k);
              return (
                <li key={k} className="hover-tint" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 2px 8px', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
                  <span className="text-muted tabnum" style={{ width: 14 }}>{i + 1}</span>
                  <span className="ellipsis" style={{ flex: 1 }}>{f?.label ?? k}</span>
                  {f && <span className="tag tag-neutral" style={{ padding: '1px 7px', fontSize: 10 }}>{t[`scope_${f.scope}`]}</span>}
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.move_up} title={t.move_up}>
                    <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === circuit.length - 1} onClick={() => move(i, 1)} aria-label={t.move_down} title={t.move_down}>
                    <Icon name="chevronDown" size={14} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} onClick={() => remove(i)} aria-label={t.remove} title={t.remove}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
          </ol>
          {circuit.length === 0 && <div className="text-muted field-hint" style={{ paddingLeft: 8 }}>{t.no_approval}</div>}
          {free.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Select value={addKey} onChange={setAddKey} options={free.map((f) => ({ key: f.key, label: f.label }))} ariaLabel={t.add_step} />
              <button type="button" className="btn btn-secondary nowrap" onClick={add} disabled={!addKey}><Icon name="plus" size={14} />{t.add_step}</button>
            </div>
          )}
        </Field>

        <div className="form-grid">
          <Field label={t.conf_allowed}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {CONF_LEVELS.map((c) => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" name="confAllowed" value={c} checked={allowed.includes(c)} onChange={() => toggleConf(c)} style={{ margin: 0 }} />{t[`conf_${c}`]}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t.conf_default}>
            {(id) => <Select id={id} name="confDefault" value={confDefault} onChange={(v) => setConfDefault(v as Conf)} options={allowed.map((c) => ({ key: c, label: t[`conf_${c}`] }))} required />}
          </Field>
          <GridSection>{t.retention_rule}</GridSection>
          <Field label={t.years}>
            {(id) => <input id={id} className="input" type="number" name="retentionYears" min={0} max={200} defaultValue={type.retentionYears ?? ''} />}
          </Field>
          <Field label={t.trigger}>
            {(id) => <Select id={id} name="retentionTrigger" defaultValue={type.retentionTrigger} options={TRIGGERS.map((k) => ({ key: k, label: t[`trig_${k}`] }))} />}
          </Field>
          <Field label={t.disposition}>
            {(id) => <Select id={id} name="retentionDisposition" defaultValue={type.retentionDisposition} options={DISPOSITIONS.map((k) => ({ key: k, label: t[`disp_${k}`] }))} />}
          </Field>
          {type.retentionBasis && (
            <Field label={t.retention_basis}>
              <div className="text-muted" style={{ fontSize: 12 }}>{type.retentionBasis}</div>
            </Field>
          )}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ margin: 0 }} />{t.type_active}
        </label>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function AddHolder({ functionKey, functionLabel, scope }: { functionKey: string; functionLabel: string; scope: 'global' | 'department' | 'project' | 'research' }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // A holder decides approval steps: only people whose role may approve.
  const users = userOptions(data).filter((o) => data.users.find((u) => u.id === o.key)?.approver);
  const [userId, setUserId] = useState(users[0]?.key ?? '');
  const values = scope === 'department' ? data.departments : scope === 'project' ? data.projects : scope === 'research' ? data.programs : [];
  const [scopeValue, setScopeValue] = useState(scope === 'department' && data.currentDepartment ? data.currentDepartment : values[0]?.key ?? '');
  const scopeLabel = scope === 'department' ? t.department : scope === 'project' ? t.project : t.program;
  return (
    <Modal
      title={`${t.add_holder} — ${functionLabel}`}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={pending || !userId} onClick={() => run(() => addFunctionHolder(functionKey, scope === 'global' ? null : scopeValue || null, userId))}>{t.add_value}</button>
      </>}
    >
      <div className="text-muted" style={{ fontSize: 12.5 }}>{t[`scope_${scope}`]}</div>
      <Field label={t.user}>{(id) => <Select id={id} name="userId" value={userId} onChange={setUserId} options={users} />}</Field>
      {scope !== 'global' && (
        <Field label={scopeLabel}>
          {(id) => <Select id={id} name="scopeValue" value={scopeValue} onChange={setScopeValue} options={values.map(codeLabel)} empty={t.scope_global} />}
        </Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

function AddOrg({ what }: { what: 'department' | 'site' }) {
  const { t, close } = useApp();
  const { pending, error, run } = useSubmit();
  return (
    <Modal title={what === 'department' ? t.new_department : t.new_site} actions={<Actions pending={pending} label={t.create} onCancel={close} form="org-form" />}>
      <form
        id="org-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const s = (k: string) => String(fd.get(k) ?? '');
          run(() => addOrgValue(what, s('code'), s('labelFr'), s('labelEn')));
        }}
      >
        {what === 'department' ? (
          <div className="form-grid">
            <Field label={t.dept_code} hint={t.dept_code_hint} span>
              {(id) => <input id={id} className="input tabnum" name="code" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" autoComplete="off" style={{ textTransform: 'uppercase', maxWidth: 120 }} />}
            </Field>
            <Field label={t.label_fr}>{(id) => <input id={id} className="input" name="labelFr" required />}</Field>
            <Field label={t.label_en}>{(id) => <input id={id} className="input" name="labelEn" />}</Field>
          </div>
        ) : (
          <Field label={t.site_label}>{(id) => <input id={id} className="input" name="labelFr" required />}</Field>
        )}
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

/**
 * Saves the criteria of /recherche under a label (lib/actions.ts saveSearch): personal, or, for those who may share,
 * with a department (the user's own by default) or the whole group.
 */
function SaveSearch({ spec }: { spec: Extract<DialogSpec, { kind: 'saveSearch' }> }) {
  const { t, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [scope, setScope] = useState<(typeof SEARCH_SCOPES)[number]>('personal');
  const [department, setDepartment] = useState(data.currentDepartment ?? data.departments[0]?.key ?? '');
  return (
    <Modal title={t.search_save} actions={<Actions pending={pending} label={t.save} onCancel={close} form="save-search-form" disabled={scope === 'department' && !department} />}>
      <form
        id="save-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const label = String(new FormData(e.currentTarget).get('label') ?? '');
          run(() => saveSearch(label, spec.q, spec.facets, scope, scope === 'department' ? department : null));
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={t.search_label}>{(id) => <input id={id} className="input" name="label" required maxLength={80} autoComplete="off" />}</Field>
        <Field label={t.search_criteria}>
          <ul className="text-muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {spec.criteria.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Field>
        {spec.mayShare ? (
          <>
            <Field label={t.search_scope} radio>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {SEARCH_SCOPES.map((k) => (
                  <label key={k} className="radio" style={{ fontSize: 13 }}>
                    <input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} /><span className="dot" />{t[`search_scope_${k}`]}
                  </label>
                ))}
              </div>
            </Field>
            {scope === 'department' && (
              <Field label={t.department}>{(id) => <Select id={id} name="department" value={department} onChange={setDepartment} options={data.departments.map(codeLabel)} />}</Field>
            )}
          </>
        ) : (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.search_personal_only}</p>
        )}
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{t.search_save_hint}</p>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}
