import { describe, expect, it } from 'vitest';
import { canRead, changeAsSeen, deadlineActor, draftTodo, inDraftingCircle, isUsableTemplate, mayDeleteSearch, mayRecall, mayRecordReview, maySaveSearch, mayShareSearches, mayWorkOnDraft, openRevisionView, readerMaySeeChange, readerMaySeeEntry, readerMaySeeRevision, readerMaySeeVersion, readersApply, seesSavedSearch, type AccessIndex, type Viewer } from '@/lib/access';
import { CONF_LEVELS, PERMS, type Perm } from '@/lib/i18n';

// Who sees what: confidentiality levels (D-13), drafting circle (D-14), docs/modele-cible.md §5.

type Doc = Parameters<typeof canRead>[1];
type People = Partial<Record<'readers' | 'modifiers' | 'designated' | 'approvers' | 'team', Record<string, string[]>>>;

const REV_STATUSES = ['draft', 'in_review', 'approved', 'in_force', 'superseded', 'cancelled'] as const;

/** A person of department `department` holding the matrix permissions `perms` (read only by default). */
function viewer(id: string, { department = 'COM', perms = ['read'], seesAll = false }: { department?: string; perms?: Perm[]; seesAll?: boolean } = {}): Viewer {
  const granted = new Set<Perm>(perms);
  return {
    user: { id, name: id, initials: id.slice(0, 2).toUpperCase(), role: 'collaborateur', title: null, department, site: null, isSystem: false },
    seesAll,
    can: (p) => granted.has(p),
  };
}

/** People around documents (keyed by document ID) and project teams (keyed by project code). */
function index({ readers = {}, modifiers = {}, designated = {}, approvers = {}, team = {} }: People = {}): AccessIndex {
  const lookup = (m: Record<string, string[]>) => (key: string) => new Set(m[key] ?? []);
  return { readers: lookup(readers), modifiers: lookup(modifiers), designated: lookup(designated), approvers: lookup(approvers), team: (code) => (code ? lookup(team)(code) : new Set()) };
}

/** A QUA document owned by `owner`, revision A in force. */
const doc = (over: Partial<Doc> = {}): Doc => ({ id: 'PRO-QUA-0003', ownerId: 'owner', department: 'QUA', projectCode: null, conf: 'interne', state: 'active', revInForce: 'A', ...over });

const D = 'PRO-QUA-0003';
const people = index({
  readers: { [D]: ['reader'] },
  modifiers: { [D]: ['modifier'] },
  designated: { [D]: ['next_modifier'] },
  approvers: { [D]: ['approver'], 'PRO-QUA-0004': ['other_approver'] },
  team: { 'HLT-026': ['pm'], 'NDC-031': ['other_pm'] },
});
const owner = viewer('owner', { department: 'QUA' });
const modifier = viewer('modifier', { department: 'ING' });
const approver = viewer('approver', { department: 'DIR' });
const recordsManager = viewer('manager', { department: 'HSE', perms: ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'admin'], seesAll: true });
const colleague = viewer('colleague', { department: 'QUA' });
const reader = viewer('reader', { department: 'COM' });
const pm = viewer('pm', { department: 'PRJ' });
const otherPm = viewer('other_pm', { department: 'PRJ' });
const stranger = viewer('stranger', { department: 'COM' });
// Designated by Vigie for an accepted change that waits for the open revision (D-26).
const nextModifier = viewer('next_modifier', { department: 'ING', perms: ['read', 'upload', 'edit'] });
const circle = { owner, modifier, approver, recordsManager, nextModifier };
// Matrix permissions do not make a drafting circle (§5): only records managers see everything. Roles of src/db/seed-org.ts.
const validator = viewer('validator', { department: 'DIR', perms: ['read', 'upload', 'edit', 'approve', 'publish'] });
const administrator = viewer('administrator', { department: 'DSI', perms: [...PERMS] });
const otherApprover = viewer('other_approver', { department: 'ING', perms: ['read', 'upload', 'edit', 'approve', 'publish'] });
const elevated = { validator, administrator, otherApprover };

describe('confidentiality scale (D-13)', () => {
  it('ranks the five levels from the least to the most protected, Restreint right above Public', () => {
    expect(CONF_LEVELS).toEqual(['public', 'restreint', 'interne', 'confidentiel', 'tres_confidentiel']);
  });
});

