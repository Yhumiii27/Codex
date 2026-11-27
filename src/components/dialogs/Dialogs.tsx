'use client';

import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@norma/charte/ds/Segmented';
import type { Attachment, Conf, LinkRel, Origin } from '@/db/schema';
import {
  addDocLink, addFunctionHolder, addOrgValue, addWorkingVersion, createDocument, createFamily, createFunction, createProgram, createType, decideStep,
  addVocabTerm, delegateStep, deleteFamily, mergeVocabTerms, reassignStep, renameVocabTerm, deleteFunction, deleteOrgValue, deleteProgram, deleteType, graftChange, recallValidation, recordReview, requestChange, requestValidation,
  saveSearch, setDepartmentFeatured, setReaders, setRetentionClass, setRetentionEvent, setTemplateTypes, simulateUser, simulateVigieDecision, updateFamily, updateFunction, updateMeta, updateOrgValue, updateProgram, updateType,
} from '@/lib/actions';
import { contextOf, idMatches, seqWidth, TEMPLATE_TYPE } from '@/lib/codes';
import type { CompareResult } from '@/lib/compare';
import { DEFAULT_FEATURED, FEATURABLE, MAX_FEATURED } from '@/lib/departments';
import { fmtDate } from '@/lib/format';
import { ATTACHMENTS, CONF_LEVELS, ORIGINS, PROJECT_PHASES, PROJECT_PHASES_EN, SEARCH_SCOPES, SIM_ROLES } from '@/lib/i18n';
import { markInactive, newDocDepartment, offered, type OrgKind } from '@/lib/org-rules';
import { sameRule } from '@/lib/retention';
import { reviewDueHint } from '@/lib/review';
import { BUILT_IN_SCOPES, DISPOSITIONS, FAMILY_GROUPS, FUNCTION_SCOPES, RETENTION_TRIGGERS } from '@/lib/registry-rules';
import { FACET_LABEL, type FacetKey } from '@/lib/search';
import { DocPicker } from './DocPicker';
import { FilePicker, Modal, Select, useSubmit, type SelectOption } from './Modal';
import type { DialogData, DialogSpec, MetaDoc, TypeSettings, VersionLite } from './types';
import cmp from './compare.module.css';
import voc from './vocab.module.css';
import { cleanTerm, findTerm, similarTerms, vocabKey } from '@/lib/vocab-rules';
import { ATTACHMENT_LABEL, CHANGE_KIND_LABEL, COMPARE_FAILURE_LABEL, CONF_LABEL, DISPOSITION_LABEL, FAMILY_GROUP_LABEL, FUNCTION_SCOPE_LABEL, LINK_LABEL, OPEN_REVISION_LABEL, ORIGIN_LABEL, ROLE_LABEL, SEARCH_SCOPE_LABEL, TRIGGER_LABEL, labelOf } from '@/i18n/labels';
import type { Translate } from '@/i18n';

export function Dialogs({ spec }: { spec: DialogSpec }) {
  switch (spec.kind) {
    case 'new': return <NewDocument preset={spec.preset} />;
    case 'notes': return <Notes />;
    case 'user': return <UserSwitcher />;
    case 'working': return <WorkingVersion docId={spec.docId} nextLabel={spec.nextLabel} base={spec.base} />;
    case 'meta': return <EditMeta doc={spec.doc} attach={spec.attach} />;
    case 'validate': return <RequestValidation docId={spec.docId} title={spec.title} revLabel={spec.revLabel} circuitL={spec.circuitL} minDate={spec.minDate} base={spec.base} />;
    case 'change': return <ChangeRequest docId={spec.docId} title={spec.title} change={spec.change} openRev={spec.openRev} replacements={spec.replacements} />;
    case 'link': return <LinkDocument spec={spec} />;
    case 'delegate': return <Delegate workflowId={spec.workflowId} stepName={spec.stepName} step={spec.step} excluded={spec.excluded} />;
    case 'reassign': return <Delegate workflowId={spec.workflowId} stepName={spec.stepName} step={spec.step} excluded={spec.excluded} holder={{ id: spec.holder, name: spec.holderName }} />;
    case 'vocabTerm': return <VocabTerm spec={spec} />;
    case 'vocabMerge': return <VocabMerge spec={spec} />;
    case 'reject': case 'recall': return <CloseWorkflow spec={spec} />;
    case 'compare': return <Compare docId={spec.docId} current={spec.current} other={spec.other} />;
    case 'readers': return <Readers docId={spec.docId} readers={spec.readers} version={spec.version} />;
    case 'templateTypes': return <TemplateTypes spec={spec} />;
    case 'vigie': return <VigieDecision requestId={spec.requestId} docTitle={spec.docTitle} change={spec.change} modifierId={spec.modifierId} drafters={spec.drafters} deferred={spec.deferred} />;
    case 'graft': return <Graft spec={spec} />;
    case 'review': return <RecordReview spec={spec} />;
    case 'retentionEvent': return <RetentionEvent spec={spec} />;
    case 'retentionClass': return <RetentionClass spec={spec} />;
    case 'type': return <TypeEditor type={spec.type} family={spec.family} />;
    case 'family': return <FamilyEditor family={spec.family} />;
    case 'function': return <FunctionEditor fn={spec.fn} />;
    case 'program': return <ProgramEditor program={spec.program} />;
    case 'holder': return <AddHolder functionKey={spec.functionKey} functionLabel={spec.functionLabel} scope={spec.scope} />;
    case 'org': return <OrgEditor what={spec.what} value={spec.value} />;
    case 'featured': return <FeaturedEditor spec={spec} />;
    case 'saveSearch': return <SaveSearch spec={spec} />;
  }
}

// ── Shared bits ─────────────────────────────────────────────────────────

function Actions({ pending, label, onCancel, form, disabled }: { pending: boolean; label: string; onCancel: () => void; form?: string; disabled?: boolean }) {
  const { tr } = useApp();
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>{tr('Cancel')}</button>
      <button type={form ? 'submit' : 'button'} form={form} className="btn btn-primary" disabled={pending || disabled}>{label}</button>
    </>
  );
}

/** The server's refusal; for one from an outdated view (`onReload`, useSubmit), a button that reloads the record. */
function ErrorLine({ error, onReload }: { error: string | null; onReload?: () => void }) {
  const { tr } = useApp();
  if (!error) return null;
  if (!onReload) return <p className="form-error" role="alert">{error}</p>;
  return (
    <p className="form-error" role="alert" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span>{error}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>{tr('Reload the record')}</button>
    </p>
  );
}

/**
 * A labelled field. Pass a function to receive the id of the control the label names (input, select, textarea); any
 * other content (segments, radios, check boxes, read-only text) becomes a group named by the label. `error`: what the
 * server refused in this field, shown under it (its id is `${id}-error`, for the control's aria-describedby).
 */
function Field({ label, children, span, hint, radio, error }: { label: ReactNode; children: ReactNode | ((id: string) => ReactNode); span?: boolean; hint?: ReactNode; radio?: boolean; error?: string | null }) {
  const id = useId();
  return (
    <div className={span ? 'field span-2' : 'field'}>
      {typeof children === 'function'
        ? <><label htmlFor={id}>{label}</label>{children(id)}</>
        : <><span id={id} className="field-label">{label}</span><div role={radio ? 'radiogroup' : 'group'} aria-labelledby={id}>{children}</div></>}
      {hint && !error && <div className="text-muted field-hint">{hint}</div>}
      {error && <p id={`${id}-error`} className="form-error field-hint" role="alert">{error}</p>}
    </div>
  );
}

