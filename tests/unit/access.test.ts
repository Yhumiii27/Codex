import { describe, expect, it } from 'vitest';
import { canRead, changeAsSeen, inDraftingCircle, isUsableTemplate, readerMaySeeChange, readerMaySeeEntry, readerMaySeeRevision, readerMaySeeVersion, readersApply, type AccessIndex, type Viewer } from '@/lib/access';
import { CONF_LEVELS, PERMS, type Perm } from '@/lib/i18n';

// Who sees what: confidentiality levels (D-13), drafting circle (D-14), docs/modele-cible.md §5.

type Doc = Parameters<typeof canRead>[1];
type People = Partial<Record<'readers' | 'modifiers' | 'approvers' | 'team', Record<string, string[]>>>;

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
function index({ readers = {}, modifiers = {}, approvers = {}, team = {} }: People = {}): AccessIndex {
  const lookup = (m: Record<string, string[]>) => (key: string) => new Set(m[key] ?? []);
  return { readers: lookup(readers), modifiers: lookup(modifiers), approvers: lookup(approvers), team: (code) => (code ? lookup(team)(code) : new Set()) };
}

/** A QUA document owned by `owner`, revision A in force. */
const doc = (over: Partial<Doc> = {}): Doc => ({ id: 'PRO-QUA-0003', ownerId: 'owner', department: 'QUA', projectCode: null, conf: 'interne', state: 'active', revInForce: 'A', ...over });

const D = 'PRO-QUA-0003';
const people = index({
  readers: { [D]: ['reader'] },
  modifiers: { [D]: ['modifier'] },
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
const circle = { owner, modifier, approver, recordsManager };
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
  const REVISION_ACTIONS = ['upload', 'working', 'import', 'reclass', 'request', 'approve', 'sign', 'reject', 'delegate', 'comment', 'in_force', 'download', 'graft'];

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
    ({ id: 'ECR-2026-002', kind: 'modification', status, ecoRef: 'ECO-2026-020', modifierId: 'writer', revisionId: 7, ...over });
  const opened = (status: string) => ({ status, changeRef: 'ECO-2026-020' });
  const grafted = (status: string) => ({ status, changeRef: 'ECO-2026-010' });

  it('leaves everything to the circle, a graft included', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled', 'in_force']) {
      expect(changeAsSeen(true, req('implemented'), grafted(rev)), rev).toEqual(req('implemented'));
    }
  });

  it('shows outside the circle a change grafted onto a revision not in force as still accepted, with nothing to name', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled']) {
      expect(changeAsSeen(false, req('implemented'), grafted(rev)), rev).toEqual({ ...req('implemented'), status: 'accepted', ecoRef: null, modifierId: null, revisionId: null });
    }
  });

  it('keeps « Appliquée » outside the circle for a change that opened its revision, naming nothing until it is in force', () => {
    for (const rev of ['draft', 'in_review', 'approved', 'cancelled']) {
      expect(changeAsSeen(false, req('implemented'), opened(rev)), rev).toEqual({ ...req('implemented'), ecoRef: null, modifierId: null, revisionId: null });
    }
    // Without a change order, the request itself opened the revision (lib/lifecycle.ts implementChange).
    expect(changeAsSeen(false, req('implemented', { ecoRef: null }), { status: 'draft', changeRef: 'ECR-2026-002' }).status).toBe('implemented');
  });

  it('shows outside the circle a graft, like any change, once its revision is in force or superseded', () => {
    for (const rev of ['in_force', 'superseded']) {
      expect(changeAsSeen(false, req('implemented'), grafted(rev)), rev).toEqual(req('implemented'));
      expect(changeAsSeen(false, req('implemented'), opened(rev)), rev).toEqual(req('implemented'));
    }
  });
});
