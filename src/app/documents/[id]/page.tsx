import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MetaDoc, VersionLite } from '@/components/dialogs/types';
import { Forbidden } from '@/components/ui/Forbidden';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { VStepper } from '@/components/ui/Stepper';
import { getDb } from '@/db';
import { ActionButton, DialogButton, ShareButton } from '@/components/ui/client';
import { canRead, readerMaySeeRevision, readerMaySeeVersion, readersApply } from '@/lib/access';
import { releaseHold } from '@/lib/actions';
import { isFinalStatus } from '@/lib/codes';
import { getCtx } from '@/lib/context';
import { fmtDate, todayIso } from '@/lib/format';
import { getProject } from '@/lib/keystone';
import { defaultModifier } from '@/lib/lifecycle';
import { decisionWaitL, getDoc, listAudit, listChangeRequests, listDocs, listRevisions, listWorkflows, stateNotice, typeView, type RevisionView } from '@/lib/queries';
import { normalizeMime } from '@/lib/storage';
import { vigieSimulated, vigieUrl } from '@/lib/vigie';
import { Preview, RevisionsTab, type RevItem } from './DocClient';
import styles from './document.module.css';

const TABS = ['project', 'meta', 'versions', 'approval', 'requests', 'history'] as const;
type Tab = (typeof TABS)[number];

/** Revision statuses of the revision being drafted, reviewed or waiting for its effective date. */
const WORKING = new Set(['draft', 'in_review', 'approved']);
const ECR_TAG: Record<string, string> = { submitted: 'tag tag-outline', accepted: 'tag tag-accent', rejected: 'tag tag-neutral', implemented: 'tag tag-accent' };
/** Audit actions that change the document's content or record ("Modifié … par …"). */
const MODIFYING = new Set(['upload', 'working', 'edit', 'reclass', 'restore']);

type Version = RevisionView['versions'][number];
const lite = (v: Version): VersionLite => ({ id: v.id, label: v.label, author: v.author, dateF: v.dateF, commentL: v.commentL, sizeF: v.sizeF, pages: v.pages, fileName: v.fileName });

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

