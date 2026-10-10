import { and, eq } from 'drizzle-orm';
import { contextOf, formatId, lettersUpTo, nextLetter } from '@/lib/codes';
import { MATRIX_ROLE, type SimRole } from '@/lib/i18n';
import type { Db } from './index';
import * as s from './schema';
import type { Attachment, Conf, Origin, RevStatus } from './schema';
import { FAMILIES, TYPES } from './registry';
import { CHANGES, DEMO_DOCS, EVENTS, EXPECTED, VCOMMENTS, type DemoDoc } from './seed-docs';
import { DEPARTMENTS, FUNCTIONS, HOLDERS, MATRIX, PERM_KEYS, PROGRAMS, PROJECTS, ROLE_KEYS, SAVED, SITES, USERS } from './seed-org';

const loc = ([fr, en]: [string, string]) => ({ fr, en });

function hash(str: string): number {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `n` dates spread from `from` to `to` (inclusive). */
function spread(from: string, to: string, n: number): string[] {
  if (n <= 1) return [to];
  const a = Date.parse(`${from}T12:00:00Z`), b = Date.parse(`${to}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(a + ((b - a) * i) / (n - 1)).toISOString().slice(0, 10));
}

const later = (a: string, b: string) => (a > b ? a : b);

const stamp = (date: string, seed: string) => `${date} ${String(8 + (hash(seed) % 10)).padStart(2, '0')}:${String(hash(`${seed}m`) % 60).padStart(2, '0')}:00`;

export async function seed(db: Db) {
  const typeBy = new Map(TYPES.map((t) => [t.code, t]));
  const projectBy = new Map(PROJECTS.map((p) => [p.code, p]));
  const programBy = new Map(PROGRAMS.map((p) => [p.code, p]));

  // Roles that may approve, from the permission matrix: a holder chosen for a step must have one.
  const approverRoles = new Set<string>(ROLE_KEYS.filter((_, i) => MATRIX[i][PERM_KEYS.indexOf('approve')]));
  const mayApprove = (id: string) => {
    const u = USERS.find((x) => x.id === id);
    return !!u && !u.system && approverRoles.has(MATRIX_ROLE[u.role as SimRole]);
  };

  /**
   * Same rule as requestValidation: scoped holder, project / programme manager, group holder — never an excluded person
   * (author, requester), preferably someone without a step yet. Demo data whose holder cannot approve fails loudly.
   */
  function resolve(fnKey: string, d: { department: string; projectCode: string | null; programCode: string | null }, excluded: Set<string>, taken: Set<string>): string {
    const fn = FUNCTIONS.find((f) => f[0] === fnKey);
    if (!fn) throw new Error(`seed: unknown function ${fnKey}`);
    const scope = fn[3];
    const scoped = scope === 'department' ? d.department : scope === 'project' ? d.projectCode : scope === 'research' ? d.programCode : null;
    const candidates = [
      ...HOLDERS.filter((h) => h[0] === fnKey && scoped && h[1] === scoped).map((h) => h[2]),
      ...(scope === 'project' && d.projectCode && (fnKey === 'chef_projet' || fnKey === 'validation_client') ? [projectBy.get(d.projectCode)!.manager] : []),
      ...(scope === 'research' && d.programCode ? [programBy.get(d.programCode)!.manager] : []),
      ...HOLDERS.filter((h) => h[0] === fnKey && !h[1]).map((h) => h[2]),
    ].filter((u) => !excluded.has(u));
    const who = candidates.find((u) => !taken.has(u)) ?? candidates[0];
    if (!who) throw new Error(`seed: no holder for ${fnKey}`);
    if (!mayApprove(who)) throw new Error(`seed: ${who} holds ${fnKey} but their role cannot approve`);
    return who;
  }

  /** Steps of a circuit: the author's, then the type's functions (the author and the requester never approve). */
  function circuitSteps(type: (typeof TYPES)[number], demo: DemoDoc, author: string, requester: string) {
    const scope = { department: demo.dept, projectCode: demo.project ?? null, programCode: demo.program ?? null };
    const excluded = new Set([author, requester, demo.owner]);
    const taken = new Set<string>();
    return [
      { functionKey: null as string | null, name: { fr: 'Rédaction', en: 'Drafting' }, assigneeId: author },
      ...type.circuit.map((fnKey) => {
        const fn = FUNCTIONS.find((f) => f[0] === fnKey);
        if (!fn) throw new Error(`seed: unknown function ${fnKey} in ${type.code}`);
        const who = resolve(fnKey, scope, excluded, taken);
        taken.add(who);
        return { functionKey: fnKey as string | null, name: { fr: fn[1], en: fn[2] }, assigneeId: who };
      }),
    ];
  }

  await db.transaction(async (tx) => {
    await tx.insert(s.departments).values(DEPARTMENTS.map(([code, labelFr, labelEn], sort) => ({ code, labelFr, labelEn, sort })));
    await tx.insert(s.sites).values(SITES.map(([key, label], sort) => ({ key, label, sort })));
    await tx.insert(s.users).values(USERS.map((u) => ({
      id: u.id, name: u.name, role: u.role, isSystem: !!u.system, department: u.dept ?? null, site: u.site ?? null,
      title: u.title ? loc(u.title) : null,
      initials: u.name.split(/[\s-]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    })));
    await tx.insert(s.families).values(FAMILIES.map((f, sort) => ({ key: f.key, labelFr: f.label_fr, labelEn: f.label_en, grp: f.group, sort })));
    await tx.insert(s.docTypes).values(TYPES.map((t, sort) => ({
      code: t.code, labelFr: t.label_fr, labelEn: t.label_en, family: t.family, origins: t.origins, attachments: t.attachments,
      subtypes: t.subtypes, circuit: t.circuit, retentionYears: t.retention.years, retentionTrigger: t.retention.trigger,
      retentionDisposition: t.retention.disposition, retentionBasis: t.retention.basis, confAllowed: t.confAllowed, confDefault: t.confDefault,
      iso: t.iso ?? null, clientDeliverable: !!t.clientDeliverable, source: t.source, sort,
    })));
    await tx.insert(s.functions).values(FUNCTIONS.map(([key, labelFr, labelEn, scope], sort) => ({ key, labelFr, labelEn, scope, sort })));
    await tx.insert(s.functionHolders).values(HOLDERS.map(([functionKey, scopeValue, userId]) => ({ functionKey, scopeValue, userId })));
    await tx.insert(s.projects).values(PROJECTS.map((p) => ({ code: p.code, name: p.name, client: p.client, stage: p.stage, managerId: p.manager, site: p.site, tiers: p.tiers, syncedAt: `${p.synced}:00` })));
    await tx.insert(s.researchPrograms).values(PROGRAMS.map((p) => ({ code: p.code, name: p.name, managerId: p.manager })));
    await tx.insert(s.rolePermissions).values(ROLE_KEYS.flatMap((role, i) => PERM_KEYS.map((perm, j) => ({ role, perm, granted: !!MATRIX[i][j] }))));
    await tx.insert(s.savedSearches).values(SAVED.map((x, i) => ({ label: loc(x.label), q: x.q, facets: x.facets, sort: i })));

    // ── Documents ──
    const seqs = new Map<string, number>();
    const idByKey = new Map<string, string>();
    const audit: (typeof s.auditLog.$inferInsert)[] = [];
    let wfSeq = 300;

    for (const demo of DEMO_DOCS) {
      const type = typeBy.get(demo.type);
      if (!type) throw new Error(`seed: unknown type ${demo.type}`);
      const attachment: Attachment = demo.project ? 'project' : demo.program ? 'research' : 'none';
      const origin: Origin = demo.origin ?? (type.origins.includes('interne') ? 'interne' : 'externe');
      if (!type.attachments.includes(attachment) || !type.origins.includes(origin)) throw new Error(`seed: ${demo.type} does not admit ${origin}/${attachment} (${demo.title})`);
      const conf: Conf = demo.conf && type.confAllowed.includes(demo.conf) ? demo.conf : type.confDefault;
      const idIn = { typeCode: demo.type, attachment, projectCode: demo.project ?? null, programCode: demo.program ?? null, department: demo.dept };
      const ctxKey = `${demo.type}-${contextOf(idIn)}`;
      const seq = (seqs.get(ctxKey) ?? 0) + 1;
      seqs.set(ctxKey, seq);
      const id = formatId(idIn, seq);
      if (demo.key) idByKey.set(demo.key, id);

      // Revisions in force so far (earlier letters superseded), then the working one. The last one entered into force
      // before the working revision was opened (its first version comes 2n days before `modified`); a single letter in
      // force dates from the declared issue.
      const inForceLetters = demo.inForce ? lettersUpTo(demo.inForce) : [];
      const lastInForce = demo.working ? later(addDays(demo.modified, -(2 * demo.working.n + 4)), demo.issued ?? '') : demo.modified;
      const dates = !demo.inForce ? [] : inForceLetters.length === 1 ? [demo.issued ?? lastInForce] : spread(demo.issued ?? lastInForce, lastInForce, inForceLetters.length);
      const createdAt = demo.issued ? addDays(demo.issued, -12) : addDays(demo.modified, -(5 + (hash(id) % 20)));
      const revRows: { letter: string; status: RevStatus; inForceAt?: string; supersededAt?: string; approvedAt?: string; versions: number; date: string; createdAt?: string; modifierId?: string | null; changeRef?: string | null; decided?: string }[] = [];
      inForceLetters.forEach((letter, i) => {
        const last = i === inForceLetters.length - 1;
        revRows.push({ letter, status: last ? 'in_force' : 'superseded', approvedAt: dates[i], inForceAt: dates[i], supersededAt: last ? undefined : dates[i + 1], versions: 1 + (hash(id + letter) % 2), date: dates[i] });
      });
      if (demo.working) {
        // A revision opened by an ECO exists from Vigie's decision on (lifecycle.applyChangeDecision).
        const change = demo.working.changeRef ? CHANGES.find((c) => c.eco === demo.working!.changeRef) : undefined;
        const letter = nextLetter(demo.inForce);
        revRows.push({ letter, status: demo.working.status, versions: demo.working.n, date: demo.modified, createdAt: change?.decided?.slice(0, 10), modifierId: demo.working.modifier ?? null, changeRef: demo.working.changeRef ?? null, decided: change?.decided });
      }
      const inForce = revRows.find((r) => r.status === 'in_force');
      const working = revRows.find((r) => r.status === 'draft' || r.status === 'in_review');
      const state = demo.state ?? 'active';
      const status = state !== 'active' ? state : inForce ? 'in_force' : working ? working.status : 'draft';

      await tx.insert(s.documents).values({
        id, title: demo.title, origin, attachment, projectCode: demo.project ?? null, programCode: demo.program ?? null,
        family: type.family, typeCode: type.code, subtype: demo.subtype ?? null, department: demo.dept, site: demo.site ?? null,
        ownerId: demo.owner, authorId: origin === 'externe' ? null : demo.owner, authorText: origin === 'externe' ? demo.source ?? null : null,
        conf, keywords: demo.kw ?? [], lang: 'fr', state, status, revInForce: inForce?.letter ?? null, revWorking: working?.letter ?? null,
        issuedAt: inForce ? dates[0] : null, reviewDueAt: demo.reviewDue ?? null, expiresAt: demo.expires ?? null,
        retentionYears: type.retention.years, retentionTrigger: type.retention.trigger, retentionDisposition: type.retention.disposition,
        sourceOrg: demo.source ?? null, externalRef: demo.extRef ?? null, receivedAt: demo.received ?? null,
        projectPhase: demo.phase ?? null, workPackage: demo.wp ?? null, discipline: demo.discipline ?? null,
        researchTheme: demo.theme ?? null, studyId: demo.study ?? null, ipStatus: demo.ip ?? null,
        legalHold: !!demo.hold, legalHoldAt: demo.hold ? '2026-09-30' : null,
        obsoleteAt: state === 'obsolete' ? demo.stateAt ?? demo.modified : null, archivedAt: state === 'archived' ? demo.stateAt ?? demo.modified : null,
        createdAt, modifiedAt: demo.modified,
      });
      if (demo.readers?.length) await tx.insert(s.documentReaders).values(demo.readers.map((userId) => ({ docId: id, userId })));

      for (const [ri, r] of revRows.entries()) {
        // A revision exists before its first working version.
        const revCreated = r.approvedAt ? addDays(r.approvedAt, -10) : r.createdAt ?? addDays(r.date, -2 * r.versions - 1);
        const [rev] = await tx.insert(s.revisions).values({
          docId: id, letter: r.letter, status: r.status, approvedAt: r.approvedAt ?? null, inForceAt: r.inForceAt ?? null, supersededAt: r.supersededAt ?? null,
          modifierId: r.modifierId ?? null, changeRef: r.changeRef ?? null, createdAt: revCreated,
        }).returning();
        // Journal entries carry the revision they are about (lib/access.ts, readerMaySeeEntry).
        if (ri === 0) audit.push({ at: stamp(createdAt, `${id}c`), userId: demo.owner, action: 'upload', docId: id, detail: 'A.1', revisionId: rev.id });
        if (r.decided) audit.push({ at: r.decided, userId: 'vigie', action: 'ecr', docId: id, detail: `${r.changeRef} → ${r.letter}`, revisionId: rev.id });
        const vdates = spread(later(addDays(r.date, -2 * r.versions), revCreated), r.date, r.versions);
        await tx.insert(s.workingVersions).values(Array.from({ length: r.versions }, (_, i) => ({
          revisionId: rev.id, docId: id, n: i + 1, authorId: r.modifierId ?? demo.owner, date: vdates[i],
          comment: loc(r.letter === 'A' && i === 0 ? VCOMMENTS[3] : VCOMMENTS[hash(id + r.letter + i) % 3]),
          pages: 2 + (hash(id + r.letter) % 14),
        })));
        // Entry into force closes the day, after any approval stamped that day (stamp() stays before 18:00).
        if (r.inForceAt) audit.push({ at: `${r.inForceAt} 18:00:00`, userId: 'codex', action: 'in_force', docId: id, detail: r.letter, revisionId: rev.id });

        if (r.status === 'in_review' && demo.working) {
          // Running workflow: the type's circuit, resolved as the app would; `done` steps already signed off.
          const requester = r.modifierId ?? demo.owner;
          const steps = circuitSteps(type, demo, requester, requester);
          if (steps.length === 1) throw new Error(`seed: ${type.code} has no approval step but is shown in review (${demo.title})`);
          const done = Math.min(Math.max(demo.working.done ?? 1, 1), steps.length - 1);
          const wid = `W-${++wfSeq}`;
          const sdates = spread(addDays(r.date, -4), r.date, done);
          await tx.insert(s.workflows).values({ id: wid, docId: id, revisionId: rev.id, requesterId: requester, due: addDays(r.date, 10), step: done, createdAt: sdates[0] });
          await tx.insert(s.workflowSteps).values(steps.map((st, idx) => ({ workflowId: wid, idx, ...st, date: idx < done ? sdates[Math.min(idx, sdates.length - 1)] : null })));
          audit.push({ at: stamp(sdates[0], `${wid}r`), userId: requester, action: 'request', docId: id, detail: `${wid} · ${r.letter}`, revisionId: rev.id });
          for (let i = 1; i < done; i++) audit.push({ at: stamp(sdates[i], `${wid}${i}`), userId: steps[i].assigneeId, action: 'approve', docId: id, detail: wid, revisionId: rev.id });
          if (hash(wid) % 2 === 0) {
            await tx.insert(s.workflowComments).values({ workflowId: wid, authorId: requester, at: sdates[0], text: { fr: 'Révision prête pour vérification, modifications surlignées en jaune.', en: 'Revision ready for review, changes highlighted in yellow.' } });
          }
        }
      }
    }

    // A few completed workflows so the "Terminées" view tells the history of recent revisions.
    for (const key of ['pro-doc', 'pv-hlt', 'man-hlt']) {
      const id = idByKey.get(key)!;
      const demo = DEMO_DOCS.find((d) => d.key === key)!;
      const type = typeBy.get(demo.type)!;
      if (!type.circuit.length) continue;
      const [rev] = await tx.select().from(s.revisions).where(and(eq(s.revisions.docId, id), eq(s.revisions.status, 'in_force')));
      const steps = circuitSteps(type, demo, demo.owner, demo.owner);
      const wid = `W-${++wfSeq}`;
      const sdates = spread(addDays(rev.inForceAt!, -6), rev.inForceAt!, steps.length);
      await tx.insert(s.workflows).values({ id: wid, docId: id, revisionId: rev.id, requesterId: demo.owner, due: addDays(rev.inForceAt!, 3), step: steps.length, outcome: 'approved', createdAt: sdates[0] });
      await tx.insert(s.workflowSteps).values(steps.map((st, idx) => ({ workflowId: wid, idx, ...st, date: sdates[idx] })));
      audit.push({ at: stamp(sdates[0], `${wid}r`), userId: demo.owner, action: 'request', docId: id, detail: `${wid} · ${rev.letter}`, revisionId: rev.id });
      steps.slice(1).forEach((st, i) => audit.push({ at: stamp(sdates[i + 1], `${wid}${i}`), userId: st.assigneeId, action: 'approve', docId: id, detail: wid, revisionId: rev.id }));
    }

    await tx.insert(s.changeRequests).values(CHANGES.map((c) => ({
      id: c.id, kind: c.kind, docId: idByKey.get(c.doc)!, requesterId: c.requester, reason: c.reason, description: c.description ?? '',
      status: c.status, ecoRef: c.eco ?? null, modifierId: c.modifier ?? null, createdAt: c.created, decidedAt: c.decided ?? null,
    })));
    CHANGES.forEach((c) => audit.push({ at: c.created, userId: c.requester, action: c.kind === 'modification' ? 'ecr' : 'obsolete', docId: idByKey.get(c.doc)!, detail: c.id }));

    await tx.insert(s.projectExpected).values(EXPECTED.map((x, sort) => ({ projectCode: x.project, label: loc(x.label), typeCode: x.type, docId: x.doc ? idByKey.get(x.doc)! : null, later: !!x.later, sort })));
    await tx.insert(s.projectEvents).values(EVENTS.map((e) => ({ projectCode: e.project, at: `${e.at}:00`, text: loc(e.text) })));
    await tx.insert(s.auditLog).values(audit.sort((a, b) => a.at.localeCompare(b.at)));
  });
}
