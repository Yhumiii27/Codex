import type { Localized } from '@/db/schema';
import { fmtDate, fmtDateTime, loc } from './format';
import type { Lang, T } from './i18n';
import type { PdfLine } from './pdf';

// Approval record of a revision (« fiche de visa », point 21 of docs/reste-a-faire.md): what Codex recorded about its
// approval — circuits, steps, holders, decisions, delegations, comments, dates, change orders — laid out for the PDF
// writer (lib/pdf.ts). It bears no electronic signature (an open audit question): it says it is an extract of the
// journal of Codex. Rows are loaded by lib/queries.ts approvalRecord, which checks who may have it. A reader who does
// not follow a circuit (access.ts followsCircuit) gets what the application already shows them: its outcome and
// reason (Validation tab), its decisions and delegations (journal), not the text of its comments nor who held the
// steps never decided.

/** What a step of a circuit came to. */
export type StepOutcome = 'submitted' | 'approved' | 'rejected' | 'recalled' | 'closed' | 'pending' | 'not_reached';

type WorkflowRow = {
  id: string; step: number; outcome: 'approved' | 'rejected' | 'recalled' | null; requesterId: string;
  closedBy: string | null; closedAt: string | null; reason: string | null; createdAt: string;
};
type StepRow = { idx: number; name: Localized; assigneeId: string; date: string | null };
type CommentRow = { authorId: string; at: string; text: Localized };
/** A journal entry of the revision, `at` in Paris time ("YYYY-MM-DD HH:mm:ss", lib/format.ts parisStamp). */
export type JournalRow = { at: string; userId: string; action: string; detail: string };

/**
 * Outcome of step `idx` (held by `assigneeId`) of a circuit: the drafting step (0) sent the revision for approval;
 * the steps before the current one were approved; the current one is pending while the circuit runs, rejected when its
 * holder rejected it, undecided when the circuit was recalled or closed by someone else (a withdrawal of the document);
 * the later ones were never reached.
 */
export function stepOutcome(w: Pick<WorkflowRow, 'step' | 'outcome' | 'closedBy'>, idx: number, assigneeId: string): StepOutcome {
  if (idx === 0) return 'submitted';
  if (idx < w.step) return 'approved';
  if (idx > w.step) return 'not_reached';
  if (w.outcome === 'rejected') return !w.closedBy || w.closedBy === assigneeId ? 'rejected' : 'closed';
  if (w.outcome === 'recalled') return 'recalled';
  return w.outcome ? 'not_reached' : 'pending';
}

/**
 * A delegation as lib/actions.ts delegateStep journals it: « W-12 · Responsable qualité → Jean Martin », the step
 * under its French name and the person it went to, by name. Null for another circuit or another form.
 */
export function parseDelegation(detail: string, workflowId: string): { step: string; to: string } | null {
  const prefix = `${workflowId} · `;
  if (!detail.startsWith(prefix)) return null;
  const rest = detail.slice(prefix.length);
  const cut = rest.lastIndexOf(' → ');
  return cut > 0 ? { step: rest.slice(0, cut), to: rest.slice(cut + 3) } : null;
}

/** Steps decided by their holder, or sent for approval: the journal names who did it to every reader of the revision. */
const DECIDED: ReadonlySet<StepOutcome> = new Set(['submitted', 'approved', 'rejected']);

/** Is a journal entry about this circuit? Its detail is the circuit's ID, or starts with it (« W-12 · B »). */
const aboutCircuit = (e: JournalRow, workflowId: string) => e.detail === workflowId || e.detail.startsWith(`${workflowId} · `);

type Delegation = { from: string; to: string; at: string };