describe('inDraftingCircle (D-14)', () => {
  it('holds the owner, the designated modifier, the approvers of the running circuit and the records managers', () => {
    for (const [who, v] of Object.entries(circle)) expect(inDraftingCircle(v, doc(), people), who).toBe(true);
  });

  it('lets them all work on the draft but the author designated for a change waiting for it, who writes the next revision', () => {
    for (const [who, v] of Object.entries(circle)) expect(mayWorkOnDraft(v, doc(), people), who).toBe(who !== 'nextModifier');
    for (const [who, v] of Object.entries({ colleague, reader, pm, stranger, ...elevated })) expect(mayWorkOnDraft(v, doc(), people), who).toBe(false);
  });

  it('leaves out named readers, the department, the project team and anyone else', () => {
    const d = doc({ conf: 'confidentiel', projectCode: 'HLT-026' });
    for (const [who, v] of Object.entries({ colleague, reader, pm, stranger })) expect(inDraftingCircle(v, d, people), who).toBe(false);
  });

  it('leaves out a validator, an administrator and the approver of another document, whatever their permissions', () => {
    for (const [who, v] of Object.entries(elevated)) expect(inDraftingCircle(v, doc(), people), who).toBe(false);
  });

  it('is per document: the modifier of one document is outside the circle of another', () => {
    expect(inDraftingCircle(modifier, doc({ id: 'PRO-QUA-0004' }), people)).toBe(false);
    expect(inDraftingCircle(approver, doc({ id: 'PRO-QUA-0004' }), people)).toBe(false);
    expect(inDraftingCircle(otherApprover, doc({ id: 'PRO-QUA-0004' }), people)).toBe(true);
  });
});

describe('canRead, drafting circle', () => {
  it('lets the circle read every level, drafts included', () => {
    for (const conf of CONF_LEVELS) {
      for (const revInForce of ['A', null]) {
        for (const [who, v] of Object.entries(circle)) expect(canRead(v, doc({ conf, revInForce }), people), `${who} ${conf} ${revInForce}`).toBe(true);
      }
    }
  });

  it('does not require the read permission inside the circle', () => {
    expect(canRead(viewer('owner', { perms: [] }), doc({ revInForce: null }), people)).toBe(true);
  });
});

describe('canRead outside the circle, document in force (D-13)', () => {
  it('opens public, restricted and internal documents to anyone with the read permission', () => {
    for (const conf of ['public', 'restreint', 'interne'] as const) {
      expect(canRead(stranger, doc({ conf }), people), conf).toBe(true);
      expect(canRead(pm, doc({ conf }), people), conf).toBe(true);
    }
  });

  it('opens a confidential document to its department, its project team and its named readers only', () => {
    const d = doc({ conf: 'confidentiel', projectCode: 'HLT-026' });
    expect(canRead(colleague, d, people)).toBe(true);
    expect(canRead(pm, d, people)).toBe(true);
    expect(canRead(reader, d, people)).toBe(true);
    expect(canRead(otherPm, d, people)).toBe(false);
    expect(canRead(stranger, d, people)).toBe(false);
  });

  it('gives no project team to a confidential document without project', () => {
    expect(canRead(pm, doc({ conf: 'confidentiel', projectCode: null }), people)).toBe(false);
  });

  it('opens a highly confidential document to its named readers only', () => {
    const d = doc({ conf: 'tres_confidentiel', projectCode: 'HLT-026' });
    expect(canRead(reader, d, people)).toBe(true);
    expect(canRead(colleague, d, people)).toBe(false);
    expect(canRead(pm, d, people)).toBe(false);
    expect(canRead(stranger, d, people)).toBe(false);
  });

  it('gives no more to a validator, an administrator or the approver of another document', () => {
    for (const [who, v] of Object.entries(elevated)) {
      expect(canRead(v, doc({ conf: 'interne' }), people), `${who} interne`).toBe(true);
      expect(canRead(v, doc({ conf: 'confidentiel' }), people), `${who} confidentiel`).toBe(false);
      expect(canRead(v, doc({ conf: 'tres_confidentiel' }), people), `${who} tres_confidentiel`).toBe(false);
    }
  });

  it('requires the read permission for every level, named readers included', () => {
    for (const conf of CONF_LEVELS) {
      const d = doc({ conf, projectCode: 'HLT-026' });
      for (const [who, base] of Object.entries({ colleague, reader, pm, stranger })) {
        const noRead = viewer(base.user.id, { department: base.user.department ?? undefined, perms: ['upload', 'edit'] });
        expect(canRead(noRead, d, people), `${who} ${conf}`).toBe(false);
      }
    }
  });

  it('refuses a level it does not know', () => {
    expect(canRead(colleague, doc({ conf: 'secret' }), people)).toBe(false);
  });

  it('keeps the same readers once the document is obsolete or archived (§4, A13 and P07 open)', () => {
    for (const conf of CONF_LEVELS) {
      for (const state of ['obsolete', 'archived']) {
        for (const v of [colleague, reader, pm, stranger]) {
          const d = doc({ conf, projectCode: 'HLT-026' });
          expect(canRead(v, { ...d, state }, people), `${v.user.id} ${conf} ${state}`).toBe(canRead(v, d, people));
        }
      }
    }
  });
});