export default async function DocumentPage({ params, searchParams }: PageProps<'/documents/[id]'>) {
  const { id: rawId } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const id = safeDecode(rawId);
  const ctx = await getCtx();
  const { t, lang } = ctx;
  const res = await getDoc(ctx, id);
  if (!res) {
    return (
      <div className="screen" style={{ padding: 'var(--space-8)' }}>
        <p className="text-muted">{t.not_found}</p>
        <Link href="/" className="btn btn-secondary">{t.back_home}</Link>
      </div>
    );
  }
  // Drafts are only visible to their drafting circle; confidential documents to their audience (lib/access.ts).
  if (res === 'hidden') return <Forbidden text={t.no_access} back={t.back_home} />;
  const { doc, circle, ix } = res;
  // A former reference (reclassification, migration) resolves to the document under its current ID.
  if (doc.id !== id) redirect(`${doc.href}${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ''}`);

  const [project, revs, workflows, requests, history, projectDocs] = await Promise.all([
    doc.attachment === 'project' && doc.projectCode ? getProject(ctx, doc.projectCode) : null,
    listRevisions(ctx, doc.id),
    listWorkflows(ctx),
    listChangeRequests(ctx, { docId: doc.id }),
    listAudit(ctx, { docId: doc.id }),
    doc.attachment === 'project' && doc.projectCode ? listDocs(ctx, { includeHidden: true }) : [],
  ]);

  const tabs = TABS.filter((k) => k !== 'project' || project);
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

  const docWfs = workflows.filter((w) => w.docId === doc.id);
  const runningAny = docWfs.find((w) => !w.outcome) ?? null;
  const running = circle ? runningAny : null;
  // Outside the drafting circle, only circuits of revisions every reader sees (D-14).
  const finished = docWfs.filter((w) => w.outcome && readerMaySeeRevision(circle, w.revStatus)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

  const deny = (p: 'upload' | 'edit' | 'publish') => (ctx.can(p) ? undefined : `${t.not_allowed} : ${t[`perm_${p}`]}`);
  // Archived, obsolete or frozen records are read-only (same rule as lib/actions.ts).
  const lock = doc.state === 'archived' ? t.locked_archived : doc.state === 'obsolete' ? t.locked_obsolete : doc.legalHold ? t.locked_hold : undefined;
  const pending = requests.find((r) => r.status === 'submitted' || r.status === 'accepted');
  // Vigie's acceptance recorded while the document is locked: it applies when the lock lifts (lib/lifecycle.ts).
  const awaiting = pending?.status === 'accepted' ? pending : null;
  const waitL = decisionWaitL(t, doc);
  // Outside the drafting circle, a change order whose revision is not in force yet, or not open yet (acceptance waiting
  // for the lock to lift), names neither itself nor its author (D-14).
  const unseenRefs = new Set(revs.filter((r) => r.changeRef && !readerMaySeeRevision(circle, r.status)).map((r) => r.changeRef));
  const unseen = (r: (typeof requests)[number]) => unseenRefs.has(r.ecoRef ?? r.id) || (!circle && r.status === 'accepted' && r.kind === 'modification');
  const shownRequests = requests.map((r) => (unseen(r) ? { ...r, ecoRef: null, modifier: null } : r));
  const notice = stateNotice(ctx, doc, shownRequests);
  const changeLock = lock ?? (pending ? `${t.change_pending} : ${pending.id}` : undefined);
  const drafting = circle && working?.status === 'draft' ? working : null;
  const isOwner = ctx.seesAll || doc.ownerId === ctx.user.id;
  const type = ctx.typeByCode.get(doc.typeCode);
  const circuitL = type ? typeView(ctx, type).circuitL : '';
  // Outside the drafting circle, the date (docView) and the person both come from what the user sees (D-14).
  const modifiedBy = history.find((h) => MODIFYING.has(h.action))?.user ?? doc.owner;
  // The revision being drafted exists for its drafting circle only (D-14).
  const wip = circle && working ? `${t.rev_short} ${working.label} ${t.in_progress}` : null;

  const workingBtn = drafting && (
    <DialogButton spec={{ kind: 'working', docId: doc.id, nextLabel: `${drafting.letter}.${(drafting.file?.n ?? 0) + 1}` }} icon="upload" deniedTitle={lock ?? deny('upload')}>
      {t.new_working_version}
    </DialogButton>
  );
  // A circuit already running: follow it (in Validations when the user takes part, else in the Validation tab).
  const validateBtn = (cls: string) => running
    ? <Link href={running.visible ? running.href : tabHref('approval')} className={cls}><Icon name="check" size={14} />{t.follow_workflow}</Link>
    : drafting && (
      <DialogButton
        spec={{ kind: 'validate', docId: doc.id, title: doc.title, revLabel: drafting.label, circuitL, minDate: todayIso() }}
        className={cls} icon="check" deniedTitle={lock ?? deny('edit') ?? (type && !type.circuit.length ? deny('publish') : undefined) ?? (drafting.versions.length ? undefined : t.need_file)}
      >{t.request_validation}</DialogButton>
    );
  // A change request needs a revision in force and no revision already open; a withdrawal only a revision in force.
  const canChange = !!doc.revInForce && !working;
  const canWithdraw = !!doc.revInForce && doc.state !== 'obsolete';
  const changeBtn = (cls: string) => canChange && (
    <DialogButton spec={{ kind: 'change', docId: doc.id, title: doc.title, change: 'modification' }} className={cls} icon="pen" deniedTitle={changeLock ?? deny('edit')}>{t.request_change}</DialogButton>
  );
  const withdrawBtn = (cls: string) => canWithdraw && (
    <DialogButton spec={{ kind: 'change', docId: doc.id, title: doc.title, change: 'obsolescence' }} className={cls} deniedTitle={changeLock ?? deny('edit')}>{t.request_obsolete}</DialogButton>
  );

  // A piece counts as filled only by a document of this project; a document the user cannot see shows no ID or status.
  const pieces = project ? project.expected.map((p) => {
    const d = p.docId ? projectDocs.find((x) => x.id === p.docId && x.attachment === 'project' && x.projectCode === project.code) : undefined;
    const st = d ? (d.revInForce ? 'ok' : 'wip') : p.later ? 'later' : 'missing';
    return { ...p, d, st, visible: !!d && canRead(ctx, d, ix) };
  }) : [];

  // Outside the drafting circle: the revision in force and those it replaced, nothing of a revision open or cancelled.
  const revItems: RevItem[] = revs.filter((r) => readerMaySeeRevision(circle, r.status)).map((r) => {
    const dates = [
      r.effectiveAt && `${t.effective_at} : ${r.effectiveF}`,
      r.status === 'approved' && r.approvedAt && `${t.st_approved} : ${r.approvedF}`,
      r.inForceAt && `${t.st_in_force} : ${r.inForceF}`,
      r.supersededAt && `${t.st_superseded} : ${r.supersededF}`,
    ].filter((x): x is string => !!x);
    const who = [r.modifier && `${t.modifier} : ${r.modifier}`, r.changeRef && `${t.eco_ref} : ${r.changeRef}`].filter((x): x is string => !!x);
    return {
      id: r.id, letter: r.letter, statusLabel: r.statusLabel, tagClass: r.tagClass,
      lines: [dates.length ? dates.join(' · ') : `${t.created} ${r.createdF}`, ...(who.length ? [who.join(' · ')] : [])],
      // Working versions belong to the drafting circle; others get the final file of the revision in force, under its letter.
      versions: circle
        ? r.versions.map((v) => ({ ...lite(v), current: v.id === current?.id }))
        : r.file && readerMaySeeVersion(false, r.status, true) ? [{ ...lite(r.file), label: r.letter, current: r.file.id === current?.id }] : null,
    };
  });

  const meta: MetaDoc = {
    id: doc.id, title: doc.title, typeCode: doc.typeCode, subtype: doc.subtype, origin: doc.origin, attachment: doc.attachment,
    projectCode: doc.projectCode, programCode: doc.programCode, department: doc.department, site: doc.site, ownerId: doc.ownerId,
    authorText: doc.authorText, conf: doc.conf, keywords: doc.keywords, lang: doc.lang, reviewDueAt: doc.reviewDueAt, expiresAt: doc.expiresAt,
    sourceOrg: doc.sourceOrg, externalRef: doc.externalRef, receivedAt: doc.receivedAt,
    projectPhase: doc.projectPhase, workPackage: doc.workPackage, discipline: doc.discipline,
    researchTheme: doc.researchTheme, studyId: doc.studyId, ipStatus: doc.ipStatus, processOwnerId: doc.processOwnerId,
    idMayChange: !revs.some((r) => r.approvedAt),
    classificationLocked: circle && !!runningAny,
  };
  const readerIds = [...ix.readers(doc.id)];
  // Named readers count for confidential levels; leftovers on a lower level stay listed so they can be removed.
  const showReaders = readersApply(doc.conf) || readerIds.length > 0;
  const simulateVigie = ctx.seesAll && vigieSimulated();
  // Simulated Vigie decision: the author proposed by default (requester if they may write and still see the document,
  // else the owner), why an acceptance cannot be given, or that it will wait for the lock to lift (same rules as
  // lib/lifecycle.ts applyChangeDecision).
  const db = await getDb();
  const vigieSpecs = simulateVigie
    ? new Map(await Promise.all(requests.filter((r) => r.status === 'submitted').map(async (r) => [r.id, {
      modifierId: await defaultModifier(db, r.requesterId, doc),
      locked: !lock && r.kind === 'modification' && doc.revWorking ? t.locked_working : undefined,
      deferred: lock ? `${lock} ${t.vigie_deferred} : ${waitL}.` : undefined,
    }] as const)))
    : new Map<string, { modifierId: string; locked?: string; deferred?: string }>();
  const canRelease = doc.legalHold && ctx.can('archive') && ctx.screens.retention;
  const previewMime = current?.fileKey && current.mime ? normalizeMime(current.mime, current.fileName ?? '') : null;

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-screen-label="Fiche document">
      <div className={styles.head}>
        <Link href="/explorateur" className="btn btn-ghost" style={{ padding: '6px 6px', fontSize: 12, marginTop: 2 }}><Icon name="back" size={14} />{t.back}</Link>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {doc.id}{doc.aliases.length > 0 && ` · ${t.aliases} : ${doc.aliases.join(', ')}`} · {doc.path}
          </div>
          <h3 className={styles.title}>{doc.title}</h3>
          <div className={styles.tags}>
            {doc.attachment === 'project' && doc.projectCode && <span className="tag tag-accent">{doc.projectCode}</span>}
            {doc.attachment === 'research' && doc.programCode && <span className="tag tag-accent">{doc.programCode}</span>}
            <span className={doc.tagClass}>{doc.statusLabel}</span>
            <span className="tag tag-neutral">{doc.typeLabel}</span>
            {inForce && <span className="tag tag-neutral">{t.rev_short} {inForce.letter}</span>}
            {wip && <span className="tag tag-outline">{wip}</span>}
            <span className="tag tag-neutral">{doc.confL}</span>
            {doc.legalHold && <span className="tag tag-outline"><Icon name="lock" size={11} style={{ marginRight: 4 }} />{t.hold}</span>}
            <span className="text-muted nowrap" style={{ fontSize: 12, marginLeft: 4 }}>{t.modified} {doc.modifiedF} {t.by} {modifiedBy}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {current
            ? <a href={`${fileUrl}?v=${current.id}&download=1`} className="btn btn-secondary"><Icon name="download" size={14} />{t.download}</a>
            : <button type="button" className="btn btn-secondary" aria-disabled title={t.no_version}><Icon name="download" size={14} />{t.download}</button>}
          {workingBtn}
          {validateBtn('btn btn-primary')}
          {changeBtn('btn btn-primary')}
          {withdrawBtn('btn btn-secondary')}
          <ShareButton />
        </div>
      </div>

      {notice && (
        <div className={styles.stateNotice} data-state={notice.state} role="note">
          <Icon name={notice.state === 'archived' ? 'archive' : 'info'} size={16} style={{ flex: 'none' }} />
          <span>{notice.text}</span>
        </div>
      )}
      {awaiting && (
        <div className={styles.stateNotice} data-state="pending" role="note">
          <Icon name="lock" size={16} style={{ flex: 'none' }} />
          <span>{t.ecr_accepted_waiting} ({awaiting.id}) : {waitL}.</span>
        </div>
      )}

      <div className={styles.body}>
        <Preview
          key={current?.id}
          doc={{ id: doc.id, title: doc.title, revLabel: currentLabel, departmentL: doc.departmentL, owner: doc.owner, dateF: current?.dateF ?? doc.modifiedF }}
          file={current && previewMime ? { url: `${fileUrl}?v=${current.id}`, mime: previewMime, name: current.fileName ?? `${doc.id}_${currentLabel}`, sizeF: current.sizeF } : null}
          pages={current?.pages ?? null}
          hasVersion={!!current}
        />
        <aside className={styles.side}>
          <div style={{ padding: '12px 18px 0' }}>
            <Seg
              name="docTab"
              value={tab}
              style={{ display: 'flex', width: '100%' }}
              optStyle={{ flex: 1, justifyContent: 'center', padding: tabs.length > 5 ? '6px 1px' : '6px 2px', fontSize: tabs.length > 5 ? 11 : 11.5, whiteSpace: 'nowrap' }}
              options={tabs.map((k) => ({
                key: k,
                label: k === 'project' ? t.project : k === 'versions' ? t.tab_revisions : k === 'requests' ? t.tab_requests : t[`tab_${k}`],
                href: tabHref(k),
              }))}
            />
          </div>
          <div className={styles.sideBody}>
            {tab === 'project' && project && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span className="tag tag-accent">{project.code}</span>
                    <span className="tag tag-outline">{project.stage}</span>
                    <span className="text-muted" style={{ fontSize: 11 }}>{t.synced} {project.synced}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.3 }}>{project.name}</div>
                </div>
                <dl className="dl" style={{ gap: '8px 16px', fontSize: 12.5 }}>
                  <dt className="text-muted">{t.client}</dt><dd>{project.client}</dd>
                  <dt className="text-muted">{t.pm}</dt><dd>{project.manager}</dd>
                  <dt className="text-muted">{t.site}</dt><dd>{project.site}</dd>
                  <dt className="text-muted">{t.tiers}</dt><dd>{project.tiers}</dd>
                </dl>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={project.url} target="_blank" rel="noreferrer" className="btn btn-primary"><Icon name="openExternal" size={14} />{t.open_keystone}</a>
                  <Link href={`/recherche?project=${encodeURIComponent(project.code)}`} className="btn btn-secondary">{t.project_docs}</Link>
                </div>
                <section>
                  <div className="sec-head" style={{ marginBottom: 6 }}><h6 className="sec-title">{t.expected_pieces}</h6><span className="text-muted tabnum" style={{ fontSize: 11 }}>{pieces.filter((p) => p.d).length}/{project.expected.length}</span></div>
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
                            <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{p.d ? (p.visible ? `${p.st === 'ok' ? t.provided : p.d.statusLabel} · ${p.d.id}` : p.st === 'ok' ? t.provided : t.in_progress) : p.st === 'later' ? t.later : t.missing}</div>
                          </div>
                          {p.d && p.visible && <Link href={p.d.href} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>{t.open}</Link>}
                          {p.st === 'missing' && (
                            <DialogButton
                              spec={{ kind: 'new', preset: { projectCode: project.code, expectedId: p.id, typeCode: p.typeCode ?? undefined, title: p.label, label: p.label } }}
                              style={{ fontSize: 11, padding: '2px 8px' }} deniedTitle={deny('upload')}
                            >{t.deposit}</DialogButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section>
                  <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.ks_feed}</h6>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {project.events.map((e) => <div key={e.id} className="feed"><span className="text-muted feed-when">{e.when}</span><span style={{ fontSize: 12.5 }}>{e.text}</span></div>)}
                  </div>
                </section>
              </div>
            )}

            {tab === 'meta' && (
              <>
                <Dl rows={[
                  [t.ref, doc.id],
                  ...(doc.aliases.length ? [[t.aliases, doc.aliases.join(', ')] as [string, ReactNode]] : []),
                  [t.title_label, doc.title],
                  [t.origin, doc.originL],
                  [t.attachment, doc.attachmentL],
                  [t.family, doc.familyLabel],
                  [t.doc_type, `${doc.typeCode} · ${doc.typeLabel}`],
                  [t.subtype, doc.subtype ?? '—'],
                  [t.owner, doc.owner],
                  [t.author_label, doc.author],
                  [t.status, doc.statusLabel],
                  [t.department, doc.departmentL],
                  [t.site_label, doc.siteL],
                  [t.conf, doc.confL],
                  [t.revision, [inForce ? inForce.letter : t.no_rev_in_force, wip].filter(Boolean).join(' · ')],
                  [t.issued_at, doc.issuedF],
                  // Never earlier than the day the revision actually entered into force (records written before that rule).
                  [t.effective_at, inForce ? (inForce.effectiveAt && (!inForce.inForceAt || inForce.effectiveAt >= inForce.inForceAt) ? inForce.effectiveF : inForce.inForceF) : '—'],
                  [t.review_due_at, doc.reviewDueF],
                  [t.expires_at, doc.expiresF],
                  [t.language, doc.lang === 'en' ? t.lang_en : doc.lang === 'fr' ? t.lang_fr : doc.lang ?? '—'],
                  [t.retention_class, doc.retentionL],
                  [t.until, doc.untilF],
                  [t.hold, doc.legalHold ? `${t.hold_on} ${fmtDate(doc.legalHoldAt, lang)}` : t.hold_off],
                  [t.created, doc.createdF],
                  [t.modified, doc.modifiedF],
                  ...(type?.iso ? [[t.iso_clause, type.iso] as [string, ReactNode]] : []),
                  [t.keywords, doc.keywords.length
                    ? <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{doc.keywords.map((k) => <span key={k} className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{k}</span>)}</span>
                    : '—'],
                ]} />

                {doc.origin === 'externe' && (
                  <section style={{ marginTop: 18 }}>
                    <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.origin} · {doc.originL}</h6>
                    <Dl rows={[[t.source_org, doc.sourceOrg ?? '—'], [t.external_ref, doc.externalRef ?? '—'], [t.received_at, fmtDate(doc.receivedAt, lang)]]} />
                  </section>
                )}
                {doc.origin === 'interne' && (
                  <section style={{ marginTop: 18 }}>
                    <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.origin} · {doc.originL}</h6>
                    <Dl rows={[[t.process_owner, doc.processOwnerId ? ctx.userName(doc.processOwnerId) : '—']]} />
                  </section>
                )}
                {doc.attachment === 'project' && (
                  <section style={{ marginTop: 18 }}>
                    <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.attachment} · {doc.attachmentL}</h6>
                    <Dl rows={[[t.project, doc.contextL], [t.project_phase, doc.projectPhase ?? '—'], [t.work_package, doc.workPackage ?? '—'], [t.discipline, doc.discipline ?? '—']]} />
                  </section>
                )}
                {doc.attachment === 'research' && (
                  <section style={{ marginTop: 18 }}>
                    <h6 className="sec-title" style={{ marginBottom: 10 }}>{t.attachment} · {doc.attachmentL}</h6>
                    <Dl rows={[[t.program, doc.contextL], [t.research_theme, doc.researchTheme ?? '—'], [t.study_id, doc.studyId ?? '—'], [t.ip_status, doc.ipStatus ?? '—']]} />
                  </section>
                )}
                {showReaders && (
                  <section style={{ marginTop: 18 }}>
                    <div className="sec-head" style={{ marginBottom: 8 }}><h6 className="sec-title">{t.readers}</h6><span className="text-muted tabnum" style={{ fontSize: 11 }}>{readerIds.length}</span></div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 12.5 }}>
                      {readerIds.length ? readerIds.map((u) => <span key={u} className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{ctx.userName(u)}</span>) : '—'}
                    </div>
                  </section>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
                  <DialogButton spec={{ kind: 'meta', doc: meta }} icon="pen" deniedTitle={lock ?? deny('edit') ?? (isOwner ? undefined : `${t.not_allowed} : ${t.owner}`)}>{t.edit_meta}</DialogButton>
                  {showReaders && isOwner && <DialogButton spec={{ kind: 'readers', docId: doc.id, readers: readerIds }} icon="lock" deniedTitle={lock ?? deny('edit')}>{t.readers}</DialogButton>}
                  {canRelease && <ActionButton action={releaseHold.bind(null, doc.id)} confirm={`${t.release_hold}${lang === 'fr' ? ' ' : ''}?`}><Icon name="lock" size={14} />{t.release_hold}</ActionButton>}
                </div>
              </>
            )}

            {tab === 'versions' && (
              <RevisionsTab docId={doc.id} revisions={revItems} current={current ? lite(current) : null} />
            )}

            {tab === 'approval' && (
              <>
                {running ? (
                  <>
                    <div className="sec-head" style={{ marginBottom: 4 }}><span style={{ fontSize: 13 }}>{t.revision} {running.letter}</span>{running.visible ? <Link href={running.href} className="link-plain" style={{ fontSize: 12 }}>{running.id}</Link> : <span className="text-muted" style={{ fontSize: 12 }}>{running.id}</span>}</div>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 14 }}>{t.requested_by} {running.requester} · {t.due} {running.dueF}</div>
                    <VStepper items={running.steps.map((st) => ({ key: st.idx, state: st.state, title: st.nameL, lines: [`${st.assignee} · ${st.stateLabel}${st.dateF ? ` ${st.dateF}` : ''}`] }))} />
                    {running.visible && <Link href={running.href} className="btn btn-primary" style={{ marginTop: 6 }}>{t.open}</Link>}
                  </>
                ) : (
                  <>
                    <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{t.no_workflow}</p>
                    {validateBtn('btn btn-primary')}
                  </>
                )}
                {finished.length > 0 && (
                  <section style={{ marginTop: 22 }}>
                    <h6 className="sec-title" style={{ marginBottom: 6 }}>{t.wf_done}</h6>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {finished.map((w) => (
                        <div key={w.id} className={`hairline ${styles.pieceRow}`}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5 }}>{t.revision} {w.letter} <span className="text-muted">· {w.id}</span></div>
                            <div className="text-muted ellipsis" style={{ fontSize: 11 }}>{w.requester} · {fmtDate(w.createdAt, lang)}</div>
                          </div>
                          <span className={w.outcome === 'approved' ? 'tag tag-accent' : 'tag tag-outline'} style={{ fontSize: 10.5, padding: '2px 8px' }}>{w.outcome === 'approved' ? t.wf_approved : t.wf_rejected}</span>
                          {w.visible && <Link href={w.href} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}>{t.open}</Link>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === 'requests' && (
              <>
                {shownRequests.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {shownRequests.map((r) => (
                      <div key={r.id} className={`hairline ${styles.requestRow}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="tabnum" style={{ fontSize: 13 }}>{r.id}</span>
                          <span className={ECR_TAG[r.status] ?? 'tag tag-neutral'} style={{ fontSize: 10.5, padding: '2px 8px' }}>{r.statusL}</span>
                          <span className="tag tag-neutral" style={{ fontSize: 10.5, padding: '2px 8px' }}>{r.kindL}</span>
                        </div>
                        <div style={{ fontSize: 12.5, marginTop: 6 }}>{r.reason}</div>
                        {r.description && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.description}</div>}
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {t.requested_by} {r.requester} · {r.when}
                          {r.ecoRef && ` · ${t.eco_ref} : ${r.ecoRef}`}
                          {r.modifier && ` · ${t.modifier} : ${r.modifier}`}
                        </div>
                        {r.decisionNote && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.decisionNote}</div>}
                        {r.status === 'accepted' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 4 }}>
                            <Icon name="lock" size={12} style={{ flex: 'none' }} />{t.ecr_pending_apply} : {waitL}.
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <a href={vigieUrl(r.id)} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}><Icon name="openExternal" size={12} />{t.open_vigie}</a>
                          {simulateVigie && r.status === 'submitted' && vigieSpecs.has(r.id) && (
                            <DialogButton spec={{ kind: 'vigie', requestId: r.id, docTitle: doc.title, change: r.kind, ...vigieSpecs.get(r.id)! }} style={{ fontSize: 11, padding: '2px 8px' }}>{t.vigie_sim}</DialogButton>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{t.no_requests}</p>
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
                {(history.length ? history : [{ id: 0, when: doc.createdF, user: doc.owner, actionLabel: t.act_upload, detail: 'A.1' }]).map((h) => (
                  <div key={h.id} className="feed">
                    <span className="text-muted feed-when">{h.when}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 13 }}>{h.actionLabel}{h.detail && <span className="text-muted"> · {h.detail}</span>}</div><div className="text-muted" style={{ fontSize: 11 }}>{h.user}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