/** Date input of a metadata field; marked invalid, and described by the error under it, when the server refused it. */
function DateInput({ id, name, value, error }: { id: string; name: string; value: string | null | undefined; error?: string | null }) {
  return <input id={id} className="input" type="date" name={name} defaultValue={value ?? ''} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />;
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

const roleLabel = (tr: Translate, role: string) => labelOf(tr, ROLE_LABEL, role);

// ── Classification (new document, edit metadata) ─────────────────────────

type TypeOpt = DialogData['types'][number];

type Classif = {
  origin: Origin; attachment: Attachment; projectCode: string; programCode: string; capexCode: string;
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
  const input = { typeCode: s.typeCode, attachment: s.attachment, projectCode: s.projectCode || null, programCode: s.programCode || null, capexCode: s.capexCode || null, department: s.department };
  const pending = (s.attachment === 'project' && !s.projectCode) || (s.attachment === 'research' && !s.programCode) || (s.attachment === 'capex' && !s.capexCode);
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
function DocFields({ types, st, set, doc, preset, withOwner, locked, lockType, fieldError }: {
  /** Types the document may take (active ones, plus its current type when editing). */
  types: TypeOpt[];
  st: Classif;
  set: (patch: Partial<Classif>) => void;
  doc?: MetaDoc;
  preset?: { projectCode?: string; title?: string };
  /** Edit dialog: the owner is editable there. */
  withOwner?: boolean;
  /** Type and context are frozen (an approval workflow resolved its approvers from them); `locked` says why. */
  locked?: string;
  /** A piece Keystone expects: its type is fixed, only the origins that type admits are offered. */
  lockType?: boolean;
  /** The field the server refused (a date out of format or out of order) and why. */
  fieldError?: { field: string; error: string } | null;
}) {
  const { tr, lang, data } = useApp();
  const lockProject = !!preset?.projectCode;
  const origins = ORIGINS.filter((o) => types.some((x) => x.origins.includes(o) && (!lockProject || x.attachments.includes('project')) && (!lockType || x.code === st.typeCode)));
  const atts = ATTACHMENTS.filter((a) => types.some((x) => x.origins.includes(st.origin) && x.attachments.includes(a)));
  const el = eligibleTypes(types, st.origin, st.attachment);
  const families = data.families.filter((f) => el.some((x) => x.family === f.key));
  const type = types.find((x) => x.code === st.typeCode);
  const users = userOptions(data);
  const confHint = st.conf === 'restreint' ? tr('May be shared with the designated client or partner') : st.conf === 'confidentiel' ? tr('Visible to the department or project team; named readers can be added on the document record.') : st.conf === 'tres_confidentiel' ? tr('Named readers are set on the document record.') : undefined;
  const frozen = (label: string) => <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}><span className="tag tag-neutral">{label}</span></div>;
  const errorOf = (name: string) => (fieldError?.field === name ? fieldError.error : null);
  const reviewHint = reviewDueHint(type?.reviewMonths, !!doc?.inForce);

  return (
    <div className="form-grid">
      <Field label={tr('Title')} span>
        {(id) => <input id={id} className="input" name="title" defaultValue={doc?.title ?? preset?.title ?? ''} required />}
      </Field>

      {locked && <p className="text-muted span-2" role="note" style={{ margin: 0, fontSize: 12 }}>{locked}</p>}
      <input type="hidden" name="origin" value={st.origin} />
      <input type="hidden" name="attachment" value={st.attachment} />
      <Field label={tr('Origin')} hint={locked ? undefined : tr('Internal: issued by the group. External: received from an organisation (standard, certificate, client or supplier document).')}>
        {locked ? frozen(labelOf(tr, ORIGIN_LABEL, st.origin)) : <Segmented className="codex-seg" wrap label={tr('Origin')} value={st.origin} options={origins.map((o) => ({ value: o, label: labelOf(tr, ORIGIN_LABEL, o) }))} onChange={(k) => set({ origin: k as Origin })} />}
      </Field>
      <Field label={tr('Attachment')} hint={lockProject || locked ? undefined : tr('It gives the identifier its context: the project, programme or CAPEX code; without attachment, the owning department (QMS for a template).')}>
        {lockProject
          ? <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}><span className="tag tag-accent">{tr('Project')}</span></div>
          : locked ? frozen(labelOf(tr, ATTACHMENT_LABEL, st.attachment))
          : <Segmented className="codex-seg" wrap label={tr('Attachment')} value={st.attachment} options={atts.map((a) => ({ value: a, label: labelOf(tr, ATTACHMENT_LABEL, a) }))} onChange={(k) => set({ attachment: k as Attachment })} />}
      </Field>

      {st.attachment === 'project' && (
        <Field label={tr('Project')} span>
          {lockProject || locked
            ? <><input type="hidden" name="projectCode" value={st.projectCode} /><div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>{codeLabel({ key: st.projectCode, label: data.projects.find((p) => p.key === st.projectCode)?.label ?? '' }).label}</div></>
            : (id) => <Select id={id} name="projectCode" value={st.projectCode} onChange={(v) => set({ projectCode: v })} options={data.projects.map(codeLabel)} empty="—" required />}
        </Field>
      )}
      {st.attachment === 'research' && (
        <Field label={tr('Research programme')} span>
          {(id) => <><Select id={id} name={locked ? undefined : 'programCode'} value={st.programCode} onChange={(v) => set({ programCode: v })} options={data.programs.filter((p) => p.active || p.key === doc?.programCode).map(codeLabel)} empty="—" required disabled={!!locked} />{locked && <input type="hidden" name="programCode" value={st.programCode} />}</>}
        </Field>
      )}
      {st.attachment === 'capex' && (
        <Field label={tr('CAPEX')} span hint={data.capex.length ? undefined : tr('No CAPEX published by Arche yet.')}>
          {(id) => <><Select id={id} name={locked ? undefined : 'capexCode'} value={st.capexCode} onChange={(v) => set({ capexCode: v })} options={data.capex.filter((c) => c.active || c.key === doc?.capexCode).map(codeLabel)} empty="—" required disabled={!!locked} />{locked && <input type="hidden" name="capexCode" value={st.capexCode} />}</>}
        </Field>
      )}

      {el.length === 0 ? (
        <p className="form-error span-2">{tr('No active type admits this origin and attachment.')}</p>
      ) : (
        <>
          <Field label={tr('Family')}>
            {(id) => <Select id={id} value={st.family} onChange={(v) => set({ family: v, typeCode: '' })} options={families} disabled={!!locked || lockType} />}
          </Field>
          <Field label={tr('Type')} hint={type ? `${tr('Workflow')} : ${type.circuitL}` : undefined}>
            {(id) => <><Select id={id} name={locked || lockType ? undefined : 'typeCode'} value={st.typeCode} onChange={(v) => set({ typeCode: v })} options={el.filter((x) => x.family === st.family).map((x) => ({ key: x.code, label: `${x.code} · ${x.label}` }))} required disabled={!!locked || lockType} />{(locked || lockType) && <input type="hidden" name="typeCode" value={st.typeCode} />}</>}
          </Field>
        </>
      )}
      {/* The list of a type stays open (MET-17): a value outside it is kept, and offered to the register's administrators. */}
      <Field label={tr('Sub-type')} hint={st.subtype.trim() && type && !type.subtypes.some((x) => vocabKey(x) === vocabKey(st.subtype)) ? tr('Outside the type’s list: the value is kept, and offered to the administrators of the register.') : type?.subtypes.length ? tr('Pick from the list or type freely') : undefined} error={errorOf('subtype')}>
        {(id) => <><input id={id} className="input" name="subtype" list="codex-subtypes" value={st.subtype} onChange={(e) => set({ subtype: e.target.value })} autoComplete="off" maxLength={200} />
          <datalist id="codex-subtypes">{type?.subtypes.map((x) => <option key={x} value={x} />)}</datalist></>}
      </Field>
      {/* An inactive department or site is offered only to a document that already has it (lib/org-rules.ts). */}
      <Field label={tr('Department / Function')} error={errorOf('department')}>
        {(id) => <><Select id={id} name={locked ? undefined : 'department'} value={st.department} onChange={(v) => set({ department: v })} options={offered(data.departments, doc?.department).map(codeLabel)} required disabled={!!locked} />{locked && <input type="hidden" name="department" value={st.department} />}</>}
      </Field>
      <Field label={tr('Site')} error={errorOf('site')}>
        {(id) => <Select id={id} name="site" defaultValue={doc?.site ?? ''} options={offered(data.sites, doc?.site)} empty="—" />}
      </Field>
      <Field label={tr('Confidentiality')} hint={confHint}>
        {(id) => <Select id={id} name="conf" value={st.conf} onChange={(v) => set({ conf: v as Conf, confTouched: true })} options={(type?.confAllowed ?? []).map((c) => ({ key: c, label: labelOf(tr, CONF_LABEL, c) }))} required />}
      </Field>
      <KeywordsField initial={doc?.keywords ?? []} error={errorOf('keywords')} />
      <Field label={tr('Language')} error={errorOf('lang')}>
        {/* fr, en or none (lib/actions.ts validateFields); another value a record already has stays offered to it. */}
        {(id) => <Select id={id} name="lang" defaultValue={doc ? doc.lang ?? '' : lang} options={[{ key: 'fr', label: tr('French') }, { key: 'en', label: tr('English') }, ...(doc?.lang && doc.lang !== 'fr' && doc.lang !== 'en' ? [{ key: doc.lang, label: doc.lang }] : [])]} empty="—" />}
      </Field>
      {/* Without a date, entry into force sets one from the type's periodicity (lib/lifecycle.ts putInForce, lib/review.ts reviewDueHint). */}
      <Field label={tr('Review date')} error={errorOf('reviewDueAt')} hint={reviewHint ? tr(reviewHint).replace('{n}', String(type?.reviewMonths)) : undefined}>
        {(id) => <DateInput id={id} name="reviewDueAt" value={doc?.reviewDueAt} error={errorOf('reviewDueAt')} />}
      </Field>
      <Field label={tr('Expiry date')} error={errorOf('expiresAt')}>
        {(id) => <DateInput id={id} name="expiresAt" value={doc?.expiresAt} error={errorOf('expiresAt')} />}
      </Field>

      {withOwner && (
        <Field label={tr('Owner')}>
          {(id) => <Select id={id} name="ownerId" defaultValue={doc?.ownerId ?? data.currentUserId} options={users} required />}
        </Field>
      )}
      <AuthorFields doc={doc} errorOf={errorOf} />

      {st.origin === 'externe' && (
        <>
          <GridSection>{tr('External document')}</GridSection>
          <SourceOrgField initial={doc?.sourceOrg ?? ''} error={errorOf('sourceOrg')} />
          <Field label={tr('External reference')}>
            {(id) => <input id={id} className="input" name="externalRef" defaultValue={doc?.externalRef ?? ''} />}
          </Field>
          <Field label={tr('Received on')} error={errorOf('receivedAt')}>
            {(id) => <DateInput id={id} name="receivedAt" value={doc?.receivedAt} error={errorOf('receivedAt')} />}
          </Field>
        </>
      )}
      {st.attachment === 'project' && (
        <>
          <GridSection>{tr('Project document')}</GridSection>
          <Field label={tr('Project phase')}>
            {(id) => <><input id={id} className="input" name="projectPhase" list="codex-phases" defaultValue={doc?.projectPhase ?? ''} autoComplete="off" />
              <datalist id="codex-phases">{PROJECT_PHASES.map((k) => <option key={k} value={k} label={lang === 'fr' ? undefined : PROJECT_PHASES_EN[k]} />)}</datalist></>}
          </Field>
          <Field label={tr('Work package')}>
            {(id) => <input id={id} className="input" name="workPackage" defaultValue={doc?.workPackage ?? ''} />}
          </Field>
          <Field label={tr('Discipline')}>
            {(id) => <input id={id} className="input" name="discipline" defaultValue={doc?.discipline ?? ''} />}
          </Field>
        </>
      )}
      {st.attachment === 'research' && (
        <>
          <GridSection>{tr('Research document')}</GridSection>
          <Field label={tr('Research theme')}>
            {(id) => <input id={id} className="input" name="researchTheme" defaultValue={doc?.researchTheme ?? ''} />}
          </Field>
          <Field label={tr('Study / trial ID')}>
            {(id) => <input id={id} className="input" name="studyId" defaultValue={doc?.studyId ?? ''} />}
          </Field>
          <Field label={tr('Publication / IP status')}>
            {(id) => <input id={id} className="input" name="ipStatus" defaultValue={doc?.ipStatus ?? ''} />}
          </Field>
        </>
      )}
      {st.origin === 'interne' && (
        <>
          <GridSection>{tr('Internal document')}</GridSection>
          <Field label={tr('Process owner')}>
            {(id) => <Select id={id} name="processOwnerId" defaultValue={doc?.processOwnerId ?? ''} options={users} empty="—" />}
          </Field>
        </>
      )}
    </div>
  );
}

/**
 * Terms the user is offered (DialogData `vocab`, lib/queries.ts vocabSuggestions) as rules read them: a value they stand
 * for takes their spelling, any other is a new term the user confirms (lib/actions.ts readVocab).
 */
const asTerms = (names: string[]) => names.map((name) => ({ name }));

/** A new term: the box that confirms its addition to the vocabulary, required to send the form, and the close terms. */
function NewTerm({ value, terms, onPick }: { value: string; terms: { name: string }[]; onPick: (name: string) => void }) {
  const { tr } = useApp();
  const near = similarTerms(terms, value);
  return (
    <div className={voc.confirm}>
      {near.length > 0 && (
        <div className={voc.similar}>
          <span>{tr('Similar existing term:')}</span>
          {near.map((x) => <button key={x.name} type="button" className={voc.similarBtn} onClick={() => onPick(x.name)}>{x.name}</button>)}
        </div>
      )}
      <label><input type="checkbox" name="confirmTerm" value={value} required />{tr('Add “{term}” to the vocabulary').replace('{term}', value)}</label>
    </div>
  );
}

/**
 * Source organisation of an external document (MET-07, G40): picked from the vocabulary, or a new term whose addition the
 * user confirms; a value that folds to a term's spelling (« SIEMENS ») is written as the term (« Siemens »).
 */
function SourceOrgField({ initial, error }: { initial: string; error: string | null }) {
  const { tr, data } = useApp();
  const [value, setValue] = useState(initial);
  const terms = asTerms(data.vocab.sourceOrgs);
  const clean = cleanTerm(value);
  // A value the record already has is not new (lib/actions.ts readVocab), even when the user is not offered it.
  const isNew = !!clean && !findTerm(terms, clean) && vocabKey(clean) !== vocabKey(initial);
  return (
    <Field label={tr('Source organisation')} error={error}>
      {(id) => (
        <>
          <input id={id} className="input" name="sourceOrg" list="codex-orgs" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" required maxLength={300} aria-invalid={error ? true : undefined} />
          <datalist id="codex-orgs">{data.vocab.sourceOrgs.map((x) => <option key={x} value={x} />)}</datalist>
          {isNew && <NewTerm value={clean} terms={terms} onPick={setValue} />}
        </>
      )}
    </Field>
  );
}

/**
 * Keywords (MET-07, G32): several values, each picked from the vocabulary or a new term whose addition the user confirms.
 * Enter or a comma adds what is typed; sent as one list (`keywords`, comma-separated, as lib/actions.ts readFields reads it).
 */
function KeywordsField({ initial, error }: { initial: string[]; error: string | null }) {
  const { tr, data } = useApp();
  const [list, setList] = useState(initial);
  const [entry, setEntry] = useState('');
  const terms = asTerms(data.vocab.keywords);
  const known = (k: string) => !!findTerm(terms, k) || initial.some((x) => vocabKey(x) === vocabKey(k));
  const add = (raw: string) => {
    const parts = raw.split(',').map(cleanTerm).filter(Boolean);
    if (!parts.length) return;
    setList((xs) => {
      const out = [...xs];
      for (const p of parts) {
        const name = findTerm(terms, p)?.name ?? p;
        if (!out.some((x) => vocabKey(x) === vocabKey(name))) out.push(name);
      }
      return out;
    });
    setEntry('');
  };
  const replace = (from: string, to: string) => setList((xs) => (xs.some((x) => vocabKey(x) === vocabKey(to)) ? xs.filter((x) => x !== from) : xs.map((x) => (x === from ? to : x))));
  const fresh = list.filter((k) => !known(k));
  return (
    <Field label={tr('Keywords')} hint={tr('Pick from the list or type a keyword, then Enter or comma.')} error={error}>
      {(id) => (
        <>
          <input type="hidden" name="keywords" value={list.join(', ')} />
          <div className={`input ${voc.chips}`} aria-invalid={error ? true : undefined}>
            {list.map((k) => (
              <span key={k} className={`tag tag-neutral ${voc.chip} ${known(k) ? '' : voc.chipNew}`}>
                {k}{!known(k) && <small>{tr('new')}</small>}
                <button type="button" className={voc.chipRemove} onClick={() => setList((xs) => xs.filter((x) => x !== k))} aria-label={tr('Remove keyword {k}').replace('{k}', k)} title={tr('Remove')}>
                  <Icon name="close" size={11} sw={2} />
                </button>
              </span>
            ))}
            <input
              id={id} className={voc.entry} list="codex-keywords" value={entry} autoComplete="off" maxLength={100}
              onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else setEntry(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(entry); } else if (e.key === 'Backspace' && !entry && list.length) setList((xs) => xs.slice(0, -1)); }}
              onBlur={() => add(entry)}
            />
            <datalist id="codex-keywords">{data.vocab.keywords.filter((x) => !list.some((k) => vocabKey(k) === vocabKey(x))).map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          {fresh.map((k) => <NewTerm key={k} value={k} terms={terms} onPick={(name) => replace(k, name)} />)}
        </>
      )}
    </Field>
  );
}

/** Value of the author list that stands for an external author, written as free text. */
const EXTERNAL_AUTHOR = '__external';

/**
 * The author of the document (MET-10, lib/actions.ts readAuthor): a person of the group, by default the person creating
 * it, or an external author written as free text. A record migrated without author shows its owner: that person is
 * proposed.
 */
function AuthorFields({ doc, errorOf }: { doc?: MetaDoc; errorOf: (name: string) => string | null }) {
  const { tr, data } = useApp();
  const [kind, setKind] = useState<'person' | 'text'>(doc?.authorText ? 'text' : 'person');
  const [person, setPerson] = useState(doc ? doc.authorId ?? (doc.authorText ? '' : doc.ownerId) : data.currentUserId);
  const options = [...userOptions(data), { key: EXTERNAL_AUTHOR, label: tr('External author (free text)') }];
  return (
    <>
      <input type="hidden" name="authorKind" value={kind} />
      <Field label={tr('Author')} hint={doc ? undefined : tr('By default, the person creating the document; choose another person or an external author.')} error={errorOf('authorId')}>
        {(id) => (
          <Select
            id={id} name="authorId" value={kind === 'text' ? EXTERNAL_AUTHOR : person} required empty={kind === 'person' && !person ? '—' : undefined}
            onChange={(v) => { if (v === EXTERNAL_AUTHOR) setKind('text'); else { setKind('person'); setPerson(v); } }} options={options}
          />
        )}
      </Field>
      {kind === 'text' && (
        <Field label={tr('Author (free text)')} hint={tr('Author outside the group: organisation, former employee…')} error={errorOf('authorText')}>
          {(id) => <input id={id} className="input" name="authorText" defaultValue={doc?.authorText ?? ''} maxLength={200} required />}
        </Field>
      )}
    </>
  );
}

// ── New document ────────────────────────────────────────────────────────