describe('canRead outside the circle, document never in force (D-14)', () => {
  it('hides a draft from everyone outside the circle, whatever the level and the permissions', () => {
    for (const conf of CONF_LEVELS) {
      const d = doc({ conf, projectCode: 'HLT-026', revInForce: null });
      for (const v of [colleague, reader, pm, stranger, validator, administrator, otherApprover]) expect(canRead(v, d, people), `${v.user.id} ${conf}`).toBe(false);
    }
  });

  it('still hides it once withdrawn or archived without ever entering into force', () => {
    for (const state of ['obsolete', 'archived']) {
      for (const conf of CONF_LEVELS) {
        const d = doc({ conf, projectCode: 'HLT-026', revInForce: null, state });
        for (const v of [colleague, reader, pm, stranger, validator, administrator, otherApprover]) expect(canRead(v, d, people), `${v.user.id} ${conf} ${state}`).toBe(false);
      }
    }
  });
});

describe('readersApply', () => {
  it('counts named readers for the confidential levels only', () => {
    expect(readersApply('confidentiel')).toBe(true);
    expect(readersApply('tres_confidentiel')).toBe(true);
    for (const conf of ['public', 'restreint', 'interne']) expect(readersApply(conf), conf).toBe(false);
  });
});

describe('isUsableTemplate', () => {
  const template = (over: Partial<Doc> = {}) => ({ ...doc({ id: 'FRM-QMS-001', ...over }), typeCode: 'FRM' });
  const tIndex = index({ readers: { 'FRM-QMS-001': ['reader'] } });

  it('offers a template in force, active and readable', () => {
    expect(isUsableTemplate(stranger, template(), tIndex)).toBe(true);
    expect(isUsableTemplate(colleague, template({ conf: 'confidentiel' }), tIndex)).toBe(true);
  });

  it('refuses a document of another type', () => {
    expect(isUsableTemplate(stranger, { ...template(), typeCode: 'PRO' }, tIndex)).toBe(false);
  });

  it('refuses a template that never entered into force, even to its drafting circle', () => {
    expect(isUsableTemplate(owner, template({ revInForce: null }), tIndex)).toBe(false);
    expect(isUsableTemplate(recordsManager, template({ revInForce: null }), tIndex)).toBe(false);
  });

  it('refuses an obsolete or archived template', () => {
    expect(isUsableTemplate(stranger, template({ state: 'obsolete' }), tIndex)).toBe(false);
    expect(isUsableTemplate(stranger, template({ state: 'archived' }), tIndex)).toBe(false);
  });

  it('refuses a template the user cannot read', () => {
    expect(isUsableTemplate(stranger, template({ conf: 'confidentiel' }), tIndex)).toBe(false);
    expect(isUsableTemplate(viewer('stranger', { perms: [] }), template(), tIndex)).toBe(false);
  });
});

describe('readerMaySeeVersion (§5)', () => {
  it('serves every working version to the circle', () => {
    for (const s of REV_STATUSES) {
      expect(readerMaySeeVersion(true, s, false), s).toBe(true);
      expect(readerMaySeeVersion(true, s, true), s).toBe(true);
    }
  });

  it('serves only the final file of the revision in force outside the circle', () => {
    expect(readerMaySeeVersion(false, 'in_force', true)).toBe(true);
    expect(readerMaySeeVersion(false, 'in_force', false)).toBe(false);
    for (const s of REV_STATUSES.filter((x) => x !== 'in_force')) {
      expect(readerMaySeeVersion(false, s, true), s).toBe(false);
      expect(readerMaySeeVersion(false, s, false), s).toBe(false);
    }
  });
});

