// Synthetic volume for performance measurements (point 56 of docs/reste-a-faire.md, docs/performances.md):
//
//   npm run seed:large -- --docs 10000                       new PGlite database in .data-large (default)
//   npm run seed:large -- --docs 10000 --data-dir /tmp/big   another data directory
//   npm run seed:large -- --docs 10000 --database-url postgres://…   a PostgreSQL server database (named explicitly)
//   options: --people 200 (synthetic people, besides the demo's), --seed 1 (same data for the same seed), --replace
//   (PGlite: deletes the target's database and files first), --append (adds to a database that already holds documents)
//
// A PGlite target is held like the other commands hold theirs (codex.lock): refused while a Codex server runs on it.
//
// Never the demo database by default: the target is .data-large (or what --data-dir / --database-url names; DATABASE_URL
// and CODEX_DATA_DIR are not read), and a database that already holds documents is refused without --append. A new
// target receives the demonstration's reference and demo data (people, projects, functions, register), then the
// synthetic documents: types, attachments, departments, owners and confidentiality drawn among what the register admits,
// with revisions (superseded, in force, drafted, in review), working versions, approval circuits (finished and running),
// comments, named readers and journal entries (uploads, entries into force, requests, approvals, consultations). No file
// is stored: the working versions have none, as after a migration whose files are still to come. Run with tsx's
// react-server condition (package.json), which lets it import the server's database module.

import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { openDb, schema as s, type Db } from '../src/db';
import { seed } from '../src/db/seed';
import { redactUrl } from '../src/db/sql-client';
import { BackupError, lockForCommand, unlock } from '../src/lib/backup-core.mjs';
import { formatId, lettersUpTo, contextOf, type IdInput } from '../src/lib/codes';

type Args = { docs: number; people: number; seed: number; dataDir: string | null; url: string | null; replace: boolean; append: boolean };