type NewPreset = Extract<DialogSpec, { kind: 'new' }>['preset'];
type Mode = 'template' | 'file' | 'blank';

function NewDocument({ preset }: { preset: NewPreset }) {
  const { tr, data, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const lockProject = !!preset?.projectCode;
  const types = data.types.filter((x) => x.active);
  // Explicit mode first; otherwise a preset (piece expected by Keystone, new template…) usually comes with its own file.
  const [mode, setMode] = useState<Mode>(preset?.mode ?? (preset?.templateId || (!preset?.projectCode && !preset?.typeCode && data.templates.length) ? 'template' : 'file'));
  const [st, setSt] = useState<Classif>(() => {
    const presetType = types.find((x) => x.code === preset?.typeCode);
    // A family proposed from the explorer brings the first active type of it the new document may take.
    const familyType = !presetType && preset?.family ? types.find((x) => x.family === preset.family && x.attachments.includes('none')) : undefined;
    const firstType = presetType ?? familyType;
    // A department proposed from the explorer, if it is still offered (active); otherwise the usual default.
    const presetDept = preset?.department && data.departments.some((d) => d.key === preset.department && d.active) ? preset.department : null;
    const s = normalize(types, {
      origin: firstType && !firstType.origins.includes('interne') ? firstType.origins[0] : 'interne',
      attachment: lockProject ? 'project' : 'none',
      projectCode: preset?.projectCode ?? '', programCode: '', capexCode: '',
      family: firstType?.family ?? '', typeCode: firstType?.code ?? '', subtype: '',
      department: presetDept ?? newDocDepartment(data.currentDepartment, data.departments),
      conf: 'interne', confTouched: false,
    }, lockProject);
    const type = types.find((x) => x.code === s.typeCode);
    return type ? { ...s, conf: type.confDefault } : s;
  });
  // Whether the user chose the type, or the template, themselves: until then, each follows the other (below).
  const [typeTouched, setTypeTouched] = useState(!!preset?.typeCode);
  const [tplTouched, setTplTouched] = useState(!!preset?.templateId);
  const [tplChosen, setTplChosen] = useState(preset?.templateId ?? data.templates[0]?.id ?? '');
  const set = (patch: Partial<Classif>) => {
    if (['origin', 'attachment', 'family', 'typeCode'].some((k) => k in patch)) setTypeTouched(true);
    setSt((prev) => applyPatch(types, prev, patch, lockProject));
  };
  const { prefix, width } = idParts(st);
  // A piece Keystone expects is filled by a document of its type only (createDocument refuses any other).
  const lockType = preset?.expectedId != null && !!preset.typeCode && st.typeCode === preset.typeCode;
  // Templates meant for the type chosen come first; the others stay offered below them (lib/actions.ts setTemplateTypes).
  const forType = data.templates.filter((x) => x.types.includes(st.typeCode));
  const others = data.templates.filter((x) => !x.types.includes(st.typeCode));
  // Until the user picks a template, the first one meant for the type is proposed.
  const tplId = tplTouched ? tplChosen : forType[0]?.id ?? tplChosen;
  const pickTemplate = (x: DialogData['templates'][number]) => {
    setTplChosen(x.id);
    setTplTouched(true);
    // Until the user picks a type, a template meant for other types brings the first of them it may take here.
    if (typeTouched || lockType || x.types.includes(st.typeCode)) return;
    const target = x.types.map((c) => types.find((y) => y.code === c)).find((y) => y && (!lockProject || y.attachments.includes('project')));
    if (!target) return;
    setSt((prev) => applyPatch(types, prev, {
      origin: target.origins.includes(prev.origin) ? prev.origin : target.origins[0],
      attachment: target.attachments.includes(prev.attachment) ? prev.attachment : target.attachments[0],
      family: target.family, typeCode: target.code,
    }, lockProject));
  };
  const tplRow = (x: DialogData['templates'][number], other: boolean) => (
    <label key={x.id} className="radio hover-tint" style={{ padding: '7px 8px', borderRadius: 'var(--radius-md)', gap: 10 }}>
      <input type="radio" name="tpl" checked={tplId === x.id} onChange={() => pickTemplate(x)} /><span className="dot" />
      <span className="ellipsis" style={{ flex: 1, fontSize: 13 }}>{x.label}</span>
      <span className="text-muted ellipsis" style={{ fontSize: 11, minWidth: 0 }} title={tr('Documents created from this template, among those you may read')}>{x.id} · {tr('Revision')} {x.rev} · {x.owner} · {x.uses} {tr('uses')}{other && x.types.length > 0 ? ` · ${tr('meant for')} ${x.types.join(', ')}` : ''}</span>
    </label>
  );
  const tplHead = (label: string) => <div className="text-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', padding: '6px 8px 2px' }}>{label}</div>;

  return (
    <Modal title={tr('New document')} width={680} actions={<Actions pending={pending} label={tr('Create document')} onCancel={close} form="new-form" disabled={!st.typeCode || (mode === 'template' && !tplId)} />}>
      <form
        id="new-form"
        onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); run(() => createDocument(fd), { form }); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {lockProject && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span className="tag tag-accent">{preset!.projectCode}</span>
            {preset?.label && <span className="text-muted">{tr('Expected document')} : {preset.label}</span>}
            {preset?.expectedId != null && <input type="hidden" name="expectedId" value={preset.expectedId} />}
          </div>
        )}

        <Field label={tr('Initial content')}>
          <Segmented
            className="codex-seg"
            wrap
            label={tr('Initial content')}
            value={mode}
            options={[{ value: 'template', label: tr('From a template') }, { value: 'file', label: tr('From a file') }, { value: 'blank', label: tr('No file yet') }]}
            onChange={(k) => setMode(k as Mode)}
          />
        </Field>
        {mode === 'template' && (
          <Field label={tr('Choose a template')} radio>
            <input type="hidden" name="templateId" value={tplId} />
            {data.templates.length === 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('No template in force.')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflow: 'auto' }}>
              {forType.length > 0 && tplHead(`${tr('Templates for this type')} ${st.typeCode}`)}
              {forType.map((x) => tplRow(x, false))}
              {forType.length > 0 && others.length > 0 && tplHead(tr('Other templates'))}
              {others.map((x) => tplRow(x, true))}
            </div>
          </Field>
        )}
        {mode === 'file' && <FilePicker label={tr('Choose a file')} required />}
        {mode === 'blank' && <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('The document gets its ID right away; upload working version A.1 later.')}</div>}

        <DocFields types={types} st={st} set={set} preset={preset} lockType={lockType} fieldError={field && error ? { field, error } : null} />

        {st.typeCode && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{tr('Assigned ID')}</span>
            <IdPrefix prefix={prefix} width={width} />
            <span className="text-muted sub">{tr('number assigned on creation')}</span>
          </div>
        )}
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

// ── Edit metadata ───────────────────────────────────────────────────────

function EditMeta({ doc, attach }: { doc: MetaDoc; attach?: 'project' }) {
  const { tr, data, close } = useApp();
  const { pending, error, field, run, reload } = useSubmit();
  // A type withdrawn from the register stays available to the documents that already have it.
  const types = data.types.filter((x) => x.active || x.code === doc.typeCode);
  const [st, setSt] = useState<Classif>(() => normalize(types, {
    origin: doc.origin, attachment: attach ?? doc.attachment, projectCode: doc.projectCode ?? '', programCode: doc.programCode ?? '', capexCode: doc.capexCode ?? '',
    family: types.find((x) => x.code === doc.typeCode)?.family ?? '', typeCode: doc.typeCode, subtype: doc.subtype ?? '',
    department: doc.department, conf: doc.conf, confTouched: true,
  }, false));
  const set = (patch: Partial<Classif>) => setSt((prev) => applyPatch(types, prev, patch, false));
  const { input, prefix, width } = idParts(st);
  const moved = !!st.typeCode && !idMatches(doc.id, input);

  return (
    <Modal title={tr('Edit metadata')} width={680} actions={<Actions pending={pending} label={tr('Save')} onCancel={close} form="meta-form" disabled={!st.typeCode} />}>
      <form
        id="meta-form"
        onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); run(() => updateMeta(fd), { form }); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <input type="hidden" name="docId" value={doc.id} />
        <input type="hidden" name="version" value={doc.version} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span className="tag tag-neutral tabnum">{doc.id}</span>
          {moved && doc.idMayChange && (
            <span style={{ color: 'var(--color-accent-300)' }} role="status">
              {tr('The ID will be recalculated')} → <IdPrefix prefix={prefix} width={width} />
            </span>
          )}
          {moved && !doc.idMayChange && <span className="text-muted">{tr('ID frozen since the first approval')}</span>}
        </div>
        <DocFields types={types} st={st} set={set} doc={doc} withOwner locked={doc.classificationLocked ? tr('Approval workflow in progress: wait for its decision, or for its requester (or a records manager) to recall the request, before changing the type or context.') : undefined} fieldError={field && error ? { field, error } : null} />
        <ErrorLine error={field ? null : error} onReload={reload} />
      </form>
    </Modal>
  );
}

// ── Working version, approval, change requests ───────────────────────────

function WorkingVersion({ docId, nextLabel, base }: { docId: string; nextLabel: string; base: { revisionId: number; n: number } }) {
  const { tr, close } = useApp();
  const { pending, error, run, reload } = useSubmit();
  return (
    <Modal title={tr('New working version')} actions={<Actions pending={pending} label={tr('Upload a file')} onCancel={close} form="working-form" />}>
      <form id="working-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => addWorkingVersion(fd)); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="docId" value={docId} />
        <input type="hidden" name="baseRevision" value={base.revisionId} />
        <input type="hidden" name="baseVersion" value={base.n} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span className="tag tag-neutral tabnum">{docId}</span>
          <span className="text-muted" style={{ marginLeft: 'auto' }}>{tr('Working version')} → <span style={{ color: 'var(--color-accent-300)' }}>{nextLabel}</span></span>
        </div>
        <FilePicker label={tr('Choose a file')} required />
        <Field label={tr('Version comment')} hint={tr('Earlier versions stay in the Revisions tab. Until the revision is in force, only the drafting circle sees it.')}>{(id) => <textarea id={id} className="input" name="comment" rows={3} />}</Field>
        <ErrorLine error={error} onReload={reload} />
      </form>
    </Modal>
  );
}

function RequestValidation({ docId, title, revLabel, circuitL, minDate, base }: { docId: string; title: string; revLabel: string; circuitL: string; minDate: string; base: { revisionId: number; n: number } }) {
  const { tr, close } = useApp();
  const { pending, error, run, reload } = useSubmit();
  const [effective, setEffective] = useState('');
  return (
    <Modal
      title={tr('Request approval')}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => requestValidation(docId, effective || null, base))}>{tr('Request approval#action')}</button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{title}</div>
        <div className="text-muted sub tabnum">{docId} · {tr('Revision')} {revLabel}</div>
      </div>
      <Field label={tr('Workflow')} hint={tr('The holders of the functions are named at launch. Neither the revision’s author nor you will be able to approve it.')}>
        <div style={{ fontSize: 13 }}>{tr('Drafting (author)')} → {circuitL}</div>
      </Field>
      <Field label={tr('Effective date')} hint={tr('Empty: in force as soon as approved')}>
        {(id) => <input id={id} className="input" type="date" min={minDate} value={effective} onChange={(e) => setEffective(e.target.value)} />}
      </Field>
      <ErrorLine error={error} onReload={reload} />
    </Modal>
  );
}