describe('readerMaySeeRevision (D-14)', () => {
  it('shows every revision to the circle', () => {
    for (const s of [...REV_STATUSES, null, undefined]) expect(readerMaySeeRevision(true, s), String(s)).toBe(true);
  });

  it('shows the revisions in force and superseded outside the circle', () => {
    expect(readerMaySeeRevision(false, 'in_force')).toBe(true);
    expect(readerMaySeeRevision(false, 'superseded')).toBe(true);
  });

  it('hides drafted, reviewed, approved-but-not-yet-effective and cancelled revisions outside the circle', () => {
    for (const s of ['draft', 'in_review', 'approved', 'cancelled', null, undefined]) expect(readerMaySeeRevision(false, s), String(s)).toBe(false);
  });
});

describe('readerMaySeeEntry (D-14, journal)', () => {
  const DOCUMENT_ACTIONS = ['edit', 'ecr', 'obsolete', 'hold', 'release', 'archive', 'restore'];
  const REVISION_ACTIONS = ['upload', 'working', 'import', 'reclass', 'request', 'approve', 'sign', 'reject', 'recall', 'delegate', 'comment', 'in_force', 'download', 'graft', 'consult', 'view'];

  it('shows every entry to the circle', () => {
    for (const action of [...DOCUMENT_ACTIONS, ...REVISION_ACTIONS]) {
      expect(readerMaySeeEntry(true, { action, revisionId: null }, undefined), action).toBe(true);
      expect(readerMaySeeEntry(true, { action, revisionId: 7 }, 'draft'), action).toBe(true);
      expect(readerMaySeeEntry(true, { action, revisionId: 7 }, undefined), action).toBe(true);
    }
  });

  it('shows an entry about the document as a whole (metadata, requests, withdrawal, hold, archiving)', () => {
    for (const action of DOCUMENT_ACTIONS) expect(readerMaySeeEntry(false, { action, revisionId: null }, undefined), action).toBe(true);
  });

  it('hides an action that only concerns a revision when the revision is unknown', () => {
    for (const action of REVISION_ACTIONS) expect(readerMaySeeEntry(false, { action, revisionId: null }, undefined), action).toBe(false);
  });

  it('makes an entry about a revision follow that revision', () => {
    for (const action of [...REVISION_ACTIONS, 'ecr']) {
      expect(readerMaySeeEntry(false, { action, revisionId: 7 }, 'in_force'), action).toBe(true);
      expect(readerMaySeeEntry(false, { action, revisionId: 7 }, 'superseded'), action).toBe(true);
      for (const s of ['draft', 'in_review', 'approved', 'cancelled']) expect(readerMaySeeEntry(false, { action, revisionId: 7 }, s), `${action} ${s}`).toBe(false);
      expect(readerMaySeeEntry(false, { action, revisionId: 7 }, undefined), `${action} unknown revision`).toBe(false);
    }
  });
});

describe('readerMaySeeChange (D-14, D-26, change requests)', () => {
  const change = (status: string, revisionId: number | null = null, kind = 'modification') => ({ kind, status, revisionId });

  it('shows everything to the circle', () => {
    for (const status of ['submitted', 'accepted', 'rejected', 'implemented']) {
      for (const rev of [...REV_STATUSES, undefined]) expect(readerMaySeeChange(true, change(status, 7), rev), `${status} ${rev}`).toBe(true);
    }
  });

  it('hides outside the circle a change carried by a revision not in force: the one it opened, or the one it was grafted onto', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled', undefined]) expect(readerMaySeeChange(false, change('implemented', 7), rev), String(rev)).toBe(false);
    for (const rev of ['in_force', 'superseded']) expect(readerMaySeeChange(false, change('implemented', 7), rev), rev).toBe(true);
  });

  it('hides outside the circle an accepted change waiting to apply, never a waiting withdrawal', () => {
    expect(readerMaySeeChange(false, change('accepted'), null)).toBe(false);
    expect(readerMaySeeChange(false, change('accepted', null, 'obsolescence'), null)).toBe(true);
  });

  it('shows outside the circle a request carried by no revision: submitted, rejected, a withdrawal', () => {
    for (const status of ['submitted', 'rejected']) expect(readerMaySeeChange(false, change(status), null), status).toBe(true);
    expect(readerMaySeeChange(false, change('implemented', null, 'obsolescence'), null)).toBe(true);
  });
});