function parse(argv: string[]): Args {
  const a: Args = { docs: 10_000, people: 200, seed: 1, dataDir: null, url: null, replace: false, append: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const num = (min: number, max: number) => {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${k} attend un nombre entier de ${min} à ${max}`);
      return v;
    };
    if (k === '--docs') a.docs = num(1, 500_000);
    else if (k === '--people') a.people = num(0, 20_000);
    else if (k === '--seed') a.seed = num(0, 2 ** 31 - 1);
    else if (k === '--data-dir') a.dataDir = argv[++i] ?? '';
    else if (k === '--database-url') a.url = argv[++i] ?? '';
    else if (k === '--replace') a.replace = true;
    else if (k === '--append') a.append = true;
    else throw new Error(`option inconnue : ${k}`);
  }
  if (a.dataDir !== null && !a.dataDir) throw new Error('--data-dir attend un dossier');
  if (a.url !== null && !/^postgres(ql)?:\/\//i.test(a.url)) throw new Error('--database-url attend une adresse postgres://');
  if (a.url && a.dataDir) throw new Error('--data-dir ou --database-url, pas les deux');
  if (a.url && a.replace) throw new Error('--replace ne vaut que pour une base PGlite : sur un serveur, créez une base vide (createdb)');
  return a;
}

/** Deterministic pseudo-random numbers (mulberry32): the same seed gives the same database. */
function rng(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
  const weighted = <T,>(xs: readonly (readonly [T, number])[]): T => {
    let r = next() * xs.reduce((n, x) => n + x[1], 0);
    for (const [v, w] of xs) if ((r -= w) < 0) return v;
    return xs[xs.length - 1][0];
  };
  return { next, int, pick, weighted };
}

const SUBJECTS = ['contrôle des soudures', 'réception des matériaux', 'gestion des déchets', 'sécurité incendie', 'levage et manutention', 'essais de pression', 'traçabilité des lots',
  'qualification des fournisseurs', 'revue de conception', 'plan de prévention', 'maintenance préventive', 'étalonnage des instruments', 'audit interne', 'formation des opérateurs',
  'analyse des risques', 'protection des données', 'achats et sous-traitance', 'plan d\'inspection', 'note de calcul', 'dossier d\'ouvrage exécuté', 'compte rendu de chantier',
  'fiche de non-conformité', 'procès-verbal d\'essai', 'mode opératoire de soudage', 'consignation électrique', 'réglage des capteurs', 'étude de faisabilité', 'cahier des charges'];
const QUALIFIERS = ['— lot', '— zone', '— bâtiment', '— tranche', '— révision du site', '— ligne', '— phase'];
const KEYWORDS = ['soudure', 'sécurité', 'qualité', 'ISO 9001', 'ISO 14001', 'chantier', 'essai', 'fournisseur', 'environnement', 'énergie', 'hydraulique', 'électricité', 'béton',
  'acier', 'inspection', 'audit', 'formation', 'risque', 'maintenance', 'calcul'];
const ORGS = ['APAVE', 'Socotec', 'Bureau Veritas', 'Dekra', 'Qualiconsult', 'AFNOR', 'EDF', 'SNCF Réseau'];
const COMMENTS = ['Merci de vérifier le paragraphe 4.', 'Les annexes sont à jour.', 'Relu, quelques remarques de forme.', 'Version prête pour approbation.', 'Tableau des essais complété.'];
const VCOMMENTS = [['Première version', 'First version'], ['Mise à jour après revue', 'Updated after review'], ['Corrections mineures', 'Minor corrections'], ['Intégration des commentaires', 'Comments incorporated']] as const;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, r: ReturnType<typeof rng>) => `${day}T${String(6 + r.int(11)).padStart(2, '0')}:${String(r.int(60)).padStart(2, '0')}:00Z`;

/** The highest number already written per TYPE-CONTEXTE scope (IDs and aliases), so that synthetic IDs follow them. */
async function usedSeqs(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.$client.query<{ v: string }>('select id as v from documents union all select jsonb_array_elements_text(aliases) from documents');
  const out = new Map<string, number>();
  for (const { v } of rows) {
    const m = /^(.+-.+)-(\d{1,9})$/.exec(v);
    if (m) out.set(m[1], Math.max(out.get(m[1]) ?? 0, Number(m[2])));
  }
  return out;
}

/**
 * The target database: a server's, or PGlite's in its data directory, held against a Codex server or another command
 * (the lock codex.lock, as npm run backup holds it) until `release`. --replace empties the PGlite directory first.
 */
async function open(a: Args): Promise<{ db: Db; where: string; release: () => Promise<void> }> {
  if (a.url) return { db: await openDb({ url: a.url }), where: `serveur PostgreSQL ${redactUrl(a.url)}`, release: async () => {} };
  const dir = path.resolve(a.dataDir ?? '.data-large');
  const dbDir = path.join(dir, 'pglite');
  await mkdir(dir, { recursive: true });
  try {
    await lockForCommand(dir, 'seed');
  } catch (err) {
    if (err instanceof BackupError && err.code === 'busy') throw new Error(`${dir} est tenu par un autre processus (${err.detail}) : arrêtez le serveur Codex ou la commande qui l'utilise.`);
    throw err;
  }
  try {
    if (a.replace) for (const sub of ['pglite', 'files']) await rm(path.join(dir, sub), { recursive: true, force: true });
    else if (await stat(dbDir).then(() => true, () => false)) console.log(`(base existante dans ${dir})`);
    return { db: await openDb(dbDir), where: `PGlite ${dbDir}`, release: () => unlock(dir) };
  } catch (err) {
    await unlock(dir);
    throw err;
  }
}

async function main() {
  const a = parse(process.argv.slice(2));
  const started = performance.now();
  const { db, where, release } = await open(a);
  console.log(`Cible : ${where}`);
  try {
    const [{ users, docs }] = (await db.$client.query<{ users: number; docs: number }>('select (select count(*) from users)::int as users, (select count(*) from documents)::int as docs')).rows;
    if (docs > 0 && !a.append) throw new Error(`la base contient déjà ${docs} document(s) : ajoutez --append pour y ajouter le volume, ou visez une autre base (--data-dir, --replace).`);
    if (users === 0) {
      await seed(db, 'demo');
      console.log('Base vide : référentiel et démonstration chargés (CODEX_SEED=demo).');
    }
    const r = rng(a.seed);

    // ── Reference data read back (the register decides what a type admits) ──
    const types = (await db.select().from(s.docTypes)).filter((t) => t.active !== false);
    const departments = (await db.select().from(s.departments)).map((d) => d.code);
    const sites = (await db.select().from(s.sites)).map((x) => x.key);
    const projects = (await db.select().from(s.projects)).map((p) => p.code);
    const programs = (await db.select().from(s.researchPrograms)).map((p) => p.code);

    // ── Synthetic people, besides the demo's: mostly contributors, some approvers, a few auditors and managers ──
    const existing = new Set((await db.select({ id: s.users.id }).from(s.users)).map((u) => u.id));
    const newPeople = Array.from({ length: a.people }, (_, i) => `synth${String(i + 1).padStart(5, '0')}`).filter((id) => !existing.has(id));
    for (let i = 0; i < newPeople.length; i += 1000) {
      await db.insert(s.users).values(newPeople.slice(i, i + 1000).map((id, j) => ({
        id, name: `Personne ${String(i + j + 1).padStart(5, '0')}`, initials: 'PS', isSystem: false,
        role: r.weighted([['collaborateur', 70], ['validateur', 25], ['auditeur', 3], ['gestionnaire', 2]] as const), department: r.pick(departments), site: r.pick(sites),
      })));
    }
    const people = await db.select({ id: s.users.id, role: s.users.role }).from(s.users).where(sql`not ${s.users.isSystem}`);
    const owners = people.map((p) => p.id);
    const approvers = people.filter((p) => p.role === 'validateur' || p.role === 'gestionnaire').map((p) => p.id);

    const seqs = await usedSeqs(db);
    const [{ w }] = (await db.$client.query<{ w: number }>(`select coalesce(max(substr(id, 3)::int), 0)::int as w from workflows where id ~ '^W-[0-9]+$'`)).rows;
    let wfSeq = Number(w);
    const today = '2026-10-18';
    const counts = { documents: 0, revisions: 0, workingVersions: 0, workflows: 0, steps: 0, comments: 0, readers: 0, audit: 0 };

    const BATCH = 500;
    for (let start = 0; start < a.docs; start += BATCH) {
      const n = Math.min(BATCH, a.docs - start);
      await db.transaction(async (tx) => {
        type Rev = { docId: string; letter: string; status: 'superseded' | 'in_force' | 'draft' | 'in_review'; created: string; approved: string | null; superseded: string | null; versions: number; owner: string };
        const docs: (typeof s.documents.$inferInsert)[] = [];
        const revs: Rev[] = [];
        const readers: { docId: string; userId: string }[] = [];
        for (let k = 0; k < n; k++) {
          const t = r.pick(types);
          const attachment = r.pick(t.attachments);
          const projectCode = attachment === 'project' ? r.pick(projects) : null;
          const programCode = attachment === 'research' ? r.pick(programs) : null;
          if ((attachment === 'project' && !projectCode) || (attachment === 'research' && !programCode)) continue;
          const department = r.pick(departments);
          const idIn: IdInput = { typeCode: t.code, attachment, projectCode, programCode, department };
          const scope = `${t.code}-${contextOf(idIn)}`;
          const seq = (seqs.get(scope) ?? 0) + 1;
          seqs.set(scope, seq);
          const id = formatId(idIn, seq);
          const origin = r.pick(t.origins);
          const conf = r.weighted(t.confAllowed.map((c) => [c, c === t.confDefault ? 6 : c === 'tres_confidentiel' ? 0.3 : 1] as const));
          const owner = r.pick(owners);
          // Old enough for up to four approvals spaced by at most 210 days to stay in the past.
          const created = addDays(today, -(900 + r.int(1800)));
          // What happened to it: in force (most), a new revision drafted or in review on top, a first draft never approved.
          const story = r.weighted([['in_force', 55], ['redraft', 15], ['review', 10], ['first_draft', 15], ['first_review', 5]] as const);
          const inForceCount = story === 'first_draft' || story === 'first_review' ? 0 : 1 + r.weighted([[0, 50], [1, 30], [2, 15], [3, 5]] as const);
          const letters = lettersUpTo(String.fromCharCode(64 + inForceCount + (story === 'in_force' ? 0 : 1)));
          let day = created;
          let inForce: string | null = null;
          let working: string | null = null;
          let issued: string | null = null;
          letters.forEach((letter, i) => {
            const final = i < inForceCount;
            const versions = 1 + r.int(3);
            const approved = final ? (day = addDays(day, 10 + r.int(200))) : null;
            if (final && !issued) issued = approved;
            const status = !final ? (story === 'review' || story === 'first_review' ? 'in_review' : 'draft') : i === inForceCount - 1 ? 'in_force' : 'superseded';
            if (status === 'in_force') inForce = letter;
            if (!final) working = letter;
            revs.push({ docId: id, letter, status, created: final ? addDays(approved!, -10) : addDays(today, -(1 + r.int(25))), approved, superseded: null, versions, owner });
          });
          revs.forEach((x, i) => {
            if (x.docId === id && x.status === 'superseded') x.superseded = revs[i + 1]?.approved ?? null;
          });
          const state = r.weighted([['active', 92], ['obsolete', 5], ['archived', 3]] as const);
          const status = state !== 'active' ? state : inForce ? 'in_force' : working ? (revs.find((x) => x.docId === id && x.letter === working)!.status) : 'draft';
          const external = origin === 'externe';
          docs.push({
            id, title: `${t.labelFr} — ${r.pick(SUBJECTS)} ${r.pick(QUALIFIERS)} ${1 + r.int(60)}`, origin, attachment, projectCode, programCode, family: t.family, typeCode: t.code,
            subtype: t.subtypes.length && r.next() < 0.4 ? r.pick(t.subtypes).fr : null, department, site: r.next() < 0.6 ? r.pick(sites) : null,
            ownerId: owner, authorId: external ? null : owner, authorText: external ? r.pick(ORGS) : null, conf,
            keywords: Array.from(new Set(Array.from({ length: r.int(4) }, () => r.pick(KEYWORDS)))), lang: 'fr', state, status, revInForce: inForce, revWorking: working,
            issuedAt: issued, reviewDueAt: inForce && r.next() < 0.5 ? addDays(today, -60 + r.int(700)) : null,
            retentionYears: t.retentionYears, retentionTrigger: t.retentionTrigger, retentionDisposition: t.retentionDisposition,
            sourceOrg: external ? r.pick(ORGS) : null, externalRef: external ? `EXT-${r.int(99999)}` : null, receivedAt: external ? created : null,
            legalHold: r.next() < 0.01, obsoleteAt: state === 'obsolete' ? addDays(today, -r.int(300)) : null, archivedAt: state === 'archived' ? addDays(today, -r.int(300)) : null,
            createdAt: created, modifiedAt: addDays(today, -r.int(29)),
          });
          if ((conf === 'confidentiel' || conf === 'tres_confidentiel') && r.next() < 0.7) {
            for (const u of new Set(Array.from({ length: 1 + r.int(3) }, () => r.pick(owners)))) readers.push({ docId: id, userId: u });
          }
        }
        if (!docs.length) return;
        await tx.insert(s.documents).values(docs);
        if (readers.length) await tx.insert(s.documentReaders).values(readers).onConflictDoNothing();
        const revRows = await tx.insert(s.revisions).values(revs.map((x) => ({
          docId: x.docId, letter: x.letter, status: x.status, approvedAt: x.approved, inForceAt: x.approved, supersededAt: x.superseded, createdAt: x.created,
        }))).returning({ id: s.revisions.id, docId: s.revisions.docId, letter: s.revisions.letter });
        const revId = new Map(revRows.map((x) => [`${x.docId}/${x.letter}`, x.id]));
        const versions: (typeof s.workingVersions.$inferInsert)[] = [];
        const wfs: (typeof s.workflows.$inferInsert)[] = [];
        const steps: (typeof s.workflowSteps.$inferInsert)[] = [];
        const comments: (typeof s.workflowComments.$inferInsert)[] = [];
        const audit: (typeof s.auditLog.$inferInsert)[] = [];
        for (const x of revs) {
          const rid = revId.get(`${x.docId}/${x.letter}`)!;
          const last = x.approved ?? addDays(today, -1);
          for (let i = 1; i <= x.versions; i++) {
            const d = addDays(x.created, Math.min(i * 2, Math.max(0, (Date.parse(last) - Date.parse(x.created)) / 864e5)));
            versions.push({ revisionId: rid, docId: x.docId, n: i, authorId: x.owner, date: d, comment: { fr: VCOMMENTS[Math.min(i - 1, 3)][0], en: VCOMMENTS[Math.min(i - 1, 3)][1] }, pages: 2 + r.int(30) });
            audit.push({ at: at(d, r), userId: x.owner, action: 'upload', docId: x.docId, detail: `${x.letter}.${i}`, revisionId: rid });
          }
          const circuit = x.status === 'in_review' || (x.approved && r.next() < 0.5);
          if (circuit) {
            const wid = `W-${++wfSeq}`;
            const running = x.status === 'in_review';
            const others = approvers.filter((u) => u !== x.owner);
            const chain = [x.owner, ...new Set(Array.from({ length: 1 + r.int(2) }, () => r.pick(others)))];
            const startDay = running ? addDays(today, -(1 + r.int(10))) : addDays(x.approved!, -(chain.length + 2));
            const done = running ? 1 + r.int(Math.max(1, chain.length - 1)) : chain.length;
            wfs.push({
              id: wid, docId: x.docId, revisionId: rid, requesterId: x.owner, due: addDays(startDay, 14), step: running ? done : chain.length, createdAt: startDay,
              outcome: running ? null : 'approved', closedBy: running ? null : chain[chain.length - 1], closedAt: running ? null : x.approved,
            });
            chain.forEach((u, idx) => steps.push({
              workflowId: wid, idx, functionKey: idx ? 'resp_qualite' : null, name: idx ? { fr: 'Approbation', en: 'Approval' } : { fr: 'Rédaction', en: 'Drafting' },
              assigneeId: u, date: idx < done ? addDays(startDay, idx) : null,
            }));
            audit.push({ at: at(startDay, r), userId: x.owner, action: 'request', docId: x.docId, detail: `${wid} · ${x.letter}`, revisionId: rid });
            for (let i = 1; i < Math.min(done, chain.length); i++) audit.push({ at: at(addDays(startDay, i), r), userId: chain[i], action: 'approve', docId: x.docId, detail: wid, revisionId: rid });
            for (let c = r.int(3); c > 0; c--) comments.push({ workflowId: wid, authorId: r.pick(chain), at: addDays(startDay, r.int(3)), text: { fr: r.pick(COMMENTS), en: 'Comment' } });
          }
          if (x.approved) audit.push({ at: `${x.approved}T16:00:00Z`, userId: 'codex', action: 'in_force', docId: x.docId, detail: x.letter, revisionId: rid });
        }
        for (const d of docs) for (let c = r.int(9); c > 0; c--) audit.push({ at: at(addDays(today, -r.int(365)), r), userId: r.pick(owners), action: 'consult', docId: d.id, detail: '', revisionId: null });
        for (let i = 0; i < versions.length; i += 2000) await tx.insert(s.workingVersions).values(versions.slice(i, i + 2000));
        if (wfs.length) await tx.insert(s.workflows).values(wfs);
        if (steps.length) await tx.insert(s.workflowSteps).values(steps);
        if (comments.length) await tx.insert(s.workflowComments).values(comments);
        audit.sort((p, q) => p.at.localeCompare(q.at));
        for (let i = 0; i < audit.length; i += 2000) await tx.insert(s.auditLog).values(audit.slice(i, i + 2000));
        counts.documents += docs.length;
        counts.revisions += revs.length;
        counts.workingVersions += versions.length;
        counts.workflows += wfs.length;
        counts.steps += steps.length;
        counts.comments += comments.length;
        counts.readers += readers.length;
        counts.audit += audit.length;
      });
      process.stdout.write(`\r${counts.documents} / ${a.docs} documents`);
    }
    process.stdout.write('\n');
    await db.$client.exec('analyze');
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`Écrit en ${secs} s : ${counts.documents} documents, ${counts.revisions} révisions, ${counts.workingVersions} versions de travail, ${counts.workflows} circuits (${counts.steps} étapes, ${counts.comments} commentaires), ${counts.readers} lecteurs nommés, ${counts.audit} entrées de journal ; ${newPeople.length} personnes ajoutées.`);
  } finally {
    await db.$client.close();
    await release();
  }
}

main().catch((err) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