export type VisaCircuit = {
  id: string;
  requester: string;
  /** Instant of the request (journal), else its day. */
  requestedAt: string;
  outcome: WorkflowRow['outcome'];
  closer: string | null;
  /** Instant it ended (journal), else its day; null while it runs. */
  closedAt: string | null;
  reason: string | null;
  /** `holder`: null for a step never decided, to a reader who does not follow the circuit. */
  steps: { name: string; holder: string | null; outcome: StepOutcome; at: string | null; delegations: Delegation[] }[];
  /** Delegations whose step could not be told apart (named differently since): listed under the circuit. */
  delegations: (Delegation & { step: string })[];
  /** Its comments, to whoever follows the circuit; empty otherwise. */
  comments: { who: string; at: string; text: string }[];
  /** How many comments the reader does not get, not following the circuit. */
  withheld: number;
};

/**
 * One circuit of the revision as the record tells it: its steps with their holder (after any delegation), outcome and
 * moment — taken from the journal entry of the decision when there is one (approval, signature, rejection, request),
 * else the day kept on the step — the delegations of each step, its comments, how and when it ended. `follows`: the
 * reader follows the circuit (access.ts followsCircuit); otherwise the text of its comments and the holders of the
 * steps never decided stay out, as in the rest of the application, and only the number of comments is told.
 */
export function visaCircuit(w: WorkflowRow, steps: StepRow[], comments: CommentRow[], journal: JournalRow[], lang: Lang, name: (id: string | null | undefined) => string, follows: boolean): VisaCircuit {
  const entries = journal.filter((e) => aboutCircuit(e, w.id));
  const used = new Set<JournalRow>();
  const take = (pick: (e: JournalRow) => boolean) => {
    const e = entries.find((x) => !used.has(x) && pick(x));
    if (e) used.add(e);
    return e;
  };
  const request = take((e) => e.action === 'request');
  const end = w.outcome === 'rejected' || w.outcome === 'recalled' ? take((e) => e.action === (w.outcome === 'rejected' ? 'reject' : 'recall')) : undefined;
  const ordered = [...steps].sort((a, b) => a.idx - b.idx);
  const shaped = ordered.map((st) => {
    const outcome = stepOutcome(w, st.idx, st.assigneeId);
    const decided = outcome === 'approved' ? take((e) => (e.action === 'approve' || e.action === 'sign') && e.userId === st.assigneeId) : undefined;
    const at = outcome === 'submitted' ? request?.at ?? st.date
      : outcome === 'approved' ? decided?.at ?? st.date
      : outcome === 'rejected' ? end?.at ?? w.closedAt
      : null;
    return { name: loc(st.name, lang), holder: follows || DECIDED.has(outcome) ? name(st.assigneeId) : null, outcome, at, delegations: [] as Delegation[] };
  });
  // Delegations name the step in French, as it was when they were journaled (step names never change afterwards).
  const frNames = ordered.map((st) => loc(st.name, 'fr'));
  const loose: VisaCircuit['delegations'] = [];
  for (const e of entries.filter((x) => x.action === 'delegate')) {
    const d = parseDelegation(e.detail, w.id);
    if (!d) continue;
    const delegation = { from: name(e.userId), to: d.to, at: e.at };
    const step = shaped[frNames.indexOf(d.step)];
    if (step) step.delegations.push(delegation);
    else loose.push({ ...delegation, step: d.step });
  }
  return {
    id: w.id,
    requester: name(w.requesterId),
    requestedAt: request?.at ?? w.createdAt,
    outcome: w.outcome,
    closer: w.closedBy ? name(w.closedBy) : null,
    closedAt: w.outcome ? end?.at ?? (w.outcome === 'approved' ? shaped.findLast((st) => st.at)?.at : null) ?? w.closedAt : null,
    reason: w.reason,
    steps: shaped,
    delegations: loose,
    comments: follows ? comments.map((c) => ({ who: name(c.authorId), at: c.at, text: loc(c.text, lang) })) : [],
    withheld: follows ? 0 : comments.length,
  };
}