describe('changeAsSeen (D-14, D-26, change requests)', () => {
  const req = (status: string, over: Partial<{ kind: string; ecoRef: string | null; revisionId: number | null }> = {}) =>
    ({ id: 'ECR-2026-002', kind: 'modification', status, ecoRef: 'ECO-2026-020', modifierId: 'writer', revisionId: 7, decidedAt: '2026-10-11 09:30:00', ...over });
  const opened = (status: string) => ({ status, changeRef: 'ECO-2026-020' });
  const grafted = (status: string) => ({ status, changeRef: 'ECO-2026-010' });

  it('leaves everything to the circle, a graft included', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled', 'in_force']) {
      expect(changeAsSeen(true, req('implemented'), grafted(rev)), rev).toEqual(req('implemented'));
    }
  });

  it('shows outside the circle a change grafted onto a revision still open as still accepted, with nothing to name', () => {
    for (const rev of ['draft', 'in_review', 'approved']) {
      // Its acceptance date stays, as for any accepted change: the journal shows it, and leaving it out would tell the graft.
      expect(changeAsSeen(false, req('implemented'), grafted(rev)), rev).toEqual({ ...req('implemented'), status: 'accepted', ecoRef: null, modifierId: null, revisionId: null });
    }
  });

  it('shows « Appliquée » outside the circle once the revision it was grafted onto is cancelled: it will never apply', () => {
    // Like the change that opened that revision: no change order, author or revision, and no wait promised for good.
    expect(changeAsSeen(false, req('implemented'), grafted('cancelled'))).toEqual({ ...req('implemented'), ecoRef: null, modifierId: null, revisionId: null, decidedAt: null });
  });

  it('keeps « Appliquée » outside the circle for a change that opened its revision, naming nothing until it is in force', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled']) {
      // Nor its decision date: applied at once, it is when the hidden revision opened.
      expect(changeAsSeen(false, req('implemented'), opened(rev)), rev).toEqual({ ...req('implemented'), ecoRef: null, modifierId: null, revisionId: null, decidedAt: null });
    }
    // Without a change order, the request itself opened the revision (lib/lifecycle.ts implementChange).
    expect(changeAsSeen(false, req('implemented', { ecoRef: null }), { status: 'draft', changeRef: 'ECR-2026-002' }).status).toBe('implemented');
  });

  it('keeps outside the circle the acceptance date of a change waiting to apply, and every date of a request carried by no revision', () => {
    expect(changeAsSeen(false, req('accepted', { revisionId: null }), null)).toEqual({ ...req('accepted', { revisionId: null }), ecoRef: null, modifierId: null });
    for (const status of ['rejected', 'submitted']) expect(changeAsSeen(false, req(status, { revisionId: null }), null), status).toEqual(req(status, { revisionId: null }));
    expect(changeAsSeen(false, req('implemented', { kind: 'obsolescence', revisionId: null }), null)).toEqual(req('implemented', { kind: 'obsolescence', revisionId: null }));
  });

  it('shows outside the circle a graft, like any change, once its revision is in force or superseded', () => {
    for (const rev of ['in_force', 'superseded']) {
      expect(changeAsSeen(false, req('implemented'), grafted(rev)), rev).toEqual(req('implemented'));
      expect(changeAsSeen(false, req('implemented'), opened(rev)), rev).toEqual(req('implemented'));
    }
  });
});

