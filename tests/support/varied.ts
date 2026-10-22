import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { schema as s, type Db } from '@/db';
import type { Conf, DocState } from '@/db/schema';
import { buildAccessIndex, canRead, draftingCircleSql, inDraftingCircle, mayWorkOnDraft, readableSql, type AccessIndex, type Viewer } from '@/lib/access';
import { MATRIX_ROLE, SIM_ROLES, type Perm } from '@/lib/i18n';
import { addDoc, addWorkflow, type RevSpec } from './db';
import { DEPARTMENTS, PEOPLE, type Person } from './fixtures';

// Varied documents drawn at random (with a seed, so that a failure replays), and the comparison of the visibility
// rules of lib/access.ts with their SQL form, for the equivalence tests (tests/integration/*-sql.test.ts).

/** Every person of the database under every simulated role: their row, the role's permissions, records managers see all. */
export async function viewers(q: Db): Promise<[string, Viewer][]> {
  const [users, matrix] = await Promise.all([q.select().from(s.users).where(eq(s.users.isSystem, false)), q.select().from(s.rolePermissions)]);
  return users.flatMap((user) => SIM_ROLES.map((role): [string, Viewer] => {
    const perms = new Set(matrix.filter((r) => r.role === MATRIX_ROLE[role] && r.granted).map((r) => r.perm as Perm));
    return [`${user.id} (${role})`, { user, seesAll: role === 'gestionnaire', can: (p) => perms.has(p) }];
  }));
}

/** For each person and role: the documents canRead and readableSql select, and the drafting circles; returns the pairs compared. */
export async function compareAccess(q: Db): Promise<number> {
  const [ix, rows, vs] = await Promise.all([buildAccessIndex(q), q.select().from(s.documents), viewers(q)]);
  const sorted = (ids: string[]) => [...ids].sort();
  // The index each request builds reads only the rows of its person (getAccessIndex): the same answers as the whole
  // index, for every document. Another built for the documents gives the same members as the whole one.
  const own = new Map<string, AccessIndex>();
  const byDocs = await buildAccessIndex(q, { docs: rows });
  const people = [...new Set(vs.map(([, v]) => v.user.id))];
  for (const d of rows) {
    for (const rel of ['readers', 'modifiers', 'designated', 'approvers'] as const) expect(sorted([...byDocs[rel](d.id)]), `${rel} ${d.id}`).toEqual(sorted([...ix[rel](d.id)]));
    expect(sorted([...byDocs.team(d.projectCode)]), `team ${d.id}`).toEqual(sorted([...ix.team(d.projectCode)]));
  }
  for (const [who, v] of vs) {
    if (!own.has(v.user.id)) own.set(v.user.id, await buildAccessIndex(q, { users: [v.user.id] }));
    const mine = own.get(v.user.id)!;
    const answers = (x: AccessIndex) => rows.map((d) => [d.id, canRead(v, d, x), inDraftingCircle(v, d, x), mayWorkOnDraft(v, d, x)]);
    expect(answers(mine), `${who}, own index`).toEqual(answers(ix));
    // Asking it about someone else, on a document outside its scope, fails rather than answer wrong.
    const other = people.find((p) => p !== v.user.id);
    if (other && rows.length) expect(() => mine.readers(rows[0].id).has(other)).toThrow(/outside its scope/);
  }
  let readable = 0;
  for (const [who, v] of vs) {
    const bySql = await q.select({ id: s.documents.id }).from(s.documents).where(readableSql(v));
    const expected = rows.filter((d) => canRead(v, d, ix)).map((d) => d.id);
    expect(sorted(bySql.map((r) => r.id)), who).toEqual(sorted(expected));
    const circle = await q.select({ id: s.documents.id }).from(s.documents).where(draftingCircleSql(v));
    expect(sorted(circle.map((r) => r.id)), who).toEqual(sorted(rows.filter((d) => inDraftingCircle(v, d, ix)).map((d) => d.id)));
    readable += expected.length;
  }
  // Neither everything nor nothing: the documents above tell people apart.
  expect(readable).toBeGreaterThan(0);
  expect(readable).toBeLessThan(rows.length * vs.length);
  return vs.length;
}

/** Deterministic pseudo-random numbers (mulberry32), so that a failure can be replayed. */
export function random(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  return { next, pick, some: <T,>(xs: readonly T[], max: number): T[] => [...new Set(Array.from({ length: Math.floor(next() * (max + 1)) }, () => pick(xs)))] };
}