function ChangeRequest({ docId, title, change, openRev, replacements }: { docId: string; title: string; change: 'modification' | 'obsolescence'; openRev?: { letter: string; status: 'draft' | 'in_review' | 'approved' }; replacements?: boolean }) {
  const { tr, lang, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const [replacement, setReplacement] = useState('');
  return (
    <Modal title={change === 'modification' ? tr('Request a change') : tr('Request withdrawal')} actions={<Actions pending={pending} label={tr('Send')} onCancel={close} form="change-form" />}>
      <form
        id="change-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const replacing = change === 'obsolescence' ? replacement || null : null;
          run(() => requestChange(docId, change, String(fd.get('reason') ?? ''), String(fd.get('description') ?? ''), replacing), { form });
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
            {tr('The change request (ECR) is sent to Vigie.')} {tr('A revision is already open')} ({tr('Rev.')} {openRev.letter}, {labelOf(tr, OPEN_REVISION_LABEL, openRev.status)}). {tr('If the ECO is accepted, it will open the next revision upon entry into force of revision')} {openRev.letter}
            {openRev.status === 'draft' ? `${lang === 'fr' ? ' ;' : ';'} ${tr('it may also be grafted onto it while it is being drafted')}` : ''}.
          </p>
        ) : (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{change === 'modification' ? tr('The change request (ECR) is sent to Vigie. If the ECO is accepted, Codex opens the next revision as a draft, assigned to the designated author.') : tr('The withdrawal request is sent to Vigie. If it is accepted, the document becomes obsolete.')}</p>
        )}
        <Field label={tr('Reason')}>{(id) => <input id={id} className="input" name="reason" maxLength={300} required />}</Field>
        <Field label={tr('Description')}>{(id) => <textarea id={id} className="input" name="description" rows={4} maxLength={4000} />}</Field>
        {/* Withdrawal: the document that replaces this one, linked « remplacé par » once Vigie accepts (lib/lifecycle.ts). */}
        {change === 'obsolescence' && replacements && (
          <Field label={tr('Replacement document (optional)')} hint={tr('If Vigie accepts the withdrawal, the withdrawn document will be “replaced by” this document.')} error={field === 'replacement' ? error : null}>
            {(id) => <DocPicker id={id} docId={docId} purpose="replacement" name="replacement" value={replacement} onChange={setReplacement} empty={tr('None')} />}
          </Field>
        )}
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/** Kinds offered by the link dialog, the plainest first. */
const LINK_ORDER: readonly LinkRel[] = ['see_also', 'replaces', 'replaced_by'];

/**
 * Links the document to another one from its record (lib/actions.ts addDocLink). « Remplacé par » is offered only for a
 * document Vigie withdrew, towards an active one; « Remplace » only for an active document, towards a withdrawn one
 * (lib/links.ts linkIssue). The server checks it all again.
 */
function LinkDocument({ spec }: { spec: Extract<DialogSpec, { kind: 'link' }> }) {
  const { tr, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const [rel, setRel] = useState<LinkRel>('see_also');
  // Whether any document at all may be linked under this kind, as long as no search narrows the list.
  const [none, setNone] = useState(false);
  const onOptions = useCallback((found: { key: string }[], searching: boolean) => { if (!searching) setNone(!found.length); }, []);
  const off = (k: LinkRel) => (k === 'replaced_by' && !spec.withdrawn) || (k === 'replaces' && !spec.active);
  const relHint = [!spec.withdrawn && tr('Only a withdrawn (obsolete) document can be replaced: this one is not.'), !spec.active && tr('This document is obsolete or archived: it replaces nothing.')].filter(Boolean).join(' ') || undefined;
  const [other, setOther] = useState('');
  const chosen = other;
  return (
    <Modal title={tr('Link a document')} width={560} actions={<Actions pending={pending} label={tr('Link a document')} onCancel={close} form="link-form" disabled={!chosen} />}>
      <form
        id="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          run(() => addDocLink(spec.docId, rel, chosen), { form });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('“Replaces” and “Replaced by” link a document Vigie withdrew to the document that replaces it. To withdraw a document in force, send a withdrawal request naming its replacement.')}</p>
        <Field label={tr('Kind of link')} radio hint={relHint} error={field === 'rel' ? error : null}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {LINK_ORDER.map((k) => (
              <label key={k} className="radio" style={{ fontSize: 13, opacity: off(k) ? 0.5 : 1 }}>
                <input type="radio" name="rel" checked={rel === k} disabled={off(k)} onChange={() => { setRel(k); setOther(''); }} /><span className="dot" />{labelOf(tr, LINK_LABEL, k)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={tr('Linked document')} error={field === 'other' ? error : null} hint={none ? tr('No document can be linked this way.') : undefined}>
          {(id) => <DocPicker key={rel} id={id} docId={spec.docId} purpose="link" rel={rel} name="other" value={chosen} onChange={setOther} empty={tr('Choose a document')} onOptions={onOptions} />}
        </Field>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/**
 * Hands the current step on: its holder delegates it (delegateStep), or, with `holder`, a records manager reassigns a
 * step someone else holds (reassignStep, point 19). Same people offered either way.
 */
function Delegate({ workflowId, stepName, step, excluded, holder }: { workflowId: string; stepName: string; step: number; excluded: string[]; holder?: { id: string; name: string } }) {
  const { tr, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // Only people who may decide this step: never the author or requester, always someone whose role can approve.
  const others = userOptions(data, holder?.id ?? data.currentUserId).filter((o) => !excluded.includes(o.key) && data.users.find((u) => u.id === o.key)?.approver);
  const [to, setTo] = useState(others[0]?.key ?? '');
  const label = holder ? tr('Reassign') : tr('Delegate');
  return (
    <Modal
      title={holder ? tr('Reassign the step') : tr('Delegate the step')}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending || !to} onClick={() => run(() => (holder ? reassignStep(workflowId, to, step) : delegateStep(workflowId, to, step)), { staleError: tr('The workflow moved on in the meantime: the page has been refreshed.') })}>{label}</button>
      </>}
    >
      <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('Step')} : {stepName}</div>
      {holder && <div className="text-muted" style={{ fontSize: 12.5 }}>{tr('The step is held by {who}. Reserved to records managers, with the rules of a delegation.').replace('{who}', holder.name)}</div>}
      <Field label={holder ? tr('Reassign to') : tr('Delegate to')} hint={tr('Only people whose role may approve are offered, never the revision’s author or requester.')}>{(id) => <Select id={id} name="to" value={to} onChange={setTo} options={others} />}</Field>
      <ErrorLine error={error} />
    </Modal>
  );
}

/**
 * Rejects the current step, with its reason, or recalls the request, with an optional one (lib/actions.ts decideStep,
 * recallValidation). A circuit that moved on in the meantime closes the dialog and refreshes the page.
 */
function CloseWorkflow({ spec }: { spec: Extract<DialogSpec, { kind: 'reject' | 'recall' }> }) {
  const { tr, close } = useApp();
  const { pending, error, run } = useSubmit();
  const reject = spec.kind === 'reject';
  return (
    <Modal title={reject ? tr('Reject the step') : tr('Recall the approval request')} actions={<Actions pending={pending} label={reject ? tr('Reject') : tr('Recall the request')} onCancel={close} form="close-workflow-form" />}>
      <form
        id="close-workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const why = String(new FormData(e.currentTarget).get('reason') ?? '');
          run(() => (reject ? decideStep(spec.workflowId, false, spec.step, why) : recallValidation(spec.workflowId, spec.step, why)), { staleError: tr('The workflow moved on in the meantime: the page has been refreshed.') });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId} · {tr('Revision')} {spec.letter} · {tr('Step')} : {spec.stepName}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{reject ? tr('The revision goes back to drafting. The reason is added to the workflow comments and to the audit trail; the author and the owner find it on the record and in “To do”.') : tr('The workflow stops and the revision goes back to drafting: the approvers no longer have a step to decide. You may send it for approval again.')}</p>
        <Field label={reject ? tr('Reason') : tr('Reason (optional)')}>
          {(id) => <textarea id={id} className="input" name="reason" rows={4} maxLength={2000} required={reject} />}
        </Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

/** What GET /api/documents/[id]/compare answers. */
type CompareAnswer = CompareResult;

/**
 * Two versions side by side: their attributes, then their text compared line by line (GET /api/documents/[id]/compare,
 * lib/compare.ts), from the selected version (−) to the current one (+). The server decides what may be compared (D-14).
 */
function Compare({ docId, current, other }: { docId: string; current: VersionLite; other: VersionLite }) {
  const { tr, close } = useApp();
  const [answer, setAnswer] = useState<CompareAnswer | { error: string } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/documents/${encodeURIComponent(docId)}/compare?a=${other.id}&b=${current.id}`, { signal: ctl.signal, cache: 'no-store' })
      .then(async (res) => {
        if (res.ok) setAnswer((await res.json()) as CompareAnswer);
        else setAnswer({ error: res.status === 429 || res.status === 503 ? (await res.text()) || tr('The content comparison failed. Try again later.') : tr('The content comparison failed. Try again later.') });
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') setAnswer({ error: tr('The content comparison failed. Try again later.') });
      });
    return () => ctl.abort();
  }, [docId, other.id, current.id, tr]);
  const rows: [string, (v: VersionLite) => string][] = [
    [tr('Working version'), (v) => v.label], [tr('Date'), (v) => v.dateF], [tr('Author'), (v) => v.author], [tr('Version comment'), (v) => v.commentL],
    [tr('File'), (v) => v.fileName ?? '—'], [tr('Size'), (v) => v.sizeF], [tr('Pages'), (v) => (v.pages ? String(v.pages) : '—')],
    // The start of each fingerprint: enough to tell identical files apart from different ones.
    ['SHA-256', (v) => (v.sha256 ? `${v.sha256.slice(0, 16)}…` : '—')],
  ];
  return (
    <Modal title={tr('Compare versions')} width={820} actions={<button type="button" className="btn btn-primary" onClick={close}>{tr('Close')}</button>}>
      <div className={cmp.section}>{tr('Attributes')}</div>
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th><span className="sr-only">{tr('Attribute')}</span></th><th>{tr('Selected version')}</th><th>{tr('Current version')}</th></tr></thead>
        <tbody>
          {rows.map(([label, get]) => {
            const a = get(other), b = get(current);
            return <tr key={label}><td className="text-muted nowrap">{label}</td><td>{a}</td><td style={{ color: a !== b ? 'var(--color-accent-300)' : undefined }}>{b}</td></tr>;
          })}
        </tbody>
      </table>
      <div className={cmp.section}>{tr('Content')}</div>
      <CompareContent answer={answer} />
    </Modal>
  );
}

function CompareContent({ answer }: { answer: CompareAnswer | { error: string } | null }) {
  const { tr } = useApp();
  if (!answer) return <p className={cmp.note} role="status">{tr('Extracting and comparing the text…')}</p>;
  if ('error' in answer) return <p className="form-error" role="alert">{answer.error}</p>;
  const { a, b, diff } = answer;
  const failures = [a, b].filter((x, i) => x.failure && (i === 0 || b.id !== a.id));
  const truncated = [a, b].filter((x) => x.truncated);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-live="polite">
      {failures.map((x) => <p key={`f${x.id}`} className={cmp.failure}>{labelOf(tr, COMPARE_FAILURE_LABEL, x.failure).replace('{label}', x.label)}</p>)}
      {answer.sameFile && <p className={cmp.note}>{tr('Same files (identical SHA-256 fingerprints).')}</p>}
      {diff?.kind === 'same' && <p className={cmp.failure}>{tr('Identical text ({n} lines compared).').replace('{n}', String(diff.lines))}</p>}
      {diff?.kind === 'too_different' && <p className={cmp.failure}>{tr('The texts differ too much to be shown line by line.')}</p>}
      {diff?.kind === 'diff' && (
        <>
          <div className={cmp.summary}>
            <span>{tr('{added} line(s) added, {removed} line(s) removed').replace('{added}', String(diff.added)).replace('{removed}', String(diff.removed))}</span>
            <span className={cmp.legend}>{tr('− {a} · + {b}').replace('{a}', a.label).replace('{b}', b.label)}</span>
          </div>
          <div className={cmp.diff} tabIndex={0} aria-label={tr('Content')}>
            {diff.hunks.map((h, i) => (
              <Fragment key={i}>
                {h.skipped > 0 && <div className={cmp.skip}>{tr('{n} identical line(s)').replace('{n}', String(h.skipped))}</div>}
                {h.lines.map((l, j) => (
                  <div key={j} className={cmp.row} data-op={l.op}>
                    <span className={cmp.num}>{l.a ?? ''}</span>
                    <span className={cmp.num}>{l.b ?? ''}</span>
                    <span className={cmp.op} aria-hidden>{l.op === ' ' ? '' : l.op === '-' ? '−' : '+'}</span>
                    <span className={cmp.text}>{l.op === '-' ? <del>{l.text}</del> : l.op === '+' ? <ins style={{ textDecoration: 'none' }}>{l.text}</ins> : l.text}</span>
                  </div>
                ))}
              </Fragment>
            ))}
            {diff.trailing > 0 && <div className={cmp.skip}>{tr('{n} identical line(s)').replace('{n}', String(diff.trailing))}</div>}
          </div>
          {diff.truncated && <p className={cmp.note}>{tr('Display limited to the first differences.')}</p>}
        </>
      )}
      {truncated.map((x) => <p key={`t${x.id}`} className={cmp.note}>{tr('Text too long: only the beginning of {label} is compared.').replace('{label}', x.label)}</p>)}
      <p className={cmp.note}>{tr('Running text compared line by line, without the layout; blanks and empty lines are ignored.')}</p>
    </div>
  );
}

function Readers({ docId, readers, version }: { docId: string; readers: string[]; version: number }) {
  const { tr, data, close } = useApp();
  const { pending, error, run, reload } = useSubmit();
  const [sel, setSel] = useState(() => new Set(readers));
  const toggle = (id: string) => setSel((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <Modal
      title={tr('Named readers')}
      width={600}
      actions={<>
        <span className="text-muted" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>{sel.size} {tr('selected')}</span>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => setReaders(docId, [...sel], version))}>{tr('Save')}</button>
      </>}
    >
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('Besides the drafting circle, these people can see the document: only them for a highly confidential document, in addition to the department or project team for a confidential one.')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 12px', maxHeight: 340, overflow: 'auto' }}>
        {data.users.map((u) => (
          <label key={u.id} className="hover-tint" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '5px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} style={{ margin: 0 }} />
            <span className="ellipsis" style={{ flex: 1 }}>{u.name}</span>
            {u.department && <span className="text-muted sub">{u.department}</span>}
          </label>
        ))}
      </div>
      <ErrorLine error={error} onReload={reload} />
    </Modal>
  );
}

/**
 * Types a template is meant for (lib/actions.ts setTemplateTypes), by family: active types, and an inactive one only
 * where the template already has it.
 */
function TemplateTypes({ spec }: { spec: Extract<DialogSpec, { kind: 'templateTypes' }> }) {
  const { tr, data, close } = useApp();
  const { pending, error, run, reload } = useSubmit();
  const [sel, setSel] = useState(() => new Set(spec.types));
  const toggle = (code: string) => setSel((prev) => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  const offeredTypes = data.types.filter((x) => x.active || spec.types.includes(x.code));
  const families = data.families.filter((f) => offeredTypes.some((x) => x.family === f.key));
  return (
    <Modal
      title={`${tr('Template target types')} · ${spec.docId}`}
      width={640}
      actions={<>
        <span className="text-muted" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>{sel.size} {tr('selected')}</span>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => setTemplateTypes(spec.docId, [...sel], spec.version))}>{tr('Save')}</button>
      </>}
    >
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{spec.title} — {tr('“New from template” offers this template first for a document of these types; it is still offered for other types.')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflow: 'auto' }}>
        {families.map((f) => (
          <div key={f.key} role="group" aria-label={f.label}>
            <div className="text-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', padding: '4px 6px' }}>{f.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 12px' }}>
              {offeredTypes.filter((x) => x.family === f.key).map((x) => (
                <label key={x.code} className="hover-tint" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '5px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sel.has(x.code)} onChange={() => toggle(x.code)} style={{ margin: 0 }} />
                  <span className="tabnum" style={{ flex: 'none' }}>{x.code}</span>
                  <span className="ellipsis" style={{ flex: 1 }}>{x.label}</span>
                  {!x.active && <span className="text-muted sub">{tr('Inactive')}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ErrorLine error={error} onReload={reload} />
    </Modal>
  );
}

function VigieDecision({ requestId, docTitle, change, modifierId, drafters, deferred }: { requestId: string; docTitle: string; change: 'modification' | 'obsolescence'; modifierId: string; drafters: string[]; deferred?: string }) {
  const { tr, data, close } = useApp();
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
      title={tr('Vigie simulation')}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending || (designate && !modifier)} onClick={() => run(() => simulateVigieDecision(requestId, accept, designate ? modifier : null))}>
          {accept ? tr('Simulate acceptance') : tr('Simulate rejection')}
        </button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{docTitle}</div>
        <div className="text-muted sub tabnum">{requestId} · {labelOf(tr, CHANGE_KIND_LABEL, change)}</div>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('Until Vigie is connected, its decision is simulated here by a records manager.')}</p>
      <Field label={tr('Decision')} radio hint={accept ? deferred : undefined}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {([true, false] as const).map((v) => (
            <label key={String(v)} className="radio" style={{ fontSize: 13 }}>
              <input type="radio" name="decision" checked={accept === v} onChange={() => setAccept(v)} /><span className="dot" />{v ? tr('Accepted') : tr('Rejected#request')}
            </label>
          ))}
        </div>
      </Field>
      {designate && (
        <Field label={tr('Designated author')} hint={tr('Only people who can draft this document are offered: upload permission of their role and access to the document.')}>{(id) => <Select id={id} name="modifier" value={modifier} onChange={setModifier} options={users} />}</Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

/** Confirms the graft of an accepted change onto the revision being drafted (lib/actions.ts graftChange, D-26). */
function Graft({ spec }: { spec: Extract<DialogSpec, { kind: 'graft' }> }) {
  const { tr, close } = useApp();
  const { pending, error, run } = useSubmit();
  return (
    <Modal
      title={`${tr('Graft onto revision')} ${spec.letter}`}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => graftChange(spec.requestId))}>{tr('Graft')}</button>
      </>}
    >
      <div>
        <div style={{ fontSize: 13 }}>{spec.title}</div>
        <div className="text-muted sub tabnum">{spec.docId} · {tr('Revision')} {spec.letter} · {spec.ecoRef}</div>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('The revision being drafted takes in the change and also carries its ECO reference; the request is marked as applied. The revision’s author and working versions do not change. Without a graft, the change waits for the revision to enter into force before opening the next one.')}</p>
      <Field label={tr('Reason')}><div style={{ fontSize: 13 }}>{spec.reason}</div></Field>
      <Field label={`${tr('Author of revision')} ${spec.letter}`}><div style={{ fontSize: 13 }}>{spec.author}</div></Field>
      {spec.vigieModifier && (
        <Field label={tr('Author designated by Vigie')} hint={tr('Once grafted, the change is written by the revision’s author; the journal records the switch.')}><div style={{ fontSize: 13 }}>{spec.vigieModifier}</div></Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

/**
 * Records the periodic review of the revision in force (lib/actions.ts recordReview): no revision is created. The next
 * review date is the one entered, else the type's periodicity counted from today.
 */
function RecordReview({ spec }: { spec: Extract<DialogSpec, { kind: 'review' }> }) {
  const { tr, lang, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const errorOf = (name: string) => (field === name ? error : null);
  return (
    <Modal title={tr('Record the periodic review')} actions={<Actions pending={pending} label={tr('Review done')} onCancel={close} form="review-form" />}>
      <form
        id="review-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          run(() => recordReview(spec.docId, String(fd.get('next') ?? '') || null, String(fd.get('comment') ?? '')), { form });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId} · {tr('Revision')} {spec.letter}{spec.reviewDueAt ? ` · ${tr('Review date')} : ${fmtDate(spec.reviewDueAt, lang)}` : ''}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('The review confirms that the revision in force still applies; it creates no revision. To change or withdraw the document, send a request to Vigie.')}</p>
        <Field label={tr('Next review')} error={errorOf('next')} hint={spec.months ? tr('Left empty: in {n} months, per the type’s periodicity.').replace('{n}', String(spec.months)) : tr('The document type has no review periodicity: enter the date.')}>
          {(id) => (
            <input
              id={id} className="input" type="date" name="next" min={spec.minDate} required={!spec.months}
              aria-invalid={errorOf('next') ? true : undefined} aria-describedby={errorOf('next') ? `${id}-error` : undefined}
            />
          )}
        </Field>
        <Field label={tr('Comment (optional)')} error={errorOf('comment')}>
          {(id) => <textarea id={id} className="input" name="comment" rows={3} maxLength={2000} aria-invalid={errorOf('comment') ? true : undefined} />}
        </Field>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/**
 * Date of the event a document's retention counts from (lib/actions.ts setRetentionEvent): a day no later than today,
 * or none (cleared). The end of retention follows; nothing is archived or destroyed.
 */
function RetentionEvent({ spec }: { spec: Extract<DialogSpec, { kind: 'retentionEvent' }> }) {
  const { tr, close } = useApp();
  const { pending, error, field, run, reload } = useSubmit();
  const errorOf = (name: string) => (field === name ? error : null);
  const send = (form: HTMLFormElement, value: string | null) => run(() => setRetentionEvent(spec.docId, value, spec.version), { form });
  return (
    <Modal
      title={tr('Date of the trigger event')}
      actions={<>
        {spec.eventAt && <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={pending} onClick={() => { const form = document.getElementById('retention-event-form'); if (form instanceof HTMLFormElement) send(form, null); }}>{tr('Clear the date')}</button>}
        <Actions pending={pending} label={tr('Save')} onCancel={close} form="retention-event-form" />
      </>}
    >
      <form
        id="retention-event-form"
        onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; send(form, String(new FormData(form).get('eventAt') ?? '') || null); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId} · {spec.triggerL}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('The retention of this document counts from this event. The date is journaled; it neither archives nor destroys the document.')}</p>
        <Field label={tr('Date of the trigger event')} error={errorOf('eventAt')}>
          {(id) => (
            <input
              id={id} className="input" type="date" name="eventAt" defaultValue={spec.eventAt ?? ''} min="1900-01-01" max={spec.maxDate} required
              aria-invalid={errorOf('eventAt') ? true : undefined} aria-describedby={errorOf('eventAt') ? `${id}-error` : undefined}
            />
          )}
        </Field>
        <ErrorLine error={field ? null : error} onReload={reload} />
      </form>
    </Modal>
  );
}

/**
 * Retention class of one document (lib/actions.ts setRetentionClass): a derogation to its type's rule, or the type's
 * rule put back. Records managers only; never archives nor destroys.
 */
function RetentionClass({ spec }: { spec: Extract<DialogSpec, { kind: 'retentionClass' }> }) {
  const { tr, close } = useApp();
  const { pending, error, field, run, reload } = useSubmit();
  const errorOf = (name: string) => (field === name ? error : null);
  const ruleL = (x: { retentionYears: number | null; retentionTrigger: string; retentionDisposition: string }) =>
    `${x.retentionYears != null ? `${x.retentionYears} ${tr('years')} · ` : ''}${labelOf(tr, TRIGGER_LABEL, x.retentionTrigger)} · ${labelOf(tr, DISPOSITION_LABEL, x.retentionDisposition)}`;
  const send = (form: HTMLFormElement, mode: 'override' | 'type') => {
    const fd = new FormData(form);
    fd.set('mode', mode);
    run(() => setRetentionClass(fd), { form });
  };
  return (
    <Modal
      title={tr('Retention class')}
      width={560}
      actions={<>
        {(spec.override || !sameRule(spec.current, spec.type)) && (
          <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={pending} onClick={() => { const form = document.getElementById('retention-class-form'); if (form instanceof HTMLFormElement) send(form, 'type'); }}>
            {tr('Back to the type rule')}
          </button>
        )}
        <Actions pending={pending} label={tr('Save')} onCancel={close} form="retention-class-form" />
      </>}
    >
      <form id="retention-class-form" onSubmit={(e) => { e.preventDefault(); send(e.currentTarget, 'override'); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="docId" value={spec.docId} />
        <input type="hidden" name="version" value={spec.version} />
        <div>
          <div style={{ fontSize: 13 }}>{spec.title}</div>
          <div className="text-muted sub tabnum">{spec.docId} · {tr('Type rule')} ({spec.type.code}) : {ruleL(spec.type)}</div>
        </div>
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('A class other than the type rule is a derogation: it is journaled, and a later change of the type rule leaves it unchanged. Nothing is archived or destroyed.')}</p>
        <div className="form-grid">
          <Field label={tr('Duration (years)')} error={errorOf('retentionYears')}>
            {(id) => <input id={id} className="input" type="number" name="retentionYears" min={0} max={200} step={1} defaultValue={spec.current.retentionYears ?? ''} aria-invalid={field === 'retentionYears' ? true : undefined} />}
          </Field>
          <Field label={tr('Trigger')}>
            {(id) => <Select id={id} name="retentionTrigger" defaultValue={spec.current.retentionTrigger} options={RETENTION_TRIGGERS.map((k) => ({ key: k, label: labelOf(tr, TRIGGER_LABEL, k) }))} />}
          </Field>
          <Field label={tr('Action when due')}>
            {(id) => <Select id={id} name="retentionDisposition" defaultValue={spec.current.retentionDisposition} options={DISPOSITIONS.map((k) => ({ key: k, label: labelOf(tr, DISPOSITION_LABEL, k) }))} />}
          </Field>
        </div>
        <ErrorLine error={field ? null : error} onReload={reload} />
      </form>
    </Modal>
  );
}

// ── Notes and session simulation ─────────────────────────────────────────

const NOTES: Record<'fr' | 'en', [string, string][]> = {
  fr: [
    ['Source de vérité.', 'Codex est la GED du groupe et fait foi pour les métadonnées, les droits, les révisions, les circuits de validation et le journal d’audit. Les fichiers sont rangés derrière une interface de stockage unique (disque local, ou bibliothèque SharePoint pilotée par Codex). Keystone fournit les projets et lit le registre des types.'],
    ['Classement.', 'Deux axes indépendants — Origine (interne / externe) et Rattachement (aucun, projet Keystone, programme de recherche) — puis Famille › Type › Sous-type, Département et Site. Chaque type du registre fixe les origines et rattachements admis, le circuit de validation, la conservation et la confidentialité.'],
    ['Identifiant.', 'TYPE-CONTEXTE-SEQ, attribué à la création : code projet (PID-HLT-026-001), code programme (PRT-R2601-004), QMS pour les modèles (FRM-QMS-012), sinon le département propriétaire sur quatre chiffres (PRO-QUA-0001). Avant la première approbation, un reclassement recalcule l’identifiant et garde l’ancien comme alias ; ensuite il ne change plus.'],
    ['Révisions.', 'En lettres (A, B…), avec des versions de travail A.1, A.2… pendant la rédaction. Brouillon → En révision → Approuvé → En vigueur (à la date d’effet) ; la révision précédente est remplacée. Le circuit du type est fait de fonctions résolues au lancement ; ni l’auteur de la révision ni le demandeur ne la valident.'],
    ['Vigie.', 'Les demandes de modification (ECR / ECO) et de retrait partent vers Vigie, qui décide : un ECO accepté ouvre la révision suivante en brouillon pour le modificateur désigné, un retrait accepté rend le document obsolète. Tant que Vigie n’est pas branché, un gestionnaire documentaire simule la décision.'],
    ['Confidentialité.', 'Public < Restreint (client ou partenaire désigné) < Interne < Confidentiel (département ou équipe projet) < Très confidentiel (lecteurs désignés). Brouillons et versions de travail restent visibles du seul cercle de rédaction : propriétaire, modificateur, valideurs en cours et gestionnaires documentaires.'],
    ['Simulation.', 'Pas d’authentification pour l’instant : choisissez la personne et le rôle simulés depuis le profil en bas de la barre latérale ; navigation, droits et visibilité suivent. Interface bilingue FR / EN ; les titres des documents restent dans leur langue.'],
  ],
  en: [
    ['Source of truth.', 'Codex is the group’s document management system and the reference for metadata, permissions, revisions, approval workflows and the audit trail. Files sit behind a single storage interface (local disk, or a SharePoint library driven by Codex). Keystone provides the projects and reads the type register.'],
    ['Classification.', 'Two independent axes — Origin (internal / external) and Attachment (none, Keystone project, research programme) — then Family › Type › Sub-type, Department and Site. Each type of the register sets the origins and attachments it admits, its approval workflow, retention and confidentiality.'],
    ['Identifier.', 'TYPE-CONTEXT-SEQ, assigned on creation: project code (PID-HLT-026-001), programme code (PRT-R2601-004), QMS for templates (FRM-QMS-012), otherwise the owning department with four digits (PRO-QUA-0001). Before the first approval a reclassification recalculates the ID and keeps the old one as an alias; afterwards it never changes.'],
    ['Revisions.', 'Lettered (A, B…), with working versions A.1, A.2… while drafting. Draft → In review → Approved → In force (on the effective date); the previous revision is superseded. The type’s workflow is made of functions resolved at launch; neither the revision’s author nor the requester approves it.'],
    ['Vigie.', 'Change requests (ECR / ECO) and withdrawal requests go to Vigie, which decides: an accepted ECO opens the next revision as a draft for the designated author, an accepted withdrawal makes the document obsolete. Until Vigie is connected, a records manager simulates the decision.'],
    ['Confidentiality.', 'Public < Restricted (designated client or partner) < Internal < Confidential (department or project team) < Highly confidential (named readers). Drafts and working versions stay visible to the drafting circle only: owner, designated author, current approvers and records managers.'],
    ['Simulation.', 'No sign-in yet: pick the simulated person and role from the profile at the bottom of the sidebar; navigation, permissions and visibility follow. Bilingual FR / EN interface; document titles stay in their own language.'],
  ],
};

function Notes() {
  const { tr, lang, close } = useApp();
  return (
    <Modal title={tr('Design notes')} width={560} actions={<button type="button" className="btn btn-primary" onClick={close}>{tr('Close')}</button>}>
      <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {NOTES[lang].map(([head, body]) => (
          <p key={head} style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>{head}</strong> {body}</p>
        ))}
      </div>
    </Modal>
  );
}

function UserSwitcher() {
  const { tr, data, close } = useApp();
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
      title={tr('Simulate a user')}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => simulateUser(userId, role))}>{tr('Apply')}</button>
      </>}
    >
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('No sign-in yet: pick the simulated person and role. Navigation and permissions adapt.')}</p>
      <Field label={tr('User')} hint={picked && `${tr('Department / Function')} : ${deptLabel(picked.department)} · ${tr('Default role')} : ${roleLabel(tr, picked.role)}`}>
        {(id) => <Select id={id} name="user" value={userId} onChange={(v) => { setUserId(v); setRole(data.users.find((u) => u.id === v)?.role ?? role); }} options={options} />}
      </Field>
      <Field label={tr('Simulated role')} radio>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SIM_ROLES.map((r) => (
            <label key={r} className="radio hover-tint" style={{ padding: '6px 8px', borderRadius: 'var(--radius-md)', gap: 10, fontSize: 13 }}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} /><span className="dot" />{labelOf(tr, ROLE_LABEL, r)}
            </label>
          ))}
        </div>
      </Field>
      <ErrorLine error={error} />
    </Modal>
  );
}

// ── Administration ──────────────────────────────────────────────────────

const iconBtn = { width: 26, height: 26 };
const checkRow = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' } as const;

/**
 * Deletes an entry of the register that nothing uses, once confirmed; shown disabled, with the reason, when something
 * does (the server checks again). Sits at the left of the dialog's actions.
 */
function DeleteEntry({ used, usedText, confirmText, pending, onDelete }: { used: boolean; usedText: string; confirmText: string; pending: boolean; onDelete: () => void }) {
  const { tr } = useApp();
  return (
    <button
      type="button" className="btn btn-ghost" style={{ marginRight: 'auto', color: used ? undefined : 'var(--color-accent-300)' }} disabled={pending || used}
      title={used ? usedText : undefined} onClick={() => { if (window.confirm(confirmText)) onDelete(); }}
    >
      <Icon name="close" size={14} />{tr('Delete')}
    </button>
  );
}

/** Code or key of an entry: read-only once used (it stands in IDs, circuits and the journal), with why. */
function CodeInput({ id, name, value, used, upper, maxLength, field, error }: { id: string; name: string; value: string; used: boolean; upper?: boolean; maxLength: number; field: string | null; error: string | null }) {
  const bad = field === name;
  return (
    <input
      id={id} className="input tabnum" name={name} defaultValue={value} required readOnly={used} maxLength={maxLength} autoComplete="off" spellCheck={false}
      style={{ textTransform: upper ? 'uppercase' : undefined, maxWidth: upper ? 140 : undefined, opacity: used ? 0.75 : undefined }}
      aria-invalid={bad ? true : undefined} aria-describedby={bad && error ? `${id}-error` : undefined}
    />
  );
}

/** Steps of a circuit, after the author's own: reordered, removed, added from the functions not in it yet. */
function CircuitSteps({ circuit, setCircuit }: { circuit: string[]; setCircuit: (f: (xs: string[]) => string[]) => void }) {
  const { tr, data } = useApp();
  const free = data.functions.filter((f) => !circuit.includes(f.key));
  const [addKey, setAddKey] = useState(free[0]?.key ?? '');
  const fn = (k: string) => data.functions.find((f) => f.key === k);
  const move = (i: number, d: -1 | 1) => setCircuit((xs) => { const ys = [...xs]; [ys[i], ys[i + d]] = [ys[i + d], ys[i]]; return ys; });
  const add = () => {
    if (!addKey || circuit.includes(addKey)) return;
    const next = [...circuit, addKey];
    setCircuit(() => next);
    setAddKey(data.functions.find((f) => !next.includes(f.key))?.key ?? '');
  };
  return (
    <Field label={tr('Workflow steps')}>
      {circuit.map((k) => <input key={k} type="hidden" name="circuit" value={k} />)}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <li className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', fontSize: 13 }}>
          <span className="tabnum" style={{ width: 14 }}>0</span><span>{tr('Drafting (author)')}</span>
        </li>
        {circuit.map((k, i) => {
          const f = fn(k);
          return (
            <li key={k} className="hover-tint" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 2px 8px', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
              <span className="text-muted tabnum" style={{ width: 14 }}>{i + 1}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{f?.label ?? k}</span>
              {f && <span className="tag tag-neutral" style={{ padding: '1px 7px', fontSize: 10 }}>{labelOf(tr, FUNCTION_SCOPE_LABEL, f.scope)}</span>}
              <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${tr('Move up')} · ${f?.label ?? k}`} title={tr('Move up')}>
                <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === circuit.length - 1} onClick={() => move(i, 1)} aria-label={`${tr('Move down')} · ${f?.label ?? k}`} title={tr('Move down')}>
                <Icon name="chevronDown" size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} onClick={() => setCircuit((xs) => xs.filter((_, j) => j !== i))} aria-label={`${tr('Remove')} · ${f?.label ?? k}`} title={tr('Remove')}>
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ol>
      {circuit.length === 0 && <div className="text-muted field-hint" style={{ paddingLeft: 8 }}>{tr('Immediate approval')}</div>}
      {free.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Select value={addKey} onChange={setAddKey} options={free.map((f) => ({ key: f.key, label: f.label }))} ariaLabel={tr('Add a step')} />
          <button type="button" className="btn btn-secondary nowrap" onClick={add} disabled={!addKey}><Icon name="plus" size={14} />{tr('Add a step')}</button>
        </div>
      )}
    </Field>
  );
}

const EMPTY_TYPE: TypeSettings = {
  code: '', labelFr: '', labelEn: '', family: '', origins: ['interne'], attachments: ['none'], subtypes: [], circuit: [],
  confAllowed: ['restreint', 'interne', 'confidentiel', 'tres_confidentiel'], confDefault: 'interne', retentionYears: null, retentionTrigger: 'superseded',
  retentionDisposition: 'destroy', retentionBasis: '', retentionBasisEn: '', reviewMonths: null, iso: null, clientDeliverable: false, active: true, used: false,
};

/**
 * A type of the register, new or existing (Administration › Registre des types): code, labels, family, origins and
 * attachments it admits, sub-types, circuit, confidentiality, retention, periodic review, ISO clause, client deliverable,
 * active. A setting some of its documents would no longer meet is refused with their number until confirmed.
 */
function TypeEditor({ type, family }: { type?: TypeSettings; family?: string }) {
  const { tr, lang, data, close } = useApp();
  const { pending, error, field, run, clear } = useSubmit();
  const x = type ?? { ...EMPTY_TYPE, family: family ?? data.families[0]?.key ?? '' };
  const creating = !type;
  // Templates stay without attachment (their context is QMS, D-10): the server refuses any other.
  const template = x.code === TEMPLATE_TYPE;
  const [circuit, setCircuit] = useState<string[]>(x.circuit);
  const [origins, setOrigins] = useState<Origin[]>(x.origins);
  const [attachments, setAttachments] = useState<Attachment[]>(x.attachments);
  const [allowed, setAllowed] = useState<Conf[]>(x.confAllowed);
  const [confDefault, setConfDefault] = useState<Conf>(x.confDefault);
  const [active, setActive] = useState(x.active);
  const [rows, setRows] = useState(() => x.subtypes.map((st, i) => ({ ...st, id: i })));
  // The retention rule as entered, to preview how many documents applying it would change (applyTypeRetention).
  const [rule, setRule] = useState({ years: x.retentionYears == null ? '' : String(x.retentionYears), trigger: x.retentionTrigger, disposition: x.retentionDisposition });
  const [applyRule, setApplyRule] = useState(false);
  const entered = { retentionYears: /^\d{1,3}$/.test(rule.years) ? Number(rule.years) : null, retentionTrigger: rule.trigger, retentionDisposition: rule.disposition };
  const reach = (held: boolean) => (x.retention?.following ?? []).filter((g) => g.held === held && !sameRule(g, entered)).reduce((n, g) => n + g.n, 0);
  const following = (x.retention?.following ?? []).reduce((n, g) => n + g.n, 0);
  const [nextRow, setNextRow] = useState(x.subtypes.length);
  // The server named documents this setting would leave out: shown with the box that confirms, which sends back the
  // token of that answer, good for those documents only (lib/actions.ts updateType).
  const [outside, setOutside] = useState<{ text: string; token: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // At the foot of a long dialog: brought into view when it appears.
  const outsideRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (outside) outsideRef.current?.scrollIntoView({ block: 'nearest' }); }, [outside]);
  const toggle = <K extends string>(xs: K[], k: K, order: readonly K[]) => order.filter((v) => (v === k ? !xs.includes(k) : xs.includes(v)));
  // A change of what the type admits drops the answer and its confirmation: saving asks again.
  const reconsider = () => { setOutside(null); setConfirmed(false); clear(); };
  const toggleConf = (c: Conf) => {
    reconsider();
    const next = toggle(allowed, c, CONF_LEVELS);
    setAllowed(next);
    if (!next.includes(confDefault) && next.length) setConfDefault(next[0]);
  };
  const errorOf = (name: string) => (field === name ? error : null);
  const label = lang === 'fr' ? x.labelFr : x.labelEn;
  const submit = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    run(async () => {
      const r = await (creating ? createType(fd) : updateType(fd));
      if (!r.ok && r.field === 'confirmOut') { setOutside({ text: r.error, token: r.confirm ?? '' }); setConfirmed(false); }
      return r;
    }, { form });
  };

  return (
    <Modal
      title={creating ? tr('New type') : `${x.code} — ${label}`}
      width={720}
      actions={<>
        {!creating && (
          <DeleteEntry used={x.used} usedText={tr('This type is used (documents, a piece expected on a project, target type of a template, or the type of templates): its code no longer changes and it cannot be deleted, only made inactive.')} pending={pending} confirmText={tr('Delete “{what}” from the register for good? Nothing uses it; the deletion is journaled.').replace('{what}', `${x.code} · ${label}`)} onDelete={() => run(() => deleteType(x.code))} />
        )}
        <Actions pending={pending} label={creating ? tr('Create') : tr('Save')} onCancel={close} form="type-form" disabled={!allowed.length || !origins.length || !attachments.length || (!!outside && !confirmed)} />
      </>}
    >
      <form id="type-form" onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!creating && <input type="hidden" name="original" value={x.code} />}
        <input type="hidden" name="active" value={active ? 'on' : 'off'} />
        <input type="hidden" name="confirmOut" value={confirmed && outside ? outside.token : ''} />
        {origins.map((o) => <input key={o} type="hidden" name="origins" value={o} />)}
        {attachments.map((a) => <input key={a} type="hidden" name="attachments" value={a} />)}

        <div className="form-grid">
          <Field label={tr('Code')} hint={x.used ? tr('In use: no longer changes.') : tr('2 or 3 letters, first segment of the IDs (PRO-QUA-0001).')} error={errorOf('code')}>
            {(id) => <CodeInput id={id} name="code" value={x.code} used={x.used} upper maxLength={3} field={field} error={error} />}
          </Field>
          <Field label={tr('Family')} hint={x.used ? tr('Documents of this type follow its family.') : undefined} error={errorOf('family')}>
            {(id) => <Select id={id} name="family" defaultValue={x.family} options={data.families} required />}
          </Field>
          <Field label={tr('Label (FR)')} error={errorOf('labelFr')}>{(id) => <input id={id} className="input" name="labelFr" defaultValue={x.labelFr} required maxLength={160} />}</Field>
          <Field label={tr('Label (EN)')} error={errorOf('labelEn')}>{(id) => <input id={id} className="input" name="labelEn" defaultValue={x.labelEn} maxLength={160} />}</Field>
          <Field label={tr('Origin')}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', minHeight: 34, alignItems: 'center' }}>
              {ORIGINS.map((o) => (
                <label key={o} style={checkRow}><input type="checkbox" checked={origins.includes(o)} onChange={() => { reconsider(); setOrigins(toggle(origins, o, ORIGINS)); }} style={{ margin: 0 }} />{labelOf(tr, ORIGIN_LABEL, o)}</label>
              ))}
            </div>
          </Field>
          <Field label={tr('Attachment')} hint={template ? tr('Templates stay without attachment (QMS context).') : undefined}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', minHeight: 34, alignItems: 'center' }}>
              {ATTACHMENTS.map((a) => (
                <label key={a} style={{ ...checkRow, ...(template ? { opacity: 0.6, cursor: 'default' } : {}) }}><input type="checkbox" checked={attachments.includes(a)} disabled={template} onChange={() => { reconsider(); setAttachments(toggle(attachments, a, ATTACHMENTS)); }} style={{ margin: 0 }} />{labelOf(tr, ATTACHMENT_LABEL, a)}</label>
              ))}
            </div>
          </Field>
          <Field label={tr('Sub-types')} span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" name="subtypeFr" defaultValue={r.fr} placeholder={tr('Label (FR)')} aria-label={`${tr('Sub-type')} ${i + 1} · ${tr('Label (FR)')}`} maxLength={120} />
                  <input className="input" name="subtypeEn" defaultValue={r.en} placeholder={tr('Label (EN)')} aria-label={`${tr('Sub-type')} ${i + 1} · ${tr('Label (EN)')}`} maxLength={120} />
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} onClick={() => setRows((xs) => xs.filter((y) => y.id !== r.id))} aria-label={`${tr('Remove')} · ${tr('Sub-type')} ${i + 1}`} title={tr('Remove')}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={rows.length >= 40} onClick={() => { setRows((xs) => [...xs, { fr: '', en: '', id: nextRow }]); setNextRow((n) => n + 1); }}>
                  <Icon name="plus" size={14} />{tr('Add a sub-type')}
                </button>
              </div>
            </div>
          </Field>
          <Field label={tr('ISO 9001 clause')} error={errorOf('iso')}>{(id) => <input id={id} className="input" name="iso" defaultValue={x.iso ?? ''} maxLength={120} />}</Field>
          <Field label={tr('Client deliverable')}>
            <label style={{ ...checkRow, minHeight: 34 }}><input type="checkbox" name="clientDeliverable" defaultChecked={x.clientDeliverable} style={{ margin: 0 }} />{tr('Yes')}</label>
          </Field>
        </div>

        <CircuitSteps circuit={circuit} setCircuit={setCircuit} />

        <div className="form-grid">
          <Field label={tr('Allowed levels')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CONF_LEVELS.map((c) => (
                <label key={c} style={checkRow}>
                  <input type="checkbox" name="confAllowed" value={c} checked={allowed.includes(c)} onChange={() => toggleConf(c)} style={{ margin: 0 }} />{labelOf(tr, CONF_LABEL, c)}
                </label>
              ))}
            </div>
          </Field>
          <Field label={tr('Default level')} error={errorOf('confDefault')}>
            {(id) => <Select id={id} name="confDefault" value={confDefault} onChange={(v) => setConfDefault(v as Conf)} options={allowed.map((c) => ({ key: c, label: labelOf(tr, CONF_LABEL, c) }))} required />}
          </Field>
          <GridSection>{tr('Retention rule')}</GridSection>
          <Field label={tr('Duration (years)')} error={errorOf('retentionYears')}>
            {(id) => <input id={id} className="input" type="number" name="retentionYears" min={0} max={200} step={1} value={rule.years} onChange={(e) => setRule({ ...rule, years: e.target.value })} aria-invalid={field === 'retentionYears' ? true : undefined} />}
          </Field>
          <Field label={tr('Trigger')}>
            {(id) => <Select id={id} name="retentionTrigger" value={rule.trigger} onChange={(v) => setRule({ ...rule, trigger: v })} options={RETENTION_TRIGGERS.map((k) => ({ key: k, label: labelOf(tr, TRIGGER_LABEL, k) }))} />}
          </Field>
          <Field label={tr('Action when due')}>
            {(id) => <Select id={id} name="retentionDisposition" value={rule.disposition} onChange={(v) => setRule({ ...rule, disposition: v })} options={DISPOSITIONS.map((k) => ({ key: k, label: labelOf(tr, DISPOSITION_LABEL, k) }))} />}
          </Field>
          <Field label={tr('Basis (FR)')} span error={errorOf('retentionBasis')}>
            {(id) => <textarea id={id} className="input" name="retentionBasis" defaultValue={x.retentionBasis} rows={2} maxLength={500} style={{ resize: 'vertical' }} />}
          </Field>
          {/* Empty: the French wording is shown in English too, marked as such (lib/queries.ts basisL). */}
          <Field label={tr('Basis (EN)')} span error={errorOf('retentionBasisEn')} hint={tr('Empty: the French text is shown in English, followed by “(FR)”.')}>
            {(id) => <textarea id={id} className="input" name="retentionBasisEn" defaultValue={x.retentionBasisEn} rows={2} maxLength={500} style={{ resize: 'vertical' }} />}
          </Field>
          {/* Applying the rule to the documents that follow it is asked, never implied (lib/actions.ts applyTypeRetention). */}
          {!creating && (following > 0 || !!x.retention?.overrides) && (
            <Field label={tr('Documents of this type')} span hint={[
              x.retention?.overrides ? tr('{n} derogation(s) unchanged').replace('{n}', String(x.retention.overrides)) : '',
              reach(true) ? tr('{n} document(s) under legal hold unchanged').replace('{n}', String(reach(true))) : '',
            ].filter(Boolean).join(' · ') || undefined}>
              <label style={{ ...checkRow, minHeight: 34 }}>
                <input type="checkbox" name="applyRetention" checked={applyRule} onChange={(e) => setApplyRule(e.target.checked)} style={{ margin: 0 }} />
                {tr('Apply this rule to the documents that follow the type rule ({n} to update)').replace('{n}', String(reach(false)))}
              </label>
            </Field>
          )}
          {/* Periodic review: sets the review date of a document entering into force without one (lib/review.ts). */}
          <GridSection>{tr('Review periodicity')}</GridSection>
          <Field label={tr('Duration')} hint={tr('In months. Empty: no periodicity, the review date is entered by hand.')} error={errorOf('reviewMonths')}>
            {(id) => <input id={id} className="input" type="number" name="reviewMonths" min={1} max={240} step={1} defaultValue={x.reviewMonths ?? ''} aria-invalid={field === 'reviewMonths' ? true : undefined} />}
          </Field>
        </div>
        <label style={checkRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ margin: 0 }} />{tr('Active type (offered on creation)')}
        </label>
        {outside && (
          <div ref={outsideRef} className="form-error" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{outside.text}</span>
            <label style={{ ...checkRow, color: 'var(--color-text)' }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ margin: 0 }} />{tr('Save anyway')}
            </label>
          </div>
        )}
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/** A family of types: key, labels, the deck group it comes from (D-08). */
function FamilyEditor({ family }: { family?: Extract<DialogSpec, { kind: 'family' }>['family'] }) {
  const { tr, lang, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const x = family ?? { key: '', labelFr: '', labelEn: '', grp: 'DI', used: false };
  const creating = !family;
  const errorOf = (name: string) => (field === name ? error : null);
  const label = lang === 'fr' ? x.labelFr : x.labelEn;
  return (
    <Modal
      title={creating ? tr('New family') : `${tr('Family')} — ${label}`}
      actions={<>
        {!creating && <DeleteEntry used={x.used} usedText={tr('This family holds types or documents: its key no longer changes and it cannot be deleted.')} pending={pending} confirmText={tr('Delete “{what}” from the register for good? Nothing uses it; the deletion is journaled.').replace('{what}', label)} onDelete={() => run(() => deleteFamily(x.key))} />}
        <Actions pending={pending} label={creating ? tr('Create') : tr('Save')} onCancel={close} form="family-form" />
      </>}
    >
      <form id="family-form" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); run(() => (creating ? createFamily(fd) : updateFamily(fd)), { form }); }}>
        {!creating && <input type="hidden" name="original" value={x.key} />}
        <div className="form-grid">
          <Field label={tr('Key')} hint={x.used ? tr('In use: no longer changes.') : tr('Lower-case letters, digits and _ (resp_qualite); never shown, it refers to the entry in circuits and in the journal.')} error={errorOf('key')}>
            {(id) => <CodeInput id={id} name="key" value={x.key} used={x.used} maxLength={40} field={field} error={error} />}
          </Field>
          <Field label={tr('Deck group')}>
            {(id) => <Select id={id} name="grp" defaultValue={x.grp} options={FAMILY_GROUPS.map((g) => ({ key: g, label: labelOf(tr, FAMILY_GROUP_LABEL, g) }))} />}
          </Field>
          <Field label={tr('Label (FR)')} error={errorOf('labelFr')}>{(id) => <input id={id} className="input" name="labelFr" defaultValue={x.labelFr} required maxLength={160} />}</Field>
          <Field label={tr('Label (EN)')} error={errorOf('labelEn')}>{(id) => <input id={id} className="input" name="labelEn" defaultValue={x.labelEn} maxLength={160} />}</Field>
        </div>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/** A function circuits are made of: key, labels, the scope its holders are named for. */
