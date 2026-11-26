// Help page (/aide): the common tasks, step by step, drawn from docs/modele-cible.md and docs/decisions.md, as English
// source strings translated by src/i18n (French in src/i18n/fr-help.ts; Norma § 2, CX-N01). `href` leads to the screen
// where a task starts (shown only when the user has that screen), `simulated` says what stands in for another system or
// for the sign-in. The ids are the anchors of the page.

import { msg } from '@/i18n';

export type HelpTopic = {
  id: string; title: string; intro: string; steps: string[]; notes?: string[]; simulated?: string;
  href?: { url: string; screen: 'home' | 'explorer' | 'search' | 'workflow' | 'admin' };
};
export type Help = { lead: string; contents: string; simulatedLabel: string; open: string; notesHint: string; topics: HelpTopic[] };

export const HELP: Help = {
  lead: msg('The guides below describe what Codex does today. A greyed-out button tells, on hover, what is missing: a permission of the role, a lock, a step of the lifecycle.'),
  contents: msg('Contents'),
  simulatedLabel: msg('Simulated'),
  open: msg('Open'),
  notesHint: msg('The document model (classification, identifier, revisions, confidentiality) is summed up in “Design notes”, at the bottom of the sidebar.'),
  topics: [
    {
      id: 'simulation',
      title: msg('Before you start: what is simulated'),
      intro: msg('Codex works on its own, but three things are not real yet.'),
      steps: [
        msg('User and role: there is no sign-in yet. Click the profile at the bottom of the sidebar to pick the simulated person and role; screens, permissions and what you see follow.'),
        msg('Vigie: change and withdrawal requests are sent to it, but until Vigie is connected a records manager simulates its decision (“Vigie simulation” button in the record’s Requests tab).'),
        msg('Keystone: projects, their phases, expected documents and events are demonstration data kept in Codex; “Open in Keystone” leads to the configured address.'),
      ],
      notes: [
        msg('The interface language (FR / EN) is chosen at the top right; a document’s title stays in its own language.'),
        msg('Codex only notifies inside the app: the bell and “To do” on Home. No e-mail is sent.'),
      ],
    },
    {
      id: 'create',
      title: msg('Create a document'),
      intro: msg('You need the “Upload” permission. The document gets its identifier on creation and starts as revision A, draft.'),
      steps: [
        msg('From Home (“New from template”, “Upload a file”) or Browse (“New”, “Upload a file”, prefilled from the classification plan selection).'),
        msg('Initial content: from a template (its file becomes working version A.1), from a file, or no file yet.'),
        msg('Origin (internal or external), then attachment (none, project or research programme): they decide which types are offered and which fields to fill (source organisation for an external document, project and phase for a project…).'),
        msg('Family, type and sub-type; department; confidentiality, which the type limits and proposes by default.'),
        msg('The dialog shows the assigned ID, TYPE-CONTEXT-SEQ: PID-HLT-026-001 for a project, PRT-R2601-004 for a programme, FRM-QMS-012 for a template, PRO-QUA-0012 otherwise (owning department). “Create document” opens its record.'),
      ],
      notes: [
        msg('A template is a document of type FRM (context QMS): create one from Administration › Templates (QMS), “New template”. “New from template” first offers the templates meant for the chosen type.'),
        msg('Before the first approval, a reclassification (“Edit metadata”) may change the ID, the old one still being recognised; afterwards it never changes.'),
      ],
      href: { url: '/', screen: 'home' },
    },
    {
      id: 'working',
      title: msg('Upload a working version'),
      intro: msg('While drafting, each uploaded file is a working version: A.1, A.2… All of them are kept.'),
      steps: [
        msg('On the document’s record, “New working version”: choose the file and, if useful, a comment.'),
        msg('The file is checked (admitted format, size, virus scan when configured); it downloads as {ID}_{letter}.{n}, for instance PRO-QUA-0012_A.2.pdf.'),
        msg('The Revisions tab lists the versions, their author, date and SHA-256 fingerprint.'),
      ],
      notes: [
        msg('You need the “Upload” permission and a place in the drafting circle: owner, designated author, records managers. If someone uploaded in the meantime, the upload is refused: reload the record.'),
      ],
    },
    {
      id: 'restore',
      title: msg('Restore a working version'),
      intro: msg('Go back to the content of an earlier version of the draft, without deleting anything.'),
      steps: [
        msg('Revisions tab: click an earlier version of the draft revision.'),
        msg('“Restore”, then confirm: its file becomes the next version (for instance A.3, “Restored from A.1”).'),
      ],
      notes: [
        msg('A revision in force is not restored: going back is a change request in Vigie.'),
      ],
    },
    {
      id: 'approval',
      title: msg('Request approval'),
      intro: msg('Every revision goes through its type’s workflow, made of functions (quality manager, project manager…) resolved at launch.'),
      steps: [
        msg('At least one working version is needed. On the record, “Request approval” shows the workflow.'),
        msg('Effective date optional: empty, the revision comes into force on approval; otherwise on that date.'),
        msg('The revision becomes “In review”; approvers find it in Approvals › For me.'),
        msg('To stop the workflow before the last approval: “Recall the request” (the requester or a records manager); the revision goes back to drafting.'),
      ],
      notes: [
        msg('Neither the revision’s author nor the requester approves it. A type without an approval step is approved at once, with the “Publish” permission.'),
      ],
    },
    {
      id: 'decide',
      title: msg('Approve, reject or delegate'),
      intro: msg('The Approvals screen lists the workflows; “For me” those waiting for your decision.'),
      steps: [
        msg('“Approve”: the next step starts; the last approval also needs the “Publish” permission. The revision becomes Approved, then In force on its effective date (at once without one), and the previous one is Superseded.'),
        msg('“Reject”: a reason is required; the revision goes back to drafting and its author finds the reason on the record and in “To do”.'),
        msg('“Delegate”: the step goes to another person whose role may approve, never the author or the requester. A records manager may also “Reassign” someone else’s step.'),
        msg('The workflow’s comments are read and added under its steps.'),
      ],
      notes: [
        msg('An approved revision has an approval sheet (PDF) in the Revisions tab: an extract of the audit trail, without electronic signature.'),
      ],
      href: { url: '/validations', screen: 'workflow' },
    },
    {
      id: 'vigie',
      title: msg('Request a change or a withdrawal'),
      intro: msg('A document in force is not edited directly: the request goes to Vigie, which decides.'),
      steps: [
        msg('On the record, “Request a change” (reason, description): the request (ECR) is sent to Vigie. If the ECO is accepted, Codex opens the next revision as a draft for the designated author.'),
        msg('If a revision is already open, the request is still possible: once accepted, it waits for that revision to come into force before opening the next one; while the open revision is being drafted, it may also be grafted onto it (“Graft onto revision”, by that revision’s author, failing that its owner, or a records manager).'),
        msg('“Request withdrawal”: you may propose a replacement document. Once accepted, the withdrawal makes the document obsolete, flagged by a banner, and links it to the proposed replacement.'),
        msg('Follow-up: Approvals › “My Vigie requests”.'),
      ],
      notes: [
        msg('A document under legal hold, archived or obsolete no longer changes: an acceptance received meanwhile waits for the lock to be lifted.'),
      ],
      simulated: msg('Vigie’s decision is simulated by a records manager (“Vigie simulation”, in the record’s Requests tab).'),
      href: { url: '/validations?f=vigie', screen: 'workflow' },
    },
    {
      id: 'compare',
      title: msg('Compare two versions'),
      intro: msg('See what changed between a version and the current one.'),
      steps: [
        msg('Revisions tab: click the version to compare, then “Compare”.'),
        msg('The dialog shows their attributes side by side, then their text compared line by line: removed (−) and added (+) lines.'),
      ],
      notes: [
        msg('Text is read from PDF, Word, Excel, PowerPoint, OpenDocument and plain text files; layout and pictures are not compared, and Office 97-2003 formats (.doc, .xls, .ppt) are not read.'),
      ],
    },
    {
      id: 'confidentiality',
      title: msg('Confidentiality: who sees what'),
      intro: msg('Five levels, from least to most protected: Public < Restricted < Internal < Confidential < Highly confidential.'),
      steps: [
        msg('Public is admitted by some types only; elsewhere the minimum is Restricted (may go to the designated client or partner).'),
        msg('Confidential: the document’s department or project team. Highly confidential: the named readers only.'),
        msg('Named readers are set on the record (“Named readers”, owner or records manager).'),
        msg('A draft and its working versions are visible to the drafting circle only: owner, designated author, approvers of the running workflow, records managers. Other readers see only the revision in force and those it superseded.'),
      ],
    },
    {
      id: 'search',
      title: msg('Search#help'),
      intro: msg('The field at the top of every screen opens Search; it only covers the documents you may read.'),
      steps: [
        msg('Text is searched in the metadata: identifier and former identifiers, title, keywords, external reference, study ID, type, sub-type, source organisation, owner and author. The files’ content is not searched.'),
        msg('Filters (project, type, department, status, confidentiality, keywords…) combine; a period applies to a date of your choice; the order is chosen above the results.'),
        msg('“Save search” keeps its criteria (never the documents); sharing a search with a department or the whole group is for records managers and administrators.'),
        msg('“Export list” gives the results as CSV, in the same order.'),
      ],
      href: { url: '/recherche', screen: 'search' },
    },
  ],
};