export const PERSONS = Object.keys(PEOPLE) as Person[];
const CONFS: Conf[] = ['public', 'restreint', 'interne', 'confidentiel', 'tres_confidentiel'];

/** Revisions of a document: in force, with a revision open or not, never in force, replaced, approved for later. */
function revisionsOf(r: ReturnType<typeof random>, owner: Person): RevSpec[] {
  const modifier = () => (r.next() < 0.5 ? r.pick(PERSONS) : null);
  switch (r.pick([0, 1, 2, 3, 4, 5, 6])) {
    case 0: return [{ letter: 'A', status: 'in_force', versions: [owner] }];
    case 1: return [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'draft', modifierId: modifier() }];
    case 2: return [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'in_review', modifierId: modifier(), versions: [owner] }];
    case 3: return [{ letter: 'A', status: 'draft', modifierId: modifier() }];
    case 4: return [{ letter: 'A', status: 'in_review', versions: [owner] }];
    case 5: return [{ letter: 'A', status: 'superseded' }, { letter: 'B', status: 'in_force' }];
    default: return [{ letter: 'A', status: 'in_force' }, { letter: 'B', status: 'approved', effectiveAt: '2026-11-01', modifierId: modifier() }];
  }
}

/** `n` documents drawn from `seed`, with readers, circuits and changes; returns their IDs. */
export async function variedDocuments(q: Db, seed: number, n: number): Promise<string[]> {
  const r = random(seed);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const project = r.next() < 0.35;
    const typeCode = project ? r.pick(['PID', 'COR']) : r.pick(['PRO', 'FRM', 'COR']);
    const owner = r.pick(PERSONS);
    const id = `${typeCode}-${project ? 'HLT-026' : 'QUA'}-${String(i).padStart(4, '0')}`;
    const revisions = revisionsOf(r, owner);
    const state: DocState = r.next() < 0.85 ? 'active' : r.pick(['obsolete', 'archived'] as const);
    await addDoc(q, { id, typeCode, department: r.pick(DEPARTMENTS), ownerId: owner, conf: r.pick(CONFS), state, projectCode: project ? 'HLT-026' : null, revisions });
    ids.push(id);
    const readers = r.some(PERSONS, 2);
    if (readers.length) await q.insert(s.documentReaders).values(readers.map((userId) => ({ docId: id, userId })));
    // A circuit on the last revision: running (at any step), approved, rejected, or past its last step.
    const last = revisions[revisions.length - 1];
    if (last.status === 'in_review' || (last.status !== 'in_force' && r.next() < 0.4)) {
      const approvers = r.some(PERSONS.filter((p) => p !== owner), 3);
      const outcome = last.status === 'in_review' ? r.pick([null, null, 'rejected'] as const) : r.pick(['approved', 'rejected'] as const);
      await addWorkflow(q, { id: `W-${i}`, docId: id, letter: last.letter, requesterId: owner, author: owner, approvers, step: Math.floor(r.next() * (approvers.length + 2)), outcome });
    }
    // A change Vigie accepted (its designated author joins the circle while it waits), or one that does not count.
    const change = r.pick(['none', 'none', 'accepted', 'submitted', 'withdrawal'] as const);
    if (change !== 'none') {
      await q.insert(s.changeRequests).values({
        id: `ECR-${i}`, kind: change === 'withdrawal' ? 'obsolescence' : 'modification', docId: id, requesterId: r.pick(PERSONS), reason: 'r',
        status: change === 'submitted' ? 'submitted' : 'accepted', modifierId: r.pick(PERSONS), createdAt: '2026-10-01 08:00:00',
      });
    }
  }
  return ids;
}


// ── What the search and the explorer read ─────────────────────────────────

const WORDS = [
  'Procédure', 'PROCEDURE', 'procédures', 'levage', 'Levage', 'prélevage', 'élingage', 'Plan', "plan d'élingage", 'Œuvre', 'oeuvre', 'béton', 'Beton',
  'BÉTON-armé', 'Rapport', 'rapport', 'Rapport 9', 'Rapport 10', 'rapport 010', 'HLT-026', 'hlt', 'nomenclature', 'ATEX', 'A1410', 'sécurité', 'x.y',
  '(note)', '50%', 'a_b', 'C:\\temp', 'ΑΣ', 'Straße', 'Æther', 'ﬁche', '², levage', 'Zoé', 'zoe', 'Écrit', 'ecrit',
];
const KEYWORDS = ['ATEX', 'levage', 'Levage', 'béton', 'beton', '', 'A1410', 'sécurité', 'Rapport'];
const SOURCES = ['Bureau Veritas', 'Bureau Veritas, Lyon', 'APAVE', '\ufeffAPAVE', 'Apave', 'Socotec'];
const DAYS = ['2026-08-30', '2026-09-01', '2026-09-15', '2026-09-28', '2026-10-01', '2026-10-05', '2026-10-09', '2026-10-10', '2026-10-11', '2026-11-20'];
const at = (r: ReturnType<typeof random>, xs: readonly string[], p: number) => (r.next() < p ? r.pick(xs) : null);