describe('openRevisionView (D-14, D-26, document record)', () => {
  const rev = (status: string, modifierId: string | null = 'modifier') => ({ letter: 'C', status, modifierId });
  const waiting = { kind: 'modification', status: 'accepted' };

  it('gives nothing outside the drafting circle: no revision open, none to wait for, no graft', () => {
    for (const status of ['draft', 'in_review', 'approved']) {
      for (const who of [stranger, colleague, reader, recordsManager]) {
        expect(openRevisionView(false, who, 'owner', rev(status), waiting), `${who.user.id} ${status}`).toEqual({ open: null, wait: null });
      }
    }
  });

  it('tells the circle about the open revision a change asked now would meet, with nothing waiting', () => {
    for (const status of ['draft', 'in_review', 'approved'] as const) {
      expect(openRevisionView(true, owner, 'owner', rev(status), null), status).toEqual({ open: { letter: 'C', status }, wait: null });
      // A submitted change, a withdrawal or a change already applied waits for nothing.
      for (const r of [{ kind: 'modification', status: 'submitted' }, { kind: 'obsolescence', status: 'accepted' }, { kind: 'modification', status: 'implemented' }]) {
        expect(openRevisionView(true, owner, 'owner', rev(status), r).wait, `${status} ${r.kind} ${r.status}`).toBeNull();
      }
    }
  });

  it('knows of no open revision once it is in force, superseded or cancelled, nor without one', () => {
    for (const status of ['in_force', 'superseded', 'cancelled']) expect(openRevisionView(true, owner, 'owner', rev(status), waiting), status).toEqual({ open: null, wait: null });
    expect(openRevisionView(true, owner, 'owner', null, waiting)).toEqual({ open: null, wait: null });
  });

  it('lets a records manager or the author of the revision being drafted graft the waiting change, not the owner', () => {
    expect(openRevisionView(true, recordsManager, 'owner', rev('draft'), waiting).wait).toEqual({ letter: 'C', author: 'modifier', graft: 'yes' });
    expect(openRevisionView(true, modifier, 'owner', rev('draft'), waiting).wait).toEqual({ letter: 'C', author: 'modifier', graft: 'yes' });
    // The owner, a collaborator, when someone else was designated to write the revision; an approver as well.
    expect(openRevisionView(true, owner, 'owner', rev('draft'), waiting).wait).toEqual({ letter: 'C', author: 'modifier', graft: 'reserved' });
    expect(openRevisionView(true, approver, 'owner', rev('draft'), waiting).wait?.graft).toBe('reserved');
    // Nobody designated: the owner writes the revision, and may graft.
    expect(openRevisionView(true, owner, 'owner', rev('draft', null), waiting).wait).toEqual({ letter: 'C', author: 'owner', graft: 'yes' });
  });

  it('only lets the change wait once the revision is under review or approved, whoever looks', () => {
    for (const status of ['in_review', 'approved'] as const) {
      for (const who of [recordsManager, modifier, owner]) {
        expect(openRevisionView(true, who, 'owner', rev(status), waiting).wait, `${who.user.id} ${status}`).toEqual({ letter: 'C', author: 'modifier', graft: status });
      }
    }
  });
});

describe('draftTodo (G19, revision being drafted)', () => {
  const rejection = { authorId: 'author', outcome: 'rejected' } as const;
  const recall = { authorId: 'author', outcome: 'recalled' } as const;

  it('a revision sent back by a circuit waits for its author, its designated modifier and the owner', () => {
    for (const who of ['author', 'modifier', 'owner']) expect(draftTodo(who, { modifierId: 'modifier' }, 'owner', rejection), who).toBe('rejected');
    expect(draftTodo('owner', { modifierId: null }, 'owner', rejection)).toBe('rejected');
    for (const who of ['approver', 'manager', 'stranger']) expect(draftTodo(who, { modifierId: 'modifier' }, 'owner', rejection), who).toBeNull();
  });

  it('so does one whose circuit was recalled: it is no longer a draft « jamais soumise »', () => {
    for (const who of ['author', 'modifier', 'owner']) expect(draftTodo(who, { modifierId: 'modifier' }, 'owner', recall), who).toBe('recalled');
    for (const who of ['approver', 'manager', 'stranger']) expect(draftTodo(who, { modifierId: 'modifier' }, 'owner', recall), who).toBeNull();
  });

  it('never submitted, it waits for the modifier an ECO designated and for the owner, whose draft it is', () => {
    expect(draftTodo('modifier', { modifierId: 'modifier' }, 'owner', null)).toBe('eco');
    // Assigned to someone else, it is still a draft of the owner's, who may send it for approval.
    expect(draftTodo('owner', { modifierId: 'modifier' }, 'owner', null)).toBe('draft');
    // The owner designated by the ECO drafts it as its modifier.
    expect(draftTodo('owner', { modifierId: 'owner' }, 'owner', null)).toBe('eco');
    expect(draftTodo('owner', { modifierId: null }, 'owner', null)).toBe('draft');
    for (const who of ['author', 'manager', 'stranger']) expect(draftTodo(who, { modifierId: null }, 'owner', null), who).toBeNull();
  });
});