function FunctionEditor({ fn }: { fn?: Extract<DialogSpec, { kind: 'function' }>['fn'] }) {
  const { tr, lang, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const x = fn ?? { key: '', labelFr: '', labelEn: '', scope: 'global' as const, used: false, held: false };
  const creating = !fn;
  // The scope is fixed while holders are named for it, and for the functions the rules of Codex name.
  const builtIn = !creating && BUILT_IN_SCOPES.has(x.key);
  const scopeLocked = x.held || builtIn;
  const errorOf = (name: string) => (field === name ? error : null);
  const label = lang === 'fr' ? x.labelFr : x.labelEn;
  return (
    <Modal
      title={creating ? tr('New function') : `${tr('Function')} — ${label}`}
      actions={<>
        {!creating && <DeleteEntry used={x.used} usedText={tr('This function is in a circuit, has holders, served in a circuit started or is named by the rules of Codex (project manager, client approval, head of department): its key no longer changes and it cannot be deleted.')} pending={pending} confirmText={tr('Delete “{what}” from the register for good? Nothing uses it; the deletion is journaled.').replace('{what}', label)} onDelete={() => run(() => deleteFunction(x.key))} />}
        <Actions pending={pending} label={creating ? tr('Create') : tr('Save')} onCancel={close} form="function-form" />
      </>}
    >
      <form id="function-form" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); run(() => (creating ? createFunction(fd) : updateFunction(fd)), { form }); }}>
        {!creating && <input type="hidden" name="original" value={x.key} />}
        <div className="form-grid">
          <Field label={tr('Key')} hint={x.used ? tr('In use: no longer changes.') : tr('Lower-case letters, digits and _ (resp_qualite); never shown, it refers to the entry in circuits and in the journal.')} error={errorOf('key')}>
            {(id) => <CodeInput id={id} name="key" value={x.key} used={x.used} maxLength={40} field={field} error={error} />}
          </Field>
          <Field label={tr('Scope')} hint={builtIn ? tr('Scope set by the rules of Codex.') : x.held ? tr('The scope does not change while the function has holders.') : undefined} error={errorOf('scope')}>
            {(id) => <>
              <Select id={id} name={scopeLocked ? undefined : 'scope'} defaultValue={x.scope} options={FUNCTION_SCOPES.map((k) => ({ key: k, label: labelOf(tr, FUNCTION_SCOPE_LABEL, k) }))} disabled={scopeLocked} />
              {scopeLocked && <input type="hidden" name="scope" value={x.scope} />}
            </>}
          </Field>
          <Field label={tr('Label (FR)')} error={errorOf('labelFr')}>{(id) => <input id={id} className="input" name="labelFr" defaultValue={x.labelFr} required maxLength={160} />}</Field>
          <Field label={tr('Label (EN)')} error={errorOf('labelEn')}>{(id) => <input id={id} className="input" name="labelEn" defaultValue={x.labelEn} maxLength={160} />}</Field>
        </div>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/** A research programme: code (the context of its documents' IDs), name, manager, active. */