/**
 * Metadata drawn from `seed` for the documents `ids`, as the search and the explorer read them: titles and values with
 * accents, case, punctuation and other scripts; keywords (one typed twice), former IDs, subtypes, source organisations (one starting with
 * a byte order mark), free-text or named authors, references, languages, sites, project phases, research attachments;
 * dates shared by several documents (modification, issue, review, expiry, entry into force, effective date); and
 * journal entries that date a document outside its drafting circle, some just before midnight UTC (the next day in
 * Paris). A project code is sometimes left on a document attached to no project. Needs the sites `lyon` and `le_havre`.
 */
export async function variedMetadata(q: Db, seed: number, ids: string[]): Promise<void> {
  const r = random(seed);
  for (const id of ids) {
    const words = Array.from({ length: 1 + Math.floor(r.next() * 3) }, () => r.pick(WORDS));
    const research = !id.includes('HLT') && r.next() < 0.15;
    // A keyword typed twice; a project code left on a document attached to no project (the explorer goes by the attachment).
    const keywords = r.some(KEYWORDS, 3);
    if (keywords.length > 1 && r.next() < 0.3) keywords.push(keywords[0]);
    const stale = !research && !id.includes('HLT') && r.next() < 0.08 ? { projectCode: 'HLT-026' } : {};
    await q.update(s.documents).set({
      title: words.join(' '),
      keywords,
      ...stale,
      aliases: r.next() < 0.2 ? [r.pick(['OLD-123', 'LEG-É-9', 'PRO-QUA-9999', 'levage-1'])] : [],
      subtype: at(r, ['Mode opératoire', 'mode opératoire', 'Instruction', '', 'Instruction levage'], 0.4),
      origin: r.next() < 0.3 ? 'externe' : 'interne',
      sourceOrg: at(r, SOURCES, 0.4),
      authorText: at(r, ['Jean Dupont', '', 'Zoé Écrit', 'levage SA'], 0.3),
      authorId: r.next() < 0.3 ? r.pick(PERSONS) : null,
      externalRef: at(r, ['EXT-2026/01', 'ext 9', 'levage-ref'], 0.3),
      studyId: at(r, ['ST-12', 'st-120'], 0.2),
      lang: at(r, ['fr', 'en', ''], 0.6),
      site: at(r, ['lyon', 'le_havre'], 0.5),
      projectPhase: at(r, ['Études', 'Exécution', 'etudes'], 0.3),
      workPackage: at(r, ['L1', 'L2'], 0.2),
      discipline: at(r, ['Génie civil', 'Électricité'], 0.2),
      ...(research ? { attachment: 'research' as const, programCode: 'R2601', researchTheme: at(r, ['Capteurs', 'capteurs'], 0.7), typeCode: 'PRT', family: 'recherche' } : {}),
      issuedAt: at(r, DAYS, 0.6),
      reviewDueAt: at(r, DAYS, 0.4),
      expiresAt: at(r, DAYS, 0.4),
      modifiedAt: r.pick(DAYS.slice(0, 8)),
    }).where(eq(s.documents.id, id));
    // The revision in force: when it entered into force, and the effective date it was given.
    await q.update(s.revisions).set({ inForceAt: r.pick(DAYS.slice(0, 7)), effectiveAt: at(r, DAYS, 0.5) }).where(and(eq(s.revisions.docId, id), eq(s.revisions.status, 'in_force')));
    // Changes of the record readers see (and some they do not: a working version, an entry about a revision).
    const entries = Array.from({ length: Math.floor(r.next() * 3) }, () => ({
      at: `${r.pick(DAYS.slice(0, 8))} ${r.pick(['08:00:00', '21:30:00', '22:30:00', '23:59:00'])}+00`, userId: 'manager', action: r.pick(['edit', 'reviewed', 'archive', 'restore', 'working', 'readers']), docId: id,
    }));
    if (entries.length) await q.insert(s.auditLog).values(entries);
  }
}