describe('deadlineActor (G19, review and expiry dates)', () => {
  const d = { ownerId: 'owner', processOwnerId: 'process', revInForce: 'B' };

  it('the owner acts on the dates of the document, a change request pending or not', () => {
    for (const kind of ['review', 'expiry'] as const) {
      expect(deadlineActor('owner', d, kind, false), kind).toBe(true);
      expect(deadlineActor('owner', d, kind, true), kind).toBe(true);
      expect(deadlineActor('owner', { ...d, revInForce: null }, kind, false), kind).toBe(true);
    }
  });

  it('the process owner records the review of a revision in force, a change request pending or not (point 13)', () => {
    expect(deadlineActor('process', d, 'review', false)).toBe(true);
    expect(deadlineActor('process', d, 'review', true)).toBe(true);
    expect(deadlineActor('process', { ...d, revInForce: null }, 'review', false)).toBe(false);
  });

  it('on an expiry, the process owner can only ask for a change: a revision in force and no request pending', () => {
    expect(deadlineActor('process', d, 'expiry', false)).toBe(true);
    expect(deadlineActor('process', d, 'expiry', true)).toBe(false);
    expect(deadlineActor('process', { ...d, revInForce: null }, 'expiry', false)).toBe(false);
  });

  it('nobody else, records managers included (they follow every date in Archivage)', () => {
    for (const kind of ['review', 'expiry'] as const) {
      for (const who of ['manager', 'reader', 'stranger']) expect(deadlineActor(who, d, kind, false), `${who} ${kind}`).toBe(false);
      expect(deadlineActor('process', { ...d, processOwnerId: null }, kind, false), kind).toBe(false);
    }
  });
});

describe('mayRecordReview (point 13, « Revue effectuée »)', () => {
  const d = { ownerId: 'owner', processOwnerId: 'process' };
  const editor = (id: string, seesAll = false) => viewer(id, { perms: ['read', 'edit'], seesAll });

  it('the owner, the process owner and records managers, with the edit permission', () => {
    expect(mayRecordReview(editor('owner'), d)).toBe(true);
    expect(mayRecordReview(editor('process'), d)).toBe(true);
    expect(mayRecordReview(editor('manager', true), d)).toBe(true);
    for (const who of ['owner', 'process']) expect(mayRecordReview(viewer(who), d), who).toBe(false);
    expect(mayRecordReview(viewer('manager', { seesAll: true }), d)).toBe(false);
  });

  it('nobody else: an approver, a reader, a stranger, nor a process owner the document does not name', () => {
    for (const who of ['approver', 'reader', 'stranger']) expect(mayRecordReview(editor(who), d), who).toBe(false);
    expect(mayRecordReview(editor('process'), { ...d, processOwnerId: null })).toBe(false);
  });
});

describe('mayRecall (docs/modele-cible.md §6, recalling a running circuit)', () => {
  const running = { requesterId: 'owner', outcome: null };
  const editor = (id: string, over: { department?: string; seesAll?: boolean } = {}) => viewer(id, { perms: ['read', 'upload', 'edit'], ...over });

  it('lets its requester recall it while it runs, with the edit permission and a place in the drafting circle', () => {
    expect(mayRecall(editor('owner'), running, doc(), people)).toBe(true);
    // The designated author who sent it for approval.
    expect(mayRecall(editor('modifier'), { ...running, requesterId: 'modifier' }, doc(), people)).toBe(true);
  });

  it('lets a records manager recall any running circuit', () => {
    expect(mayRecall(editor('manager', { seesAll: true }), running, doc(), people)).toBe(true);
  });

  it('refuses its approvers, the owner who did not request it, and anyone else', () => {
    for (const who of ['approver', 'modifier', 'reader', 'stranger']) expect(mayRecall(editor(who), running, doc(), people), who).toBe(false);
    expect(mayRecall(editor('owner'), { ...running, requesterId: 'modifier' }, doc(), people)).toBe(false);
  });

  it('refuses once the circuit ended: approved, rejected or recalled', () => {
    for (const outcome of ['approved', 'rejected', 'recalled']) {
      expect(mayRecall(editor('owner'), { ...running, outcome }, doc(), people), outcome).toBe(false);
      expect(mayRecall(editor('manager', { seesAll: true }), { ...running, outcome }, doc(), people), outcome).toBe(false);
    }
  });

  it('refuses without the edit permission, and to a requester who left the drafting circle', () => {
    expect(mayRecall(viewer('owner', { perms: ['read', 'upload'] }), running, doc(), people)).toBe(false);
    expect(mayRecall(viewer('manager', { perms: ['read'], seesAll: true }), running, doc(), people)).toBe(false);
    // The owner changed since the request: the former owner no longer works on the draft.
    expect(mayRecall(editor('owner'), running, doc({ ownerId: 'someone_else' }), people)).toBe(false);
  });
});