function ProgramEditor({ program }: { program?: Extract<DialogSpec, { kind: 'program' }>['program'] }) {
  const { tr, data, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const x = program ?? { code: '', name: '', managerId: data.currentUserId, active: true, used: false };
  const creating = !program;
  const [active, setActive] = useState(x.active);
  const errorOf = (name: string) => (field === name ? error : null);
  return (
    <Modal
      title={creating ? tr('New programme') : `${x.code} — ${x.name}`}
      actions={<>
        {!creating && <DeleteEntry used={x.used} usedText={tr('This programme has documents or function holders: its code no longer changes and it cannot be deleted, only made inactive.')} pending={pending} confirmText={tr('Delete the programme “{what}” for good? Nothing uses it; the deletion is journaled.').replace('{what}', `${x.code} · ${x.name}`)} onDelete={() => run(() => deleteProgram(x.code))} />}
        <Actions pending={pending} label={creating ? tr('Create') : tr('Save')} onCancel={close} form="program-form" />
      </>}
    >
      <form id="program-form" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); run(() => (creating ? createProgram(fd) : updateProgram(fd)), { form }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!creating && <input type="hidden" name="original" value={x.code} />}
        <input type="hidden" name="active" value={active ? 'on' : 'off'} />
        <div className="form-grid">
          <Field label={tr('Code')} hint={x.used ? tr('In use: no longer changes.') : tr('Context of research IDs (PRT-R2601-004): a letter, then 2 to 9 letters or digits.')} error={errorOf('code')} span>
            {(id) => <CodeInput id={id} name="code" value={x.code} used={x.used} upper maxLength={10} field={field} error={error} />}
          </Field>
          <Field label={tr('Name')} span error={errorOf('name')}>{(id) => <input id={id} className="input" name="name" defaultValue={x.name} required maxLength={160} />}</Field>
          <Field label={tr('Manager')} span hint={tr('Approves the “per programme” steps of circuits when no holder is named for this programme.')} error={errorOf('managerId')}>
            {(id) => <Select id={id} name="managerId" defaultValue={x.managerId} options={userOptions(data)} required />}
          </Field>
        </div>
        <label style={checkRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ margin: 0 }} />{tr('Active programme (offered on creation)')}
        </label>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

function AddHolder({ functionKey, functionLabel, scope }: { functionKey: string; functionLabel: string; scope: 'global' | 'department' | 'project' | 'research' }) {
  const { tr, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  // A holder decides approval steps: only people whose role may approve.
  const users = userOptions(data).filter((o) => data.users.find((u) => u.id === o.key)?.approver);
  const [userId, setUserId] = useState(users[0]?.key ?? '');
  // An inactive department still takes holders, marked: its documents go through circuits (lib/actions.ts scopeValueOk).
  // A closed programme keeps its holders but takes no new one: its manager answers for it.
  const values = scope === 'department' ? markInactive(data.departments, tr('Inactive').toLowerCase()) : scope === 'project' ? data.projects : scope === 'research' ? offered(data.programs) : [];
  const [scopeValue, setScopeValue] = useState(scope === 'department' ? newDocDepartment(data.currentDepartment, data.departments) : values[0]?.key ?? '');
  const scopeLabel = scope === 'department' ? tr('Department / Function') : scope === 'project' ? tr('Project') : tr('Research programme');
  return (
    <Modal
      title={`${tr('Add a holder')} — ${functionLabel}`}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending || !userId} onClick={() => run(() => addFunctionHolder(functionKey, scope === 'global' ? null : scopeValue || null, userId))}>{tr('Add a value')}</button>
      </>}
    >
      <div className="text-muted" style={{ fontSize: 12.5 }}>{labelOf(tr, FUNCTION_SCOPE_LABEL, scope)}</div>
      <Field label={tr('User')}>{(id) => <Select id={id} name="userId" value={userId} onChange={setUserId} options={users} />}</Field>
      {scope !== 'global' && (
        <Field label={scopeLabel}>
          {(id) => <Select id={id} name="scopeValue" value={scopeValue} onChange={setScopeValue} options={values.map(codeLabel)} empty={tr('Group')} />}
        </Field>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}

/**
 * A department or a site (Administration › Organisation): a new one, or one to rename (French and English labels), make
 * inactive or active again, or delete when nothing uses it. A department's code and a site's key never change.
 */
function OrgEditor({ what, value }: { what: OrgKind; value?: Extract<DialogSpec, { kind: 'org' }>['value'] }) {
  const { tr, lang, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const x = value ?? { id: '', labelFr: '', labelEn: '', active: true, used: false };
  const creating = !value;
  const [active, setActive] = useState(x.active);
  const errorOf = (name: string) => (field === name ? error : null);
  const dept = what === 'department';
  const label = lang === 'fr' ? x.labelFr : x.labelEn;
  const name = dept ? `${x.id} · ${label}` : label;
  return (
    <Modal
      title={creating ? (dept ? tr('New department') : tr('New site')) : dept ? `${x.id} — ${label}` : `${tr('Site')} — ${label}`}
      actions={<>
        {!creating && (
          <DeleteEntry
            used={x.used} usedText={dept ? tr('This department is in use (documents, people, function holders, shared searches or IDs already given under its code): it cannot be deleted, only made inactive.') : tr('This site is in use (documents or people): it cannot be deleted, only made inactive.')} pending={pending}
            confirmText={tr('Delete “{what}” for good? Nothing uses it; the deletion is journaled.').replace('{what}', name)} onDelete={() => run(() => deleteOrgValue(what, x.id))}
          />
        )}
        <Actions pending={pending} label={creating ? tr('Create') : tr('Save')} onCancel={close} form="org-form" />
      </>}
    >
      <form
        id="org-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          run(() => (creating ? addOrgValue(what, String(fd.get('code') ?? ''), String(fd.get('labelFr') ?? ''), String(fd.get('labelEn') ?? '')) : updateOrgValue(what, fd)), { form });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {!creating && <input type="hidden" name="original" value={x.id} />}
        <input type="hidden" name="active" value={active ? 'on' : 'off'} />
        <div className="form-grid">
          {dept && (
            <Field label={tr('Code (3 letters)')} hint={creating ? tr('Context of IDs without attachment (e.g. PRO-QUA-0001)') : tr('The code is part of the IDs of documents without attachment: it never changes.')} error={errorOf('code')} span>
              {(id) => creating
                ? <input id={id} className="input tabnum" name="code" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" autoComplete="off" style={{ textTransform: 'uppercase', maxWidth: 120 }} />
                : <CodeInput id={id} name="code" value={x.id} used upper maxLength={3} field={field} error={error} />}
            </Field>
          )}
          {!dept && !creating && (
            <Field label={tr('Key')} hint={tr('Key stored on documents and people: it does not change when the site is renamed.')} span>
              {(id) => <CodeInput id={id} name="key" value={x.id} used maxLength={32} field={field} error={error} />}
            </Field>
          )}
          <Field label={tr('Label (FR)')} error={errorOf('labelFr')}>{(id) => <input id={id} className="input" name="labelFr" defaultValue={x.labelFr} required maxLength={160} />}</Field>
          <Field label={tr('Label (EN)')} error={errorOf('labelEn')}>{(id) => <input id={id} className="input" name="labelEn" defaultValue={x.labelEn} maxLength={160} />}</Field>
        </div>
        {!creating && (
          <>
            <label style={checkRow}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ margin: 0 }} />{dept ? tr('Active department (offered on creation)') : tr('Active site (offered on creation)')}
            </label>
            {!active && <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>{dept ? tr('Inactive: no longer offered for a new document or a shared search; still shown wherever it is already set. Its function holders can still be named, for the workflows of its documents.') : tr('Inactive: no longer offered for a new document; still shown wherever it is already set.')}</p>}
          </>
        )}
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/**
 * Facets the page of a department puts forward, in order (Administration › Organisation): the default ones, or a list
 * of its own, edited like the steps of a circuit (TypeEditor).
 */
function FeaturedEditor({ spec }: { spec: Extract<DialogSpec, { kind: 'featured' }> }) {
  const { tr, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [useDefault, setUseDefault] = useState(spec.isDefault);
  const [keys, setKeys] = useState<string[]>(spec.featured);
  const label = (k: string) => tr(FACET_LABEL[k as FacetKey]) ?? k;
  const free = FEATURABLE.filter((k) => !keys.includes(k));
  const [addKey, setAddKey] = useState<string>(free[0] ?? '');
  const full = keys.length >= MAX_FEATURED;
  const move = (i: number, d: -1 | 1) => setKeys((xs) => { const ys = [...xs]; [ys[i], ys[i + d]] = [ys[i + d], ys[i]]; return ys; });
  const remove = (i: number) => setKeys((xs) => xs.filter((_, j) => j !== i));
  const add = () => {
    if (!addKey || keys.includes(addKey) || full) return;
    const next = [...keys, addKey];
    setKeys(next);
    setAddKey(FEATURABLE.find((k) => !next.includes(k)) ?? '');
  };
  const iconBtn = { width: 26, height: 26 };
  const shown = useDefault ? [...DEFAULT_FEATURED] : keys;
  return (
    <Modal
      title={`${tr('Featured filters')} — ${spec.department.code} · ${spec.department.label}`}
      width={560}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => setDepartmentFeatured(spec.department.code, useDefault ? null : keys))}>{tr('Save')}</button>
      </>}
    >
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, cursor: 'pointer' }}>
        <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} style={{ margin: 0 }} />{tr('Follow the default filters')}
      </label>
      <Field label={tr('Featured filters')}>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shown.map((k, i) => (
            <li key={k} className={useDefault ? 'text-muted' : 'hover-tint'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 2px 8px', borderRadius: 'var(--radius-md)', fontSize: 13, minHeight: 30 }}>
              <span className="text-muted tabnum" style={{ width: 14 }}>{i + 1}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{label(k)}</span>
              {!useDefault && (
                <>
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${tr('Move up')} · ${label(k)}`} title={tr('Move up')}>
                    <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} disabled={i === keys.length - 1} onClick={() => move(i, 1)} aria-label={`${tr('Move down')} · ${label(k)}`} title={tr('Move down')}>
                    <Icon name="chevronDown" size={14} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" style={iconBtn} onClick={() => remove(i)} aria-label={`${tr('Remove')} · ${label(k)}`} title={tr('Remove')}>
                    <Icon name="close" size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
        {shown.length === 0 && <div className="text-muted field-hint" style={{ paddingLeft: 8 }}>{tr('None')}</div>}
        {!useDefault && free.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Select value={addKey} onChange={setAddKey} options={free.map((k) => ({ key: k, label: label(k) }))} ariaLabel={tr('Add a filter')} />
            <button type="button" className="btn btn-secondary nowrap" onClick={add} disabled={!addKey || full} title={full ? tr('Invalid filters: 6 at most, each one once.') : undefined}><Icon name="plus" size={14} />{tr('Add a filter')}</button>
          </div>
        )}
      </Field>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('On the department page, each filter gives its most frequent values, with a link to the filtered search. The choice for each business will come from the survey of each department’s needs.')}</p>
      <ErrorLine error={error} />
    </Modal>
  );
}

/**
 * Saves the criteria of /recherche under a label (lib/actions.ts saveSearch): personal, or, for those who may share,
 * with a department (the user's own by default) or the whole group.
 */
function SaveSearch({ spec }: { spec: Extract<DialogSpec, { kind: 'saveSearch' }> }) {
  const { tr, data, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [scope, setScope] = useState<(typeof SEARCH_SCOPES)[number]>('personal');
  const [department, setDepartment] = useState(newDocDepartment(data.currentDepartment, data.departments));
  return (
    <Modal title={tr('Save search')} actions={<Actions pending={pending} label={tr('Save')} onCancel={close} form="save-search-form" disabled={scope === 'department' && !department} />}>
      <form
        id="save-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const label = String(new FormData(e.currentTarget).get('label') ?? '');
          run(() => saveSearch(label, spec.search, scope, scope === 'department' ? department : null));
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={tr('Name')}>{(id) => <input id={id} className="input" name="label" required maxLength={80} autoComplete="off" />}</Field>
        <Field label={tr('Criteria')}>
          <ul className="text-muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {spec.criteria.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Field>
        {spec.mayShare ? (
          <>
            <Field label={tr('Visible to')} radio>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                {SEARCH_SCOPES.map((k) => (
                  <label key={k} className="radio" style={{ fontSize: 13 }}>
                    <input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} /><span className="dot" />{labelOf(tr, SEARCH_SCOPE_LABEL, k)}
                  </label>
                ))}
              </div>
            </Field>
            {scope === 'department' && (
              <Field label={tr('Department / Function')}>{(id) => <Select id={id} name="department" value={department} onChange={setDepartment} options={offered(data.departments).map(codeLabel)} />}</Field>
            )}
          </>
        ) : (
          <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('Personal search, visible to you only. Sharing with a department or the group is reserved to records managers and administrators.')}</p>
        )}
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('Only the criteria are saved: everyone will only see the documents they may read.')}</p>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// ── Controlled vocabularies (Administration › Vocabulaires) ──────────────

/** Adds a term to a vocabulary, or renames one (its documents follow, lib/actions.ts renameVocabTerm). */
function VocabTerm({ spec }: { spec: Extract<DialogSpec, { kind: 'vocabTerm' }> }) {
  const { tr, close } = useApp();
  const { pending, error, field, run } = useSubmit();
  const title = `${spec.term ? tr('Rename') : tr('New term')} · ${spec.vocab === 'source_org' ? tr('Source organisation') : tr('Keywords')}`;
  return (
    <Modal title={title} actions={<Actions pending={pending} label={spec.term ? tr('Rename') : tr('Create')} onCancel={close} form="vocab-term-form" />}>
      <form
        id="vocab-term-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = String(new FormData(form).get('name') ?? '');
          run(() => (spec.term ? renameVocabTerm(spec.vocab, spec.term.id, name) : addVocabTerm(spec.vocab, name)), { form });
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={tr('Term')} error={field === 'name' ? error : null} hint={spec.term ? tr('Documents keep the term’s name. A term also answers to other spellings of the same name (case, accents, blanks) and to its aliases. Renaming or merging updates the documents, except those under legal hold, which keep their value: the former spelling stays an alias of the term.') : undefined}>
          {(id) => <input id={id} className="input" name="name" defaultValue={spec.term?.name ?? ''} required maxLength={spec.vocab === 'source_org' ? 300 : 100} autoFocus />}
        </Field>
        <ErrorLine error={field ? null : error} />
      </form>
    </Modal>
  );
}

/** Merges a duplicate into another term of the same vocabulary (lib/actions.ts mergeVocabTerms). */
function VocabMerge({ spec }: { spec: Extract<DialogSpec, { kind: 'vocabMerge' }> }) {
  const { tr, close } = useApp();
  const { pending, error, run } = useSubmit();
  const [into, setInto] = useState(String(spec.others[0]?.id ?? ''));
  const target = spec.others.find((x) => String(x.id) === into);
  return (
    <Modal
      title={`${tr('Merge')} · ${spec.from.name}`}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={close}>{tr('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={pending || !target} onClick={() => run(() => mergeVocabTerms(spec.vocab, spec.from.id, Number(into)))}>{tr('Merge')}</button>
      </>}
    >
      <Field label={tr('Merge into')}>{(id) => <Select id={id} value={into} onChange={setInto} options={spec.others.map((x) => ({ key: String(x.id), label: x.name }))} />}</Field>
      {target && <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{tr('The documents of “{from}” will take “{into}”, and “{from}” will become another spelling of that term.').replaceAll('{from}', spec.from.name).replace('{into}', target.name)}</p>}
      <ErrorLine error={error} />
    </Modal>
  );
}
