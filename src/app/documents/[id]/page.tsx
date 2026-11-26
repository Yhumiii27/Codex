import { Fragment, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { MetaDoc, VersionLite } from '@/components/dialogs/types';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@norma/charte/ds/Segmented';
import { PageHeader } from '@/components/shell/PageHeader';
import { HStepper, VStepper } from '@/components/ui/Stepper';
import { getDb } from '@/db';
import { ActionButton, ActionLink, DialogButton, ShareButton } from '@/components/ui/client';
import { canRead, mayEditLinks, mayGetApprovalRecord, mayLinkTemplate, mayManageRetention, mayRecordReview, maySetRetentionEvent, mayWorkOnDraft, openRevisionView, readerMaySeeRevision, readerMaySeeVersion, readersApply } from '@/lib/access';
import { releaseHold, removeDocLink } from '@/lib/actions';
import { isFinalStatus, TEMPLATE_TYPE } from '@/lib/codes';
import { getCtx } from '@/lib/context';
import { addDays, fmtDate, todayIso } from '@/lib/format';
import { previewKind } from '@/lib/filetypes';
import { ECR_TAGCLS, PROJECT_PHASES, phaseIndex, phaseLabel } from '@/lib/i18n';
import { getProject } from '@/server/integrations/keystone';
import { CONSULT_WINDOW_MINUTES, decisionWait, defaultModifier, draftersOf } from '@/lib/lifecycle';
import { decisionWaitL, getDoc, namedReaders, listAudit, templateTypesOf, METADATA_ACTIONS, RETENTION_ACTIONS, listChangeRequests, listDocLinks, listRevisions, projectDocs as projectDocsOf, stateNotice, typeView, docWorkflows, type RevisionView } from '@/lib/queries';
import { sameRule } from '@/lib/retention';
import { previewPlan } from '@/lib/office-preview';
import { normalizeMime, storedExt } from '@/lib/storage';
import { titled } from '@/lib/titles';
import { vigieSimulated, vigieUrl } from '@/server/integrations/vigie';
import { Preview, RecordConsultation, RevisionsTab, type RevItem } from './DocClient';
import styles from './document.module.css';
import { DISPOSITION_LABEL, HISTORY_LABEL, PERM_LABEL, RECORD_TAB_LABEL, TRIGGER_LABEL, labelOf } from '@/i18n/labels';

const TABS = ['project', 'meta', 'versions', 'approval', 'requests', 'history'] as const;
type Tab = (typeof TABS)[number];
/** Views of the History tab (?hist=): the activity without consultations, metadata changes only, consultations only. */
const HIST = ['activity', 'metadata', 'consultations'] as const;
const METADATA = new Set<string>(METADATA_ACTIONS);

/** Revision statuses of the revision being drafted, reviewed or waiting for its effective date. */
const WORKING = new Set(['draft', 'in_review', 'approved']);
/** Audit actions that change the document's content or record ("Modifié … par …"). */
const MODIFYING = new Set(['upload', 'working', 'edit', 'reviewed', 'reclass', 'restore', ...RETENTION_ACTIONS]);

type Version = RevisionView['versions'][number];
const lite = (v: Version): VersionLite => ({ id: v.id, label: v.label, author: v.author, dateF: v.dateF, commentL: v.commentL, sizeF: v.sizeF, pages: v.pages, fileName: v.fileName, sha256: v.fileName ? v.sha256 : null });

/** Label of a file: the letter for the final version of an approved revision ("B"), otherwise the working version ("B.2"). */
function fileLabel(r: RevisionView, v: Version) {
  return isFinalStatus(r.status) && r.file?.id === v.id ? r.letter : v.label;
}

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

function Dl({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="dl" style={{ gap: '9px 16px', fontSize: 12.5 }}>
      {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></Fragment>)}
    </dl>
  );
}

/**
 * « {ID} · {titre} — Codex », only for a document the user may read (getDoc); one they may not, or none under this ID,
 * gets the screen's generic name: the tab's title must not tell that it exists, nor its title (D-14).
 */
export async function generateMetadata({ params }: PageProps<'/documents/[id]'>) {
  const { id: rawId } = await params;
  const ctx = await getCtx();
  const res = await getDoc(ctx, safeDecode(rawId));
  return titled(res && res !== 'hidden' ? `${res.doc.id} · ${res.doc.title}` : ctx.tr('Document record'));
}