describe('saved searches (personal, department, group)', () => {
  const collaborator = viewer('writer', { department: 'QUA', perms: ['read', 'upload', 'edit'] });
  const colleague = viewer('colleague', { department: 'QUA', perms: ['read'] });
  const outsider = viewer('engineer', { department: 'ING', perms: ['read', 'upload', 'edit', 'approve', 'publish'] });
  const manager = viewer('manager', { department: 'HSE', perms: ['read', 'upload', 'edit', 'approve', 'publish', 'archive', 'admin'], seesAll: true });
  const admin = viewer('admin', { department: 'DIR', perms: ['read', 'admin'] });
  const noRead = viewer('nobody', { department: 'QUA', perms: [] });
  const personal = { scope: 'personal', ownerId: 'writer', department: null };
  const quality = { scope: 'department', ownerId: 'manager', department: 'QUA' };
  const group = { scope: 'group', ownerId: 'manager', department: null };

  it('lets records managers and administrators share, nobody else', () => {
    expect(mayShareSearches(manager)).toBe(true);
    expect(mayShareSearches(admin)).toBe(true);
    // A records manager whose row lost the admin permission still shares.
    expect(mayShareSearches(viewer('manager', { perms: ['read'], seesAll: true }))).toBe(true);
    for (const v of [collaborator, colleague, outsider, noRead]) expect(mayShareSearches(v), v.user.id).toBe(false);
  });

  it('lets whoever may read save a personal search, and only those who share save a shared one', () => {
    for (const v of [collaborator, colleague, outsider, manager, admin]) expect(maySaveSearch(v, 'personal'), v.user.id).toBe(true);
    expect(maySaveSearch(noRead, 'personal')).toBe(false);
    for (const scope of ['department', 'group']) {
      expect(maySaveSearch(manager, scope), scope).toBe(true);
      expect(maySaveSearch(admin, scope), scope).toBe(true);
      for (const v of [collaborator, colleague, outsider]) expect(maySaveSearch(v, scope), `${v.user.id} ${scope}`).toBe(false);
    }
    expect(maySaveSearch(manager, 'everyone')).toBe(false);
  });

  it('shows a personal search to its owner only, records managers included', () => {
    expect(seesSavedSearch(collaborator, personal)).toBe(true);
    for (const v of [colleague, outsider, manager, admin]) expect(seesSavedSearch(v, personal), v.user.id).toBe(false);
  });

  it('shows a department search to the members of that department, and to those who share', () => {
    expect(seesSavedSearch(collaborator, quality)).toBe(true);
    expect(seesSavedSearch(colleague, quality)).toBe(true);
    expect(seesSavedSearch(outsider, quality)).toBe(false);
    expect(seesSavedSearch(viewer('nodept', { department: null as unknown as string }), { ...quality, department: null })).toBe(false);
    expect(seesSavedSearch(manager, quality)).toBe(true);
    expect(seesSavedSearch(admin, quality)).toBe(true);
  });

  it('shows a group search to everyone', () => {
    for (const v of [collaborator, colleague, outsider, manager, admin, noRead]) expect(seesSavedSearch(v, group), v.user.id).toBe(true);
    expect(seesSavedSearch(manager, { ...group, scope: 'other' })).toBe(false);
  });

  it('lets the owner delete a personal search, and those who share delete a shared one', () => {
    expect(mayDeleteSearch(collaborator, personal)).toBe(true);
    for (const v of [colleague, manager, admin]) expect(mayDeleteSearch(v, personal), v.user.id).toBe(false);
    for (const x of [quality, group]) {
      expect(mayDeleteSearch(manager, x), x.scope).toBe(true);
      expect(mayDeleteSearch(admin, x), x.scope).toBe(true);
      for (const v of [collaborator, colleague, outsider]) expect(mayDeleteSearch(v, x), `${v.user.id} ${x.scope}`).toBe(false);
    }
    // A shared search its author no longer may share: only those who share delete it.
    expect(mayDeleteSearch(collaborator, { ...group, ownerId: 'writer' })).toBe(false);
  });
});