/** Everything the record shows, names and labels already in the reader's language, dates as ISO days or Paris instants. */
export type VisaRecord = {
  doc: { id: string; title: string; type: string; context: string; owner: string; conf: string; state: string | null };
  rev: {
    letter: string; status: string; createdAt: string; approvedAt: string | null; effectiveAt: string | null; inForceAt: string | null;
    supersededAt: string | null; modifier: string | null; changeRefs: string[];
    /**
     * The file approved: the last working version of the revision, its name and size (formatted), and the SHA-256
     * recorded when it entered Codex (null when it was stored before fingerprints were computed); null without file.
     */
    file: { name: string; size: string; sha256: string | null } | null;
  };
  /**
   * The revision was migrated from the legacy system (/api/import): when, under which reference, and whether it was
   * approved there (`approved`) or came as a draft that a circuit of Codex approved afterwards.
   */
  imported: { at: string; legacyRef: string; approved: boolean } | null;
  circuits: VisaCircuit[];
  issued: { at: string; by: string };
};

/** Name of the PDF: {ID}_{letter}_VISA.pdf. */
export function visaFileName(id: string, letter: string): string {
  return `${id}_${letter}_VISA.pdf`;
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

const STEP_OUTCOME: Record<StepOutcome, 'visa_step_submitted' | 'visa_step_approved' | 'visa_step_rejected' | 'visa_step_recalled' | 'visa_step_closed' | 'visa_step_pending' | 'visa_step_not_reached'> = {
  submitted: 'visa_step_submitted', approved: 'visa_step_approved', rejected: 'visa_step_rejected', recalled: 'visa_step_recalled',
  closed: 'visa_step_closed', pending: 'visa_step_pending', not_reached: 'visa_step_not_reached',
};

/** The record laid out for lib/pdf.ts simplePdf: identification, dates, how it was approved, then where it comes from. */
export function visaLines(t: T, lang: Lang, x: VisaRecord): PdfLine[] {
  const day = (iso: string | null) => fmtDate(iso, lang);
  const when = (stamp: string | null) => (stamp ? fmtDateTime(stamp, lang) : '—');
  const heading = (text: string): PdfLine => ({ text, size: 11.5, bold: true, gap: 28, keep: 2 });
  const field = (label: string, text: string): PdfLine => ({ label, text, size: 10, gap: 15 });
  const { doc, rev } = x;

  const lines: PdfLine[] = [
    { text: t.visa_extract, size: 9, grey: true, gap: 0 },
    { text: t.visa, size: 20, bold: true, gap: 30 },
    { text: `${doc.id} · ${t.rev_short} ${rev.letter}`, size: 12, bold: true, gap: 24 },
    { text: doc.title, size: 12, gap: 17 },

    heading(t.visa_identification),
    field(t.visa_id, doc.id),
    field(t.revision, `${rev.letter} · ${rev.status}`),
    field(t.type, doc.type),
    field(t.attachment, doc.context),
    field(t.owner, doc.owner),
    field(t.conf, doc.conf),
    ...(doc.state ? [field(t.visa_state, doc.state)] : []),
    ...(rev.modifier ? [field(t.modifier, rev.modifier)] : []),
    field(t.visa_eco, rev.changeRefs.length ? rev.changeRefs.join(', ') : '—'),
    ...(rev.file ? [field(t.visa_file, `${rev.file.name} · ${rev.file.size}`), field('SHA-256', rev.file.sha256 ?? t.visa_no_sha)] : []),

    heading(t.visa_dates),
    field(t.visa_created, day(rev.createdAt)),
    // A draft migrated from the legacy system, then approved in Codex: when it came, its approval date is Codex's.
    ...(x.imported && !x.imported.approved ? [field(t.visa_migrated, fill(t.visa_migrated_draft, { ref: x.imported.legacyRef, date: day(x.imported.at) }))] : []),
    field(t.visa_approved, x.imported?.approved ? t.visa_legacy : day(rev.approvedAt)),
    field(t.effective_at, rev.effectiveAt ? day(rev.effectiveAt) : rev.inForceAt ? day(rev.inForceAt) : t.visa_effect_on_entry),
    field(t.visa_in_force, rev.inForceAt ? day(rev.inForceAt) : '—'),
    ...(rev.supersededAt ? [field(t.visa_superseded, day(rev.supersededAt))] : []),
  ];

  if (x.imported?.approved) {
    lines.push(heading(t.visa_approved), { text: fill(t.visa_imported, { ref: x.imported.legacyRef, date: day(x.imported.at) }), size: 10, gap: 15 });
  } else if (!x.circuits.length) {
    lines.push(heading(t.visa_circuit), { text: t.visa_no_circuit, size: 10, gap: 15 });
  }

  for (const c of x.circuits) {
    const outcome = c.outcome === 'approved' ? fill(t.visa_outcome_approved, { when: when(c.closedAt) })
      : c.outcome === 'rejected' ? fill(t.visa_outcome_rejected, { who: c.closer ?? '—', when: when(c.closedAt) })
      : c.outcome === 'recalled' ? fill(t.visa_outcome_recalled, { who: c.closer ?? '—', when: when(c.closedAt) })
      : t.visa_outcome_running;
    lines.push(
      heading(`${t.visa_circuit} ${c.id}`),
      { text: fill(t.visa_requested, { who: c.requester, when: when(c.requestedAt) }), size: 10, gap: 15 },
      { text: outcome, size: 10, bold: true, gap: 14 },
    );
    if (c.outcome === 'approved' && c.steps.length === 1) lines.push({ text: t.visa_no_step, size: 10, gap: 14 });
    if (c.reason) lines.push({ label: c.outcome === 'rejected' ? t.visa_reject_reason : t.visa_recall_reason, text: c.reason, size: 10, gap: 15 });
    c.steps.forEach((st, i) => {
      lines.push(
        { text: `${i + 1}. ${st.name}`, size: 10, bold: true, gap: 19, keep: 1 },
        { text: [st.holder, t[STEP_OUTCOME[st.outcome]], st.at ? when(st.at) : ''].filter(Boolean).join(' · '), size: 10, indent: 14, gap: 14 },
        ...st.delegations.map((d): PdfLine => ({ text: fill(t.visa_delegated, { from: d.from, to: d.to, when: when(d.at) }), size: 9, grey: true, indent: 14, gap: 13 })),
      );
    });
    for (const d of c.delegations) {
      lines.push({ text: `${d.step} · ${fill(t.visa_delegated, { from: d.from, to: d.to, when: when(d.at) })}`, size: 9, grey: true, gap: 15 });
    }
    if (c.comments.length) {
      lines.push({ text: t.comments, size: 10, bold: true, gap: 21, keep: 2 });
      for (const m of c.comments) {
        lines.push({ text: `${day(m.at)} · ${m.who}`, size: 9, grey: true, indent: 14, gap: 15 }, { text: m.text, size: 10, indent: 14, gap: 13 });
      }
    }
    if (c.withheld) {
      lines.push(
        { text: t.comments, size: 10, bold: true, gap: 21, keep: 1 },
        { text: fill(c.withheld === 1 ? t.visa_comments_withheld_one : t.visa_comments_withheld, { n: String(c.withheld) }), size: 9, grey: true, indent: 14, gap: 15 },
      );
    }
  }

  lines.push(
    { text: fill(t.visa_issued, { when: when(x.issued.at), who: x.issued.by }), size: 9, grey: true, gap: 34 },
    { text: t.visa_no_signature, size: 9, grey: true, gap: 13 },
  );
  return lines;
}

/** Footer of every page of the record. */
export function visaFooter(t: T, id: string, letter: string): (page: number, pages: number) => string {
  return (page, pages) => `${id} · ${t.rev_short} ${letter} · ${t.visa} · ${t.page} ${page}/${pages}`;
}