export default async function DocumentPage({ params, searchParams }: PageProps<'/documents/[id]'>) {
  const { id: rawId } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const id = safeDecode(rawId);
  const ctx = await getCtx();
  const { tr, lang } = ctx;
  const res = await getDoc(ctx, id);
  // No document under this ID nor a former one: HTTP 404 and not-found.tsx.
  if (!res) notFound();
  // Drafts are only visible to their drafting circle; confidential documents to their audience (lib/access.ts).
  if (res === 'hidden') return <Forbidden text={tr('You do not have access to this document.')} back={tr('Back to home')} />;
  const { doc, circle, ix } = res;
  // A former reference (reclassification, migration) resolves to the document under its current ID.
  if (doc.id !== id) redirect(`${doc.href}${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ''}`);

  const hist = HIST.find((k) => k === sp.hist) ?? 'activity';
  const [project, revs, workflows, requests, history, consultations, projectDocs, links] = await Promise.all([
    doc.attachment === 'project' && doc.projectCode ? getProject(ctx, doc.projectCode) : null,
    listRevisions(ctx, doc.id),
    docWorkflows(ctx, doc.id),
    listChangeRequests(ctx, { docId: doc.id }),
    listAudit(ctx, { docId: doc.id, consultations: 'without' }),
    // Read only when shown: a record opened often gathers many.
    sp.tab === 'history' && hist === 'consultations' ? listAudit(ctx, { docId: doc.id, consultations: 'only', limit: 200 }) : [],
    doc.attachment === 'project' && doc.projectCode ? projectDocsOf(ctx, doc.projectCode) : [],
    // Links to documents the user may read only (D-14). The documents to link or propose as a replacement are searched
    // by the dialogs as the user types (DocPicker, /api/documents/[id]/candidates), never listed here.
    listDocLinks(ctx, doc.id),
  ]);
  // Types a template is meant for (« Nouveau depuis un modèle »).
  const tplTypes = doc.typeCode === TEMPLATE_TYPE ? (await templateTypesOf(ctx, [doc.id])).get(doc.id) ?? [] : null;
  const capexOf = doc.attachment === 'capex' ? ctx.capex.find((c) => c.code === doc.capexCode) : undefined;

  // The Project tab is always there (design): without a project, it says so and offers to link one.
  const tabs = TABS;
  const asked = sp.tab === 'affaire' ? 'project' : sp.tab;
  const tab: Tab = tabs.find((k) => k === asked) ?? (project ? 'project' : 'meta');
  const tabHref = (k: string) => `${doc.href}?tab=${k}`;

  // Revision in force, revision being drafted, and the file the record shows: the in-force revision's, else (drafting
  // circle only) the last working version of the draft.
  const inForce = revs.find((r) => r.status === 'in_force') ?? null;
  const working = revs.find((r) => WORKING.has(r.status)) ?? null;
  const currentRev = inForce?.file ? inForce : circle && working?.file ? working : null;
  const current = currentRev?.file ?? null;
  const currentLabel = currentRev && current ? fileLabel(currentRev, current) : '';
  const fileUrl = `/api/documents/${encodeURIComponent(doc.id)}/file`;

  const docWfs = workflows;
  const runningAny = docWfs.find((w) => !w.outcome) ?? null;
  const running = circle ? runningAny : null;
  // Outside the drafting circle, only circuits of revisions every reader sees (D-14).
  const finished = docWfs.filter((w) => w.outcome && readerMaySeeRevision(circle, w.revStatus)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

  const deny = (p: 'upload' | 'edit' | 'publish') => (ctx.can(p) ? undefined : `${tr('Permission required')} : ${labelOf(tr, PERM_LABEL, p)}`);
  // Archived, obsolete or frozen records are read-only (same rule as lib/actions.ts).
  const lock = doc.state === 'archived' ? tr('Archived document: it cannot be changed.') : doc.state === 'obsolete' ? tr('Obsolete document: it cannot be changed.') : doc.legalHold ? tr('Document under legal hold: it cannot be changed.') : undefined;
  const pending = requests.find((r) => r.status === 'submitted' || r.status === 'accepted');
  // Vigie's acceptance recorded while the document is locked or, for a change, while a revision is open: it applies when
  // the lock lifts, then once that revision is in force or cancelled (lib/lifecycle.ts, D-26).
  const awaiting = pending?.status === 'accepted' ? pending : null;
  // What it still waits for, in words this reader may be given: outside the drafting circle, a revision they do not see
  // may hold it too, so the lifting of a lock is never promised as the moment it applies (acceptedWaitL, D-14).
  const waitL = awaiting?.waitL ?? null;
  // The open revision, in the drafting circle only (openRevisionView): what a change asked now would wait for, and the
  // revision an accepted change waits for. While that one is drafted, the change may instead be grafted onto it by a
  // records manager or its author (lib/actions.ts graftChange); in review or approved, it can only wait.
  const { open: openRev, wait: waitRev } = openRevisionView(circle, ctx, doc.ownerId, working, awaiting);
  const graftClosed = waitRev && (waitRev.graft === 'in_review' || waitRev.graft === 'approved')
    ? `${tr('Revision')} ${waitRev.letter} ${waitRev.graft === 'in_review' ? tr('under review: the change can no longer be grafted onto it without restarting the workflow, it can only wait.') : tr('approved, waiting for its effective date: the change can no longer be grafted onto it, it can only wait.')}`
    : null;
  const graftBtn = (cls: string, style?: CSSProperties) => awaiting && waitRev && (waitRev.graft === 'yes' || waitRev.graft === 'reserved') && (
    <DialogButton
      spec={{
        kind: 'graft', requestId: awaiting.id, ecoRef: awaiting.ecoRef ?? awaiting.id, docId: doc.id, title: doc.title, letter: waitRev.letter, reason: awaiting.reason,
        author: ctx.userName(waitRev.author), vigieModifier: awaiting.modifierId && awaiting.modifierId !== waitRev.author ? ctx.userName(awaiting.modifierId) : undefined,
      }}
      className={cls} style={style} icon="pen"
      deniedTitle={lock ?? deny('edit') ?? (waitRev.graft === 'yes' ? undefined : tr('Reserved to the author of the revision in progress and to records managers'))}
    >{tr('Graft onto revision')} {waitRev.letter}</DialogButton>
  );
  // Outside the drafting circle, listChangeRequests already leaves out the change order and author of a change whose
  // revision is not in force yet, or not open yet, and shows one grafted onto a revision still open as accepted (D-14).
  const notice = stateNotice(ctx, doc, requests);
  const changeLock = lock ?? (pending ? `${tr('A request is already pending for this document.')} : ${pending.id}` : undefined);
  const drafting = circle && working?.status === 'draft' ? working : null;
  // The author Vigie designated for a change waiting for this revision sees it, but writes the next one (D-26).
  const draftReserved = mayWorkOnDraft(ctx, doc, ix) ? undefined : tr('Reserved to the owner, the author of the revision in progress and records managers: the author designated for a waiting change will write the next revision');
  const isOwner = ctx.seesAll || doc.ownerId === ctx.user.id;
  const type = ctx.typeByCode.get(doc.typeCode);
  // Retention (D-20): the type's rule next to the document's class when they differ, a derogation or a rule changed
  // since and not applied (frozen document); the date of an event Codex cannot know, entered on the record.
  const typeRuleL = type && !sameRule(doc, type)
    ? `${type.retentionYears != null ? `${type.retentionYears} ${tr('years')} · ` : ''}${labelOf(tr, TRIGGER_LABEL, type.retentionTrigger)} · ${labelOf(tr, DISPOSITION_LABEL, type.retentionDisposition)}`
    : null;
  const retentionRows: [string, ReactNode][] = [
    [tr('Retention class'), doc.retentionOverride ? <>{doc.retentionL} <span className="tag tag-outline" style={{ fontSize: 10.5, padding: '1px 7px', marginLeft: 4 }}>{tr('Derogation')}</span></> : doc.retentionL],
    ...(typeRuleL ? [[tr('Type rule'), doc.retentionOverride ? typeRuleL : `${typeRuleL} (${tr('not applied to this document')})`] as [string, ReactNode]] : []),
    ...(doc.eventTrigger || doc.retentionEventAt ? [[tr('Date of the trigger event'), doc.retentionEventAt ? doc.retentionEventF : tr('Event date to enter')] as [string, ReactNode]] : []),
    [tr('Retained until'), doc.untilF],
  ];
  const eventDenied = doc.legalHold ? tr('Document under legal hold: it cannot be changed.') : maySetRetentionEvent(ctx, doc) ? undefined : lock && doc.ownerId === ctx.user.id ? lock : tr('Reserved to the document owner and records managers');
  const circuitL = type ? typeView(ctx, type).circuitL : '';
  // Outside the drafting circle, the date (docView) and the person both come from what the user sees (D-14).
  const modifiedBy = history.find((h) => MODIFYING.has(h.action))?.user ?? doc.owner;
  // The revision being drafted exists for its drafting circle only (D-14).
  const wip = circle && working ? `${tr('Rev.')} ${working.label} ${tr('in progress')}` : null;

  // The last working version the dialogs show: an upload or an approval request that missed a later one is refused.
  const base = drafting && { revisionId: drafting.id, n: drafting.file?.n ?? 0 };
  const workingBtn = drafting && base && (
    <DialogButton spec={{ kind: 'working', docId: doc.id, nextLabel: `${drafting.letter}.${base.n + 1}`, base }} icon="upload" deniedTitle={lock ?? deny('upload') ?? draftReserved}>
      {tr('New working version')}
    </DialogButton>
  );
  // A circuit already running: follow it (in Validations when the user takes part, else in the Validation tab).
  const validateBtn = (cls: string) => running
    ? <ActionLink href={running.visible ? running.href : tabHref('approval')} className={cls} icon="check">{tr('Follow the workflow')}</ActionLink>
    : drafting && base && (
      <DialogButton
        spec={{ kind: 'validate', docId: doc.id, title: doc.title, revLabel: drafting.label, circuitL, minDate: todayIso(), base }}
        className={cls} icon="check" deniedTitle={lock ?? deny('edit') ?? draftReserved ?? (type && !type.circuit.length ? deny('publish') : undefined) ?? (drafting.versions.length ? undefined : tr('Upload at least one working version before requesting approval.'))}
      >{tr('Request approval#action')}</DialogButton>
    );
  // A change request needs a revision in force; one asked while a revision is open waits for it or is grafted (D-26).
  const canChange = !!doc.revInForce;
  const canWithdraw = !!doc.revInForce && doc.state !== 'obsolete';
  // The drafting circle is told what an acceptance would do while a revision is open; others know of no such revision.
  const changeBtn = (cls: string, style?: CSSProperties) => canChange && (
    <DialogButton spec={{ kind: 'change', docId: doc.id, title: doc.title, change: 'modification', openRev: openRev ?? undefined }} className={cls} style={style} icon="pen" deniedTitle={changeLock ?? deny('edit')}>{tr('Request a change')}</DialogButton>
  );
  // A withdrawal may propose the document that replaces this one: an active one the user may read (lib/links.ts),
  // searched in the dialog (lib/queries.ts docCandidates).
  const withdrawBtn = (cls: string, style?: CSSProperties) => canWithdraw && (
    <DialogButton spec={{ kind: 'change', docId: doc.id, title: doc.title, change: 'obsolescence', replacements: true }} className={cls} style={style} deniedTitle={changeLock ?? deny('edit')}>{tr('Request withdrawal')}</DialogButton>
  );
  // Links (lib/actions.ts addDocLink, removeDocLink): the owner and records managers of both documents, unless a legal
  // hold on either freezes them. A withdrawn document shows what replaces it in its band.
  const replacedBy = links.filter((l) => l.rel === 'replaced_by');
  const linksEditable = mayEditLinks(ctx, doc);
  const linkHold = doc.legalHold ? tr('Document under legal hold: its links do not change.') : undefined;
  // Periodic review of the revision in force (lib/actions.ts recordReview): its owner, its process owner, records managers.
  // An obsolete or archived document is no longer applied: nothing to review.
  const reviewBtn = (cls: string, style?: CSSProperties) => doc.revInForce && doc.state === 'active' && (
    <DialogButton
      spec={{ kind: 'review', docId: doc.id, title: doc.title, letter: doc.revInForce, reviewDueAt: doc.reviewDueAt, months: type?.reviewMonths ?? null, minDate: addDays(todayIso(), 1) }}
      className={cls} style={style} icon="check"
      deniedTitle={lock ?? deny('edit') ?? (mayRecordReview(ctx, doc) ? undefined : tr('Review reserved to the document’s owner, its process owner and records managers.'))}
    >{tr('Review done')}</DialogButton>
  );
  // Expiry and review indicators (docView, lib/review.ts): no status changes, the record offers the requests to Vigie
  // and the review as shortcuts, nothing happens on its own (D-17).
  const expiredL = doc.expired ? `${tr('Document expired, valid until {date}').replace('{date}', doc.expiresF)}${canChange || canWithdraw ? `${lang === 'fr' ? ' : ' : ': '}${tr('renew it through a change request, or withdraw it')}` : ''}.` : null;
  const smallBtn: CSSProperties = { fontSize: 12, padding: '5px 10px' };

  // « Restaurer » (lib/actions.ts restoreWorkingVersion): an earlier working version of the draft becomes the next one,
  // for whoever may upload one (same refusals as « Nouvelle version de travail »). Revisions in force: a request to Vigie.
  const restore = drafting && base ? {
    revisionId: drafting.id, base, nextLabel: `${drafting.letter}.${base.n + 1}`,
    versions: drafting.versions.filter((v) => v.n < base.n && !!v.fileName).map((v) => v.id),
    denied: lock ?? deny('upload') ?? draftReserved,
  } : null;

  // A piece counts as filled only by a document of this project; a document the user cannot see shows no ID or status.
  const pieces = project ? project.expected.map((p) => {
    const d = p.docId ? projectDocs.find((x) => x.id === p.docId && x.attachment === 'project' && x.projectCode === project.code) : undefined;
    const st = d ? (d.revInForce ? 'ok' : 'wip') : p.later ? 'later' : 'missing';
    return { ...p, d, st, visible: !!d && canRead(ctx, d, ix) };
  }) : [];

  // The revision an applied change is carried by, when the user sees it: the one it opened, or the open one it was grafted
  // onto (D-26). Outside the drafting circle, listChangeRequests already leaves out a revision not in force yet (D-14).
  const carriedBy = (r: (typeof requests)[number]) => (r.carrier ? `${r.carrier.grafted ? tr('Grafted onto revision') : tr('Opened revision')} ${r.carrier.letter}` : null);

  // Outside the drafting circle: the revision in force and those it replaced, nothing of a revision open or cancelled.
  const revItems: RevItem[] = revs.filter((r) => readerMaySeeRevision(circle, r.status)).map((r) => {
    const dates = [
      r.effectiveAt && `${tr('Effective date')} : ${r.effectiveF}`,
      r.status === 'approved' && r.approvedAt && `${tr('Approved')} : ${r.approvedF}`,
      r.inForceAt && `${tr('In force')} : ${r.inForceF}`,
      r.supersededAt && `${tr('Superseded')} : ${r.supersededF}`,
    ].filter((x): x is string => !!x);
    const who = [r.modifier && `${tr('Designated author')} : ${r.modifier}`, r.changeRefs.length > 0 && `${tr('ECO')} : ${r.changeRefs.join(', ')}`].filter((x): x is string => !!x);
    return {
      id: r.id, letter: r.letter, statusLabel: r.statusLabel, tagClass: r.tagClass,
      lines: [dates.length ? dates.join(' · ') : `${tr('Created')} ${r.createdF}`, ...(who.length ? [who.join(' · ')] : [])],
      // Proof of its approval (api/documents/[id]/approval): once approved, for whoever sees the revision.
      visa: mayGetApprovalRecord(circle, r) ? `/api/documents/${encodeURIComponent(doc.id)}/approval?rev=${encodeURIComponent(r.letter)}` : null,
      // Working versions belong to the drafting circle; others get the final file of the revision in force, under its letter.
      versions: circle
        ? r.versions.map((v) => ({ ...lite(v), current: v.id === current?.id }))
        : r.file && readerMaySeeVersion(false, r.status, true) ? [{ ...lite(r.file), label: r.letter, current: r.file.id === current?.id }] : null,
    };
  });

  const meta: MetaDoc = {
    id: doc.id, title: doc.title, typeCode: doc.typeCode, subtype: doc.subtype, origin: doc.origin, attachment: doc.attachment,
    projectCode: doc.projectCode, programCode: doc.programCode, capexCode: doc.capexCode, department: doc.department, site: doc.site, ownerId: doc.ownerId,
    authorId: doc.authorId, authorText: doc.authorText, conf: doc.conf, keywords: doc.keywords, lang: doc.lang, reviewDueAt: doc.reviewDueAt, expiresAt: doc.expiresAt,
    sourceOrg: doc.sourceOrg, externalRef: doc.externalRef, receivedAt: doc.receivedAt,
    projectPhase: doc.projectPhase, workPackage: doc.workPackage, discipline: doc.discipline,
    researchTheme: doc.researchTheme, studyId: doc.studyId, ipStatus: doc.ipStatus, processOwnerId: doc.processOwnerId,
    idMayChange: !revs.some((r) => r.approvedAt),
    inForce: !!doc.revInForce,
    classificationLocked: circle && !!runningAny,
    // Only for whoever may edit the record (in the drafting circle): it moves with the drafting too (docView, D-14).
    version: isOwner ? doc.version : 0,
  };
  // Project tab without a project (design: « Rattacher à une affaire »): the metadata dialog with the project attachment
  // chosen, for its owner or a records manager (lib/actions.ts updateMeta), when the type admits it; once a revision is
  // approved the ID no longer changes (D-10), which the dialog says too.
  const stageAt = project ? phaseIndex(project.stage) : -1;
  const attachable = !!type?.attachments.includes('project');
  const metaDenied = lock ?? deny('edit') ?? (isOwner ? undefined : `${tr('Permission required')} : ${tr('Owner')}`);
  const attachBtn = !project && (
    <DialogButton spec={{ kind: 'meta', doc: meta, attach: attachable ? 'project' : undefined }} icon="pen" deniedTitle={metaDenied}>{tr('Link to a project')}</DialogButton>
  );
  const attachNote = project ? null : !attachable ? tr('Type {type} does not allow a project attachment: choose another type in the dialog.').replace('{type}', doc.typeCode) : !meta.idMayChange ? tr('The identifier will not change: a revision has already been approved.') : null;

  const readerIds = await namedReaders(doc.id);
  // Named readers count for confidential levels; leftovers on a lower level stay listed so they can be removed.
  const showReaders = readersApply(doc.conf) || readerIds.length > 0;
  // Simulated Vigie decision: the author proposed by default (requester if they may draft the document, else the
  // owner), the people who may draft it, and what an acceptance will wait for: the lock to lift, the revision open
  // (same rules as lib/lifecycle.ts applyChangeDecision). Records managers belong to the drafting circle.
  const db = await getDb();
  const simulateVigie = ctx.seesAll && (await vigieSimulated(db));
  const submitted = simulateVigie ? requests.filter((r) => r.status === 'submitted') : [];
  const drafters = submitted.some((r) => r.kind === 'modification') ? await draftersOf(db, doc) : [];
  const vigieSpecs = new Map(await Promise.all(submitted.map(async (r) => {
    const wait = decisionWait(r.kind, doc);
    return [r.id, {
      modifierId: await defaultModifier(db, r.requesterId, doc),
      drafters,
      deferred: lock || wait.revision
        ? `${lock ? `${lock} ` : ''}${tr('The acceptance will be recorded')} : ${decisionWaitL(tr, wait)}.${wait.revision && working?.status === 'draft' ? ` ${tr('While the revision in progress is being drafted, the change may also be grafted onto it from the record.')}` : ''}`
        : undefined,
    }] as const;
  })));
  const canRelease = doc.legalHold && ctx.can('archive') && ctx.screens.retention;
  const previewMime = current?.fileKey && current.mime ? normalizeMime(current.mime, current.fileName ?? '') : null;
  // An Office file the browser cannot show: its PDF rendering, when a conversion service is configured (point 15,
  // lib/office-preview.ts), served by the file route under the same rights as the file.
  const plan = current?.fileKey && previewMime && !previewKind(previewMime)
    ? await previewPlan(current, storedExt(current.fileName ?? '', previewMime))
    : null;

  return (
    <>
      {/* The record's header (Norma 2.0): the document's path, its title and tags, then its actions — the main one
          (request the validation, or a change once in force) rightmost, the others in « Actions » beyond three. */}
      <PageHeader
        crumbs={[
          <Link key="b" href="/explorateur" className="link-plain">{tr('Document browser')}</Link>,
          tr('Document record'),
          <>{doc.id}{doc.aliases.length > 0 && ` · ${tr('Former references')} : ${doc.aliases.join(', ')}`} · {doc.path}</>,
        ]}
        title={doc.title}
        titleAside={
          <div className={styles.tags}>
            {doc.attachment === 'project' && doc.projectCode && <span className="tag tag-accent">{doc.projectCode}</span>}
            {doc.attachment === 'research' && doc.programCode && <span className="tag tag-accent">{doc.programCode}</span>}
            {doc.attachment === 'capex' && doc.capexCode && <span className="tag tag-accent">{doc.capexCode}</span>}
            <span className={doc.tagClass}>{doc.statusLabel}</span>
            {doc.expired && <span className="tag tag-outline">{tr('Expired#indicator')}</span>}
            {doc.reviewOverdue && <span className="tag tag-outline">{tr('Review overdue')}</span>}
            <span className="tag tag-neutral">{doc.typeLabel}</span>
            {inForce && <span className="tag tag-neutral">{tr('Rev.')} {inForce.letter}</span>}
            {wip && <span className="tag tag-outline">{wip}</span>}
            <span className="tag tag-neutral">{doc.confL}</span>
            {doc.legalHold && <span className="tag tag-outline"><Icon name="lock" size={11} style={{ marginRight: 4 }} />{tr('Legal hold')}</span>}
          </div>
        }
        subtitle={<>{tr('Modified')} {doc.modifiedF} {tr('by')} {modifiedBy}</>}
        actions={<>
          <ActionLink native href={`${fileUrl}?v=${current?.id}&download=1`} icon="download" denied={current ? undefined : tr('No working version uploaded yet.')}>{tr('Download')}</ActionLink>
          {workingBtn}
          {validateBtn('btn btn-primary') && changeBtn('btn btn-secondary')}
          {withdrawBtn('btn btn-secondary')}
          <ShareButton />
        </>}
        primary={validateBtn('btn btn-primary') || changeBtn('btn btn-primary') || undefined}
      />
    <div className="screen panes" style={{ flexDirection: 'column' }} data-screen-label="Fiche document">
      <RecordConsultation docId={doc.id} />

      {notice && (
        <div className={styles.stateNotice} data-state={notice.state} role="note">
          <Icon name={notice.state === 'archived' ? 'archive' : 'info'} size={16} style={{ flex: 'none' }} />
          <span>
            {notice.text}
            {replacedBy.length > 0 && <> · {tr('Replaced by')} {replacedBy.map((l, i) => <Fragment key={l.id}>{i > 0 && ', '}<Link href={l.doc.href} className={styles.noticeLink} title={l.doc.title}>{l.doc.id}</Link></Fragment>)}</>}
          </span>
        </div>
      )}
      {expiredL && (
        <div className={styles.stateNotice} data-state="expired" role="note">
          <Icon name="info" size={16} style={{ flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}>{expiredL}</span>
          <span className={styles.noticeActions}>{changeBtn('btn btn-secondary', smallBtn)}{withdrawBtn('btn btn-secondary', smallBtn)}</span>
        </div>
      )}
      {doc.reviewOverdue && (
        <div className={styles.stateNotice} data-state="review" role="note">
          <Icon name="info" size={16} style={{ flex: 'none' }} />
          <span style={{ flex: 1, minWidth: 0 }}>{tr('Periodic review overdue: due {date}.').replace('{date}', doc.reviewDueF)}</span>
          <span className={styles.noticeActions}>{reviewBtn('btn btn-secondary', smallBtn)}</span>
        </div>
      )}
      {awaiting && waitL && (
        <div className={styles.stateNotice} data-state="pending" role="note">
          <Icon name={lock ? 'lock' : 'info'} size={16} style={{ flex: 'none' }} />
          {waitRev ? (
            <span className={styles.noticeBody}>
              <span>{awaiting.ecoRef ?? awaiting.id} {tr('accepted')} : {waitL}.</span>
              {graftClosed && <span className={styles.noticeSub}>{graftClosed}</span>}
            </span>
          ) : <span>{tr('Vigie decision accepted, pending application')} ({awaiting.id}) : {waitL}.</span>}
          {graftBtn('btn btn-secondary', { flex: 'none', marginLeft: 'auto', fontSize: 12, padding: '5px 10px' })}
        </div>
      )}

      <div className={styles.body}>
        <Preview
          key={current?.id}
          doc={{ id: doc.id, title: doc.title, revLabel: currentLabel, departmentL: doc.departmentL, owner: doc.owner, dateF: current?.dateF ?? doc.modifiedF }}
          file={current && previewMime ? { url: `${fileUrl}?v=${current.id}`, mime: previewMime, name: current.fileName ?? `${doc.id}_${currentLabel}`, sizeF: current.sizeF } : null}
          pages={current?.pages ?? null}
          render={plan?.kind === 'render' ? { url: `${fileUrl}?v=${current!.id}&preview=pdf`, pages: plan.pages } : null}
          renderNote={plan?.kind === 'failed' ? (plan.reason === 'too_large' ? `${tr('File too large to be converted.')} ${tr('Download the file to read it.')}` : tr('The conversion of this file to PDF failed — download it to read it.')) : null}
          hasVersion={!!current}
        />
        <aside className={styles.side}>
          <div style={{ padding: '12px 18px 0' }}>
            <Segmented
              className={tabs.length > 5 ? `${styles.tabs} ${styles.tabsMany}` : styles.tabs}
              fullWidth
              label={tr('Record')}
              value={tab}
              options={tabs.map((k) => ({
                value: k,
                label: k === 'project' ? tr('Project') : k === 'versions' ? tr('Revisions') : k === 'requests' ? tr('Requests') : labelOf(tr, RECORD_TAB_LABEL, k),
                href: tabHref(k),
              }))}
            />
          </div>
          <div className={styles.sideBody}>
            {tab === 'project' && !project && (
              <div>
                <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{tr('This document is not linked to a project.')}</p>
                {attachBtn}
                {attachNote && <p className="text-muted" style={{ margin: '10px 0 0', fontSize: 11.5 }}>{attachNote}</p>}
              </div>
            )}
            {tab === 'project' && project && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span className="tag tag-accent">{project.code}</span>
                    {stageAt < 0 && <span className="tag tag-outline" title={tr('Phase not in Keystone’s list')}>{project.stage}</span>}
                    <span className="text-muted" style={{ fontSize: 11 }}>{tr('Synced from Keystone at')} {project.synced}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.3 }}>{project.name}</div>
                </div>
                {/* Keystone's phases (lib/i18n.ts PROJECT_PHASES): twelve where the design has four, so only the current one is
                    named under the row; each step says its name on hover. An unknown phase keeps its tag above. */}
                {stageAt >= 0 && (
                  <div className={styles.phases}>
                    <HStepper
                      items={PROJECT_PHASES.map((ph, i) => ({ key: ph, state: i < stageAt ? 'done' : i === stageAt ? 'current' : 'todo', title: '', hint: `${phaseLabel(ph, lang)} · ${tr('Phase {n} of {total}').replace('{n}', String(i + 1)).replace('{total}', String(PROJECT_PHASES.length))}` }))}
                      dot={10} gap={0} glow={10} minWidth={0} wrap={false} titleSize={0}
                    />
                    <div className={styles.phaseNow}>
                      <span>{phaseLabel(project.stage, lang)}</span>
                      <span className="text-muted tabnum">{tr('Phase {n} of {total}').replace('{n}', String(stageAt + 1)).replace('{total}', String(PROJECT_PHASES.length))}</span>
                    </div>
                  </div>
                )}
                <dl className="dl" style={{ gap: '8px 16px', fontSize: 12.5 }}>
                  <dt className="text-muted">{tr('Customer')}</dt><dd>{project.client}</dd>
                  <dt className="text-muted">{tr('Project manager')}</dt><dd>{project.manager}</dd>
                  <dt className="text-muted">{tr('Worksite')}</dt><dd>{project.site}</dd>
                  <dt className="text-muted">{tr('Third parties')}</dt><dd>{project.tiers}</dd>
                </dl>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={project.url} target="_blank" rel="noreferrer" className="btn btn-primary"><Icon name="openExternal" size={14} />{tr('Open in Keystone')}</a>
                  <Link href={`/recherche?project=${encodeURIComponent(project.code)}`} className="btn btn-secondary">{tr('Project documents')}</Link>
                </div>
                <section>
                  <div className="sec-head" style={{ marginBottom: 6 }}><h2 className="sec-title">{tr('Documents expected by Keystone')}</h2><span className="text-muted tabnum" style={{ fontSize: 11 }}>{pieces.filter((p) => p.d).length}/{project.expected.length}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {pieces.map((p) => {
                      const ring = p.st === 'ok' || p.st === 'wip' ? 'var(--color-accent)' : p.st === 'missing' ? 'var(--color-neutral-400)' : 'var(--color-neutral-700)';
                      const color = p.d && p.d.id === doc.id ? 'var(--color-accent-300)' : p.st === 'later' ? 'color-mix(in srgb,var(--color-text) 60%,transparent)' : 'inherit';
                      return (
                        <div key={p.id} className={`hairline ${styles.pieceRow}`}>
                          <div className={styles.pieceDot} style={{ border: `1.5px ${p.st === 'ok' || p.st === 'wip' ? 'solid' : 'dashed'} ${ring}`, background: p.st === 'ok' ? 'var(--color-accent)' : 'transparent' }}>
                            {p.st === 'ok' && <Icon name="tick" size={10} sw={3.5} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, color }}>{p.label}</div>
                            <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{p.d ? (p.visible ? `${p.st === 'ok' ? tr('Filed') : p.d.statusLabel} · ${p.d.id}` : p.st === 'ok' ? tr('Filed') : tr('in progress')) : p.st === 'later' ? tr('Expected later') : tr('Missing')}</div>
                          </div>
                          {p.d && p.visible && <Link href={p.d.href} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>{tr('Open')}</Link>}
                          {p.st === 'missing' && (
                            <DialogButton
                              spec={{ kind: 'new', preset: { projectCode: project.code, expectedId: p.id, typeCode: p.typeCode ?? undefined, title: p.label, label: p.label } }}
                              style={{ fontSize: 11, padding: '2px 8px' }} deniedTitle={deny('upload')}
                            >{tr('Upload')}</DialogButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section>
                  <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Keystone events')}</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {project.events.map((e) => <div key={e.id} className="feed"><span className="text-muted feed-when">{e.when}</span><span style={{ fontSize: 12.5 }}>{e.text}</span></div>)}
                  </div>
                </section>
              </div>
            )}

            {tab === 'meta' && (
              <>
                <Dl rows={[
                  [tr('Reference'), doc.id],
                  ...(doc.aliases.length ? [[tr('Former references'), doc.aliases.join(', ')] as [string, ReactNode]] : []),
                  [tr('Title'), doc.title],
                  [tr('Origin'), doc.originL],
                  [tr('Attachment'), doc.attachmentL],
                  [tr('Family'), doc.familyLabel],
                  [tr('Document type'), `${doc.typeCode} · ${doc.typeLabel}`],
                  [tr('Sub-type'), doc.subtype ?? '—'],
                  [tr('Owner'), doc.owner],
                  [tr('Author'), doc.author],
                  [tr('Status'), doc.statusLabel],
                  [tr('Department / Function'), doc.departmentL],
                  [tr('Site'), doc.siteL],
                  [tr('Confidentiality'), doc.confL],
                  [tr('Revision'), [inForce ? inForce.letter : tr('No revision in force'), wip].filter(Boolean).join(' · ')],
                  [tr('Issue date'), doc.issuedF],
                  // Never earlier than the day the revision actually entered into force (records written before that rule).
                  [tr('Effective date'), inForce ? (inForce.effectiveAt && (!inForce.inForceAt || inForce.effectiveAt >= inForce.inForceAt) ? inForce.effectiveF : inForce.inForceF) : '—'],
                  [tr('Review date'), doc.reviewDueF],
                  [tr('Expiry date'), doc.expiresF],
                  [tr('Language'), doc.lang === 'en' ? tr('English') : doc.lang === 'fr' ? tr('French') : doc.lang ?? '—'],
                  ...retentionRows,
                  [tr('Legal hold'), doc.legalHold ? `${tr('Active since')} ${fmtDate(doc.legalHoldAt, lang)}` : tr('None')],
                  [tr('Created'), doc.createdF],
                  [tr('Modified'), doc.modifiedF],
                  ...(type?.iso ? [[tr('ISO 9001 clause'), type.iso] as [string, ReactNode]] : []),
                  [tr('Keywords'), doc.keywords.length
                    ? <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{doc.keywords.map((k) => <span key={k} className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{k}</span>)}</span>
                    : '—'],
                ]} />

                {doc.origin === 'externe' && (
                  <section style={{ marginTop: 18 }}>
                    <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Origin')} · {doc.originL}</h2>
                    <Dl rows={[[tr('Source organisation'), doc.sourceOrg ?? '—'], [tr('External reference'), doc.externalRef ?? '—'], [tr('Received on'), fmtDate(doc.receivedAt, lang)]]} />
                  </section>
                )}
                {doc.origin === 'interne' && (
                  <section style={{ marginTop: 18 }}>
                    <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Origin')} · {doc.originL}</h2>
                    <Dl rows={[[tr('Process owner'), doc.processOwnerId ? ctx.userName(doc.processOwnerId) : '—']]} />
                  </section>
                )}
                {doc.attachment === 'project' && (
                  <section style={{ marginTop: 18 }}>
                    <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Attachment')} · {doc.attachmentL}</h2>
                    <Dl rows={[[tr('Project'), doc.contextL], [tr('Project phase'), doc.projectPhase ? phaseLabel(doc.projectPhase, lang) : '—'], [tr('Work package'), doc.workPackage ?? '—'], [tr('Discipline'), doc.discipline ?? '—']]} />
                  </section>
                )}
                {doc.attachment === 'research' && (
                  <section style={{ marginTop: 18 }}>
                    <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Attachment')} · {doc.attachmentL}</h2>
                    <Dl rows={[[tr('Research programme'), doc.contextL], [tr('Research theme'), doc.researchTheme ?? '—'], [tr('Study / trial ID'), doc.studyId ?? '—'], [tr('Publication / IP status'), doc.ipStatus ?? '—']]} />
                  </section>
                )}
                {doc.attachment === 'capex' && (
                  <section style={{ marginTop: 18 }}>
                    <h2 className="sec-title" style={{ marginBottom: 10 }}>{tr('Attachment')} · {doc.attachmentL}</h2>
                    <Dl rows={[[tr('CAPEX'), doc.contextL], [tr('Subsidiary'), capexOf?.subsidiary ?? '—'], [tr('Worksite'), capexOf?.site ?? '—'], [tr('DIG-PRODI phase'), capexOf?.phase ?? '—']]} />
                  </section>
                )}
                {tplTypes && (
                  <section style={{ marginTop: 18 }} aria-labelledby="doc-template-types">
                    <div className="sec-head" style={{ marginBottom: 8 }}><h2 className="sec-title" id="doc-template-types">{tr('Target types')}</h2><span className="text-muted tabnum" style={{ fontSize: 11 }}>{tplTypes.length}</span></div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 12.5 }}>
                      {tplTypes.length
                        ? tplTypes.map((c) => <span key={c} className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }} title={ctx.label('type', c)}>{c} · {ctx.label('type', c)}</span>)
                        : <span className="text-muted">{tr('No target type: the template is offered among the other templates.')}</span>}
                    </div>
                  </section>
                )}
                {showReaders && (
                  <section style={{ marginTop: 18 }}>
                    <div className="sec-head" style={{ marginBottom: 8 }}><h2 className="sec-title">{tr('Named readers')}</h2><span className="text-muted tabnum" style={{ fontSize: 11 }}>{readerIds.length}</span></div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 12.5 }}>
                      {readerIds.length ? readerIds.map((u) => <span key={u} className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{ctx.userName(u)}</span>) : '—'}
                    </div>
                  </section>
                )}
                <section style={{ marginTop: 18 }} aria-labelledby="doc-links">
                  <div className="sec-head" style={{ marginBottom: 4 }}><h2 className="sec-title" id="doc-links">{tr('Related documents')}</h2><span className="text-muted tabnum" style={{ fontSize: 11 }}>{links.length}</span></div>
                  {links.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {links.map((l) => (
                        <div key={l.id} className={`hairline ${styles.pieceRow}`}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="text-muted" style={{ fontSize: 11 }}>{l.relL}</div>
                            <Link href={l.doc.href} className="link-plain ellipsis" style={{ display: 'block', fontSize: 12.5 }} title={l.doc.title}>{l.doc.id} · {l.doc.title}</Link>
                          </div>
                          <span className={l.doc.tagClass} style={{ fontSize: 10.5, padding: '2px 8px', flex: 'none' }}>{l.doc.statusLabel}</span>
                          {linksEditable && l.editable && (
                            <ActionButton
                              action={removeDocLink.bind(null, doc.id, l.id)} confirm={tr('Remove the link with {id}?').replace('{id}', l.doc.id)}
                              className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', flex: 'none' }}
                              disabled={!!linkHold || l.frozen} title={linkHold ?? (l.frozen ? tr('Document under legal hold: its links do not change.') : undefined)}
                              ariaLabel={`${tr('Remove')} : ${l.relL} ${l.doc.id}`}
                            >{tr('Remove')}</ActionButton>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>{tr('No related document.')}</p>}
                </section>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
                  <DialogButton spec={{ kind: 'meta', doc: meta }} icon="pen" deniedTitle={metaDenied}>{tr('Edit metadata')}</DialogButton>
                  {reviewBtn('btn btn-secondary')}
                  {showReaders && isOwner && <DialogButton spec={{ kind: 'readers', docId: doc.id, readers: readerIds, version: doc.version }} icon="lock" deniedTitle={lock ?? deny('edit')}>{tr('Named readers')}</DialogButton>}
                  {tplTypes && isOwner && (
                    <DialogButton spec={{ kind: 'templateTypes', docId: doc.id, title: doc.title, types: tplTypes, version: doc.version }} icon="pen" deniedTitle={lock ?? (mayLinkTemplate(ctx, doc) ? undefined : deny('edit'))}>{tr('Target types')}</DialogButton>
                  )}
                  <DialogButton
                    spec={{ kind: 'link', docId: doc.id, title: doc.title, withdrawn: !!doc.obsoleteAt, active: doc.state === 'active' }} icon="plus"
                    deniedTitle={deny('edit') ?? (linksEditable ? undefined : tr('A link is added or removed by the owner of both documents or by a records manager.')) ?? linkHold}
                  >{tr('Link a document')}</DialogButton>
                  {doc.eventTrigger && (
                    <DialogButton
                      spec={{ kind: 'retentionEvent', docId: doc.id, title: doc.title, triggerL: labelOf(tr, TRIGGER_LABEL, doc.retentionTrigger), eventAt: doc.retentionEventAt, maxDate: todayIso(), version: doc.version }}
                      icon="pen" deniedTitle={eventDenied}
                    >{tr('Event date')}</DialogButton>
                  )}
                  {ctx.screens.retention && type && (
                    <DialogButton
                      spec={{
                        kind: 'retentionClass', docId: doc.id, title: doc.title, version: doc.version, override: doc.retentionOverride,
                        current: { retentionYears: doc.retentionYears, retentionTrigger: doc.retentionTrigger, retentionDisposition: doc.retentionDisposition },
                        type: { code: type.code, retentionYears: type.retentionYears, retentionTrigger: type.retentionTrigger, retentionDisposition: type.retentionDisposition },
                      }}
                      icon="archive" deniedTitle={mayManageRetention(ctx) ? (doc.legalHold ? tr('Document under legal hold: it cannot be changed.') : undefined) : `${tr('Permission required')} : ${tr('Archive')}`}
                    >{tr('Retention class')}</DialogButton>
                  )}
                  {canRelease && <ActionButton action={releaseHold.bind(null, doc.id)} confirm={`${tr('Release legal hold')}${lang === 'fr' ? ' ' : ''}?`}><Icon name="lock" size={14} />{tr('Release legal hold')}</ActionButton>}
                </div>
              </>
            )}

            {tab === 'versions' && (
              <RevisionsTab docId={doc.id} revisions={revItems} current={current ? lite(current) : null} restore={restore} />
            )}

            {tab === 'approval' && (
              <>
                {running ? (
                  <>
                    <div className="sec-head" style={{ marginBottom: 4 }}><span style={{ fontSize: 13 }}>{tr('Revision')} {running.letter}</span>{running.visible ? <Link href={running.href} className="link-plain" style={{ fontSize: 12 }}>{running.id}</Link> : <span className="text-muted" style={{ fontSize: 12 }}>{running.id}</span>}</div>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
                      {tr('Requested by')} {running.requester} · {tr('Due')} {running.dueF}
                      {running.lateL && <> <span className="tag tag-outline" style={{ fontSize: 10.5, padding: '0 6px', marginLeft: 4 }} title={running.lateTitle ?? undefined}>{running.lateL}</span></>}
                    </div>
                    <VStepper items={running.steps.map((st) => ({ key: st.idx, state: st.state, title: st.nameL, lines: [`${st.assignee} · ${st.stateLabel}${st.dateF ? ` ${st.dateF}` : ''}`] }))} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {running.visible && <Link href={running.href} className="btn btn-primary">{tr('Open')}</Link>}
                      {/* Its requester or a records manager may recall it before the last approval (lib/access.ts, mayRecall). */}
                      {running.recallable && (
                        <DialogButton
                          spec={{ kind: 'recall', workflowId: running.id, step: running.step, stepName: running.stepName, docId: doc.id, title: doc.title, letter: running.letter }}
                          className="btn btn-ghost" deniedTitle={lock}
                        >{tr('Recall the request')}</DialogButton>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{tr('No approval workflow in progress for this document.')}</p>
                    {validateBtn('btn btn-primary')}
                  </>
                )}
                {finished.length > 0 && (
                  <section style={{ marginTop: 22 }}>
                    <h2 className="sec-title" style={{ marginBottom: 6 }}>{tr('Completed')}</h2>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {finished.map((w) => (
                        <div key={w.id} className={`hairline ${styles.pieceRow}`}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5 }}>{tr('Revision')} {w.letter} <span className="text-muted">· {w.id}</span></div>
                            <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{w.requester} · {fmtDate(w.createdAt, lang)}</div>
                            {/* Who rejected or recalled it, when, and why (the reason of a rejection is required). */}
                            {w.outcome !== 'approved' && w.closer && <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{w.outcomeL} · {w.closer}{w.closedF ? ` · ${w.closedF}` : ''}</div>}
                            {w.reason && <div style={{ fontSize: 12, marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><span className="text-muted">{tr('Reason')} : </span>{w.reason}</div>}
                          </div>
                          <span className={w.outcome === 'approved' ? 'tag tag-accent' : 'tag tag-outline'} style={{ fontSize: 10.5, padding: '2px 8px' }}>{w.outcomeL}</span>
                          {w.visible && <Link href={w.href} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>{tr('Open')}</Link>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === 'requests' && (
              <>
                {requests.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {requests.map((r) => (
                      <div key={r.id} className={`hairline ${styles.requestRow}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="tabnum" style={{ fontSize: 13 }}>{r.id}</span>
                          <span className={ECR_TAGCLS[r.status] ?? 'tag tag-neutral'} style={{ fontSize: 10.5, padding: '2px 8px' }}>{r.statusL}</span>
                          <span className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{r.kindL}</span>
                        </div>
                        <div style={{ fontSize: 12.5, marginTop: 6 }}>{r.reason}</div>
                        {r.description && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.description}</div>}
                        {r.replacement && (
                          <div style={{ fontSize: 11.5, marginTop: 4 }}>
                            <span className="text-muted">{tr('Proposed replacement')} : </span><Link href={r.replacement.href} className="link-plain">{r.replacement.id}</Link> <span className="text-muted">· {r.replacement.title}</span>
                          </div>
                        )}
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {tr('Requested by')} {r.requester} · {r.when}
                          {r.ecoRef && ` · ${tr('ECO')} : ${r.ecoRef}`}
                          {r.modifier && ` · ${tr('Designated author')} : ${r.modifier}`}
                        </div>
                        {r.decisionNote && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.decisionNote}</div>}
                        {carriedBy(r) && <div style={{ fontSize: 11.5, marginTop: 4 }}>{carriedBy(r)}</div>}
                        {r.status === 'accepted' && waitL && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 4 }}>
                            <Icon name={lock ? 'lock' : 'info'} size={12} style={{ flex: 'none' }} />{tr('Pending application')} : {waitL}.
                          </div>
                        )}
                        {r.id === awaiting?.id && graftClosed && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{graftClosed}</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          {r.id === awaiting?.id && graftBtn('btn btn-secondary', { fontSize: 11, padding: '2px 8px' })}
                          <a href={vigieUrl(r.id)} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}><Icon name="openExternal" size={12} />{tr('Open in Vigie')}</a>
                          {simulateVigie && r.status === 'submitted' && vigieSpecs.has(r.id) && (
                            <DialogButton spec={{ kind: 'vigie', requestId: r.id, docTitle: doc.title, change: r.kind, ...vigieSpecs.get(r.id)! }} style={{ fontSize: 11, padding: '2px 8px' }}>{tr('Vigie simulation')}</DialogButton>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{tr('No change or withdrawal request for this document.')}</p>
                )}
                {(canChange || canWithdraw) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: requests.length ? 16 : 0 }}>
                    {changeBtn('btn btn-secondary')}
                    {withdrawBtn('btn btn-secondary')}
                  </div>
                )}
              </>
            )}

            {tab === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Segmented
                  className="codex-seg"
                  wrap
                  value={hist}
                  label={tr('History')}
                  options={HIST.map((k) => ({ value: k, label: labelOf(tr, HISTORY_LABEL, k), href: `${doc.href}?tab=history${k === 'activity' ? '' : `&hist=${k}`}` }))}
                />
                {hist === 'consultations' && <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>{tr('One entry per person, record or version viewed and {n}-minute period.').replace('{n}', String(CONSULT_WINDOW_MINUTES))}</p>}
                {(hist === 'consultations' ? consultations : hist === 'metadata' ? history.filter((h) => METADATA.has(h.action)) : history.length ? history : [{ id: 0, when: doc.createdF, user: doc.owner, actionLabel: tr('Upload#activity'), detail: 'A.1' }]).map((h) => (
                  <div key={h.id} className="feed">
                    <span className="text-muted feed-when">{h.when}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, minWidth: 0, overflowWrap: 'anywhere' }}>{h.actionLabel}{h.detail && <span className="text-muted"> · {h.detail}</span>}</div><div className="text-muted" style={{ fontSize: 11 }}>{h.user}</div></div>
                  </div>
                ))}
                {hist !== 'activity' && !(hist === 'consultations' ? consultations : history.filter((h) => METADATA.has(h.action))).length && <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{tr('No entries.')}</p>}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
    </>
  );
}
