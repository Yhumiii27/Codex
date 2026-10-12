import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { GET, HEAD } from '@/app/api/documents/[id]/approval/route';
import { addComment, decideStep, delegateStep, graftChange, requestValidation } from '@/lib/actions';
import { COOKIE_LANG, getCtx } from '@/lib/context';
import { DICT, type SimRole } from '@/lib/i18n';
import { importDocument } from '@/lib/importer';
import { applyChangeDecision } from '@/lib/lifecycle';
import { listAudit } from '@/lib/queries';
import { submitChange } from '@/lib/vigie';
import { addDoc, baseOf, fixClock, getChange, getRevision, journalOf, revisionStatuses, setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { readPdf } from '../support/pdf';
import { actAs, cookieStore } from '../support/session';

// Approval record of a revision (« fiche de visa », point 21 of docs/reste-a-faire.md), through its route: the PDF
// read back as a reader would, field by field; who may have it (canRead, D-14: outside the drafting circle, only a
// revision in force or replaced; never a revision not approved); what a reader who does not follow a circuit gets of
// it (no comment text, no holder of a step never decided); its journal entry, which follows the revision.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock(); // 10 October 2026, 10:00 in Paris

const t = DICT.fr;
const ID = 'PRO-QUA-0001'; // type PRO: head of the QUA department, then the quality manager
const ECO = 'ECO-2026-010';
const ECO_GRAFTED = 'ECO-2026-020'; // a second change Vigie accepted while B was drafted, grafted onto it (D-26)
/** A rejection reason near the 2,000 characters allowed, with accents and parentheses: the record runs over a page. */
const REASON = 'Le chapitre 4 ne cite pas la norme NF EN 13414 (élingues en câbles) ; les contrôles « à vue » avant manœuvre sont insuffisants. '.repeat(15).trim();
const COMMENT = 'Vu, conforme (§ 4.2) — rien à redire sur la révision.';

async function act<R>(who: Person, fn: () => Promise<R>, role?: SimRole): Promise<R> {
  actAs(who, role);
  return fn();
}

/**
 * Revision A in force; B opened by an ECO for writer. W-1: head rejects it with REASON. W-2: head delegates his step to
 * director, who approves; quality comments and approves last: B is in force, A superseded.
 */
async function approvedWithHistory() {
  await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: ECO, versions: ['writer'] }] });
  expect(await act('writer', async () => requestValidation(ID, null, await baseOf(db(), ID)))).toMatchObject({ ok: true });
  expect(await act('head', () => decideStep('W-1', false, 1, REASON))).toEqual({ ok: true });
  expect(await act('writer', async () => requestValidation(ID, null, await baseOf(db(), ID)))).toMatchObject({ ok: true });
  expect(await act('head', () => delegateStep('W-2', 'director', 1))).toEqual({ ok: true });
  expect(await act('director', () => decideStep('W-2', true, 1))).toEqual({ ok: true });
  expect(await act('quality', () => addComment('W-2', COMMENT))).toEqual({ ok: true });
  expect(await act('quality', () => decideStep('W-2', true, 2))).toEqual({ ok: true });
  expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
}

/** The route as `who` (default role, or `role`), in French unless `lang` says otherwise. */
async function fetchRecord(who: Person, id: string, query: string, opts: { role?: SimRole; lang?: 'en'; method?: 'HEAD' } = {}) {
  actAs(who, opts.role);
  if (opts.lang) (await cookieStore()).set(COOKIE_LANG, opts.lang);
  const req = new Request(`http://codex.test/api/documents/${encodeURIComponent(id)}/approval${query}`, { method: opts.method ?? 'GET' });
  const handler = opts.method === 'HEAD' ? HEAD : GET;
  const res = await handler(req, { params: Promise.resolve({ id }) });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), body: Buffer.from(await res.arrayBuffer()) };
}

/** Rows of every page without the footers, joined by spaces: a wrapped paragraph reads as it was written. */
const bodyOf = (pdf: ReturnType<typeof readPdf>) => pdf.pages.flatMap((rows) => rows.slice(0, -1)).join(' ');

describe('the approval record of an approved revision', () => {
  it('is a PDF named {ID}_{letter}_VISA.pdf, whose text gives the revision, its dates, change order, circuits, delegations and comments', async () => {
    await approvedWithHistory();
    // writer requested both circuits: he follows them, comments included.
    const res = await fetchRecord('writer', ID, '?rev=B');
    expect(res).toMatchObject({ status: 200, type: 'application/pdf', disposition: `attachment; filename*=UTF-8''${ID}_B_VISA.pdf` });
    const pdf = readPdf(res.body);
    expect(pdf.title).toBe(`Fiche de visa ${ID} Rév. B`);
    const rows = pdf.pages.flat();
    expect(rows).toEqual(expect.arrayContaining([
      'Extrait du journal de Codex', 'Fiche de visa', `${ID} · Rév. B`,
      `Identifiant ${ID}`, 'Révision B · En vigueur', 'Type PRO · PRO', 'Propriétaire owner', 'Confidentialité Interne',
      'Modificateur désigné writer', `Références ECO ${ECO}`,
      'Approbation 10/10/2026', 'Date d’effet 10/10/2026', 'Mise en vigueur 10/10/2026',
      // W-1, rejected with its reason; its last step never reached.
      'Circuit de validation W-1', 'Demandé par writer le 10/10/2026 10:00', 'Rejeté par head le 10/10/2026 10:00',
      'head · Rejetée · 10/10/2026 10:00', 'quality · Non atteinte',
      // W-2: every step, its holder, decision and moment, the delegation from the journal, the comment.
      'Circuit de validation W-2', 'Approuvé le 10/10/2026 10:00',
      '1. Rédaction', 'writer · Soumise pour validation · 10/10/2026 10:00',
      '2. resp_departement', 'director · Approuvée · 10/10/2026 10:00', 'Déléguée par head à director le 10/10/2026 10:00',
      '3. resp_qualite', 'quality · Approuvée · 10/10/2026 10:00',
      'Commentaires', '10/10/2026 · quality', COMMENT,
      'Extrait du journal de Codex édité le 10/10/2026 10:00 par writer.',
    ]));
    const body = bodyOf(pdf);
    expect(body).toContain(`Motif du rejet ${REASON}`);
    expect(body).toContain(t.visa_no_signature);
    expect(body).not.toContain(t.visa_no_circuit);
    // W-1 comes before W-2, and the long reason takes the record over a page, each one numbered.
    expect(body.indexOf('Circuit de validation W-1')).toBeLessThan(body.indexOf('Circuit de validation W-2'));
    expect(pdf.pages.length).toBeGreaterThanOrEqual(2);
    pdf.pages.forEach((p, i) => expect(p.at(-1)).toBe(`${ID} · Rév. B · Fiche de visa · Page ${i + 1}/${pdf.pages.length}`));
  });

  it('is journaled on its revision; HEAD answers the same without building nor journaling it', async () => {
    await approvedWithHistory();
    const b = await getRevision(db(), ID, 'B');
    const head = await fetchRecord('writer2', ID, '?rev=B', { method: 'HEAD' });
    expect(head).toMatchObject({ status: 200, type: 'application/pdf', disposition: `attachment; filename*=UTF-8''${ID}_B_VISA.pdf` });
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'visa')).toEqual([]);
    expect((await fetchRecord('writer2', ID, '?rev=B')).status).toBe(200);
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'visa')).toEqual([expect.objectContaining({ userId: 'writer2', detail: 'B', revisionId: b.id })]);
  });

  it('outside the drafting circle, is given for the revision in force and the one it replaced (D-14)', async () => {
    await approvedWithHistory();
    const outside = bodyOf(readPdf((await fetchRecord('writer2', ID, '?rev=B')).body));
    expect(outside).toContain(`Motif du rejet ${REASON}`);
    expect(outside).toContain('Déléguée par head à director');
    const a = await fetchRecord('writer2', ID, '?rev=a');
    expect(a).toMatchObject({ status: 200, disposition: `attachment; filename*=UTF-8''${ID}_A_VISA.pdf` });
    expect(readPdf(a.body).pages.flat()).toEqual(expect.arrayContaining(['Révision A · Remplacé', 'Remplacée le 10/10/2026', t.visa_no_circuit]));
  });

  it('to a reader who does not follow a circuit, gives what the application shows them: no comment text, no holder of a step never decided', async () => {
    await approvedWithHistory();
    // writer2 (outside the drafting circle), the owner (inside it) and an auditor take no part in W-1 or W-2.
    for (const who of ['writer2', 'owner', 'auditor'] as const) {
      const pdf = readPdf((await fetchRecord(who, ID, '?rev=B')).body);
      const rows = pdf.pages.flat();
      const body = bodyOf(pdf);
      // Outcome and reason (Validation tab), decisions, their holders and delegations (journal) stay.
      expect(rows).toEqual(expect.arrayContaining([
        'Rejeté par head le 10/10/2026 10:00', 'head · Rejetée · 10/10/2026 10:00', 'director · Approuvée · 10/10/2026 10:00',
        'Déléguée par head à director le 10/10/2026 10:00', 'quality · Approuvée · 10/10/2026 10:00', 'Non atteinte',
        // W-1: the comment Codex wrote at the rejection; W-2: quality's.
        '1 commentaire, lisible dans le circuit par ses participants et les gestionnaires documentaires.',
      ]));
      expect(body).toContain(`Motif du rejet ${REASON}`);
      expect(body).not.toContain(COMMENT);
      expect(body).not.toContain('Rejeté — révision renvoyée en rédaction');
      expect(rows).not.toContain('quality · Non atteinte');
      expect(rows).not.toContain('10/10/2026 · quality');
    }
    // Records managers and the holders of the steps follow the circuits: they read the comments.
    for (const who of ['manager', 'quality'] as const) {
      const pdf = readPdf((await fetchRecord(who, ID, '?rev=B')).body);
      expect(pdf.pages.flat()).toEqual(expect.arrayContaining(['quality · Non atteinte', '10/10/2026 · quality', COMMENT]));
      expect(bodyOf(pdf)).toContain('Rejeté — révision renvoyée en rédaction');
      expect(bodyOf(pdf)).not.toContain('lisible dans le circuit');
    }
    // Circuit by circuit: director held a step of W-2 only, by delegation.
    const director = bodyOf(readPdf((await fetchRecord('director', ID, '?rev=B')).body));
    expect(director).toContain(COMMENT);
    expect(director).not.toContain('Rejeté — révision renvoyée en rédaction');
    expect(director).not.toContain('quality · Non atteinte');
    expect(director).toContain('1 commentaire, lisible dans le circuit');
    expect(director.indexOf('1 commentaire, lisible dans le circuit')).toBeLessThan(director.indexOf('Circuit de validation W-2'));
  });

  it('gives every change order the revision carries: the one that opened it and the one grafted onto it (D-26)', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', modifierId: 'writer', changeRef: ECO, versions: ['writer'] }] });
    const ecr = await db().transaction((tx) => submitChange(tx, { kind: 'modification', docId: ID, requesterId: 'writer2', reason: 'r', description: '' }));
    await db().transaction((tx) => applyChangeDecision(tx, ecr, { accepted: true, ecoRef: ECO_GRAFTED, modifierId: 'writer', note: 'CCB' }, 'vigie'));
    expect(await act('manager', () => graftChange(ecr))).toMatchObject({ ok: true });
    expect(await getChange(db(), ecr)).toMatchObject({ status: 'implemented', revisionId: (await getRevision(db(), ID, 'B')).id });
    expect(await act('writer', async () => requestValidation(ID, null, await baseOf(db(), ID)))).toMatchObject({ ok: true });
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
    expect(await act('quality', () => decideStep('W-1', true, 2))).toEqual({ ok: true });
    expect(await revisionStatuses(db(), ID)).toEqual({ A: 'superseded', B: 'in_force' });
    for (const who of ['writer', 'writer2'] as const) {
      expect(readPdf((await fetchRecord(who, ID, '?rev=B')).body).pages.flat()).toContain(`Références ECO ${ECO}, ${ECO_GRAFTED}`);
    }
  });

  it('is written in the language of the reader', async () => {
    await approvedWithHistory();
    const rows = readPdf((await fetchRecord('owner', ID, '?rev=B', { lang: 'en' })).body).pages.flat();
    expect(rows).toEqual(expect.arrayContaining([
      'Approval record', `${ID} · Rev. B`, 'Revision B · In force', 'Approved on 10 Oct 2026 10:00', 'director · Approved · 10 Oct 2026 10:00',
      '1 comment, readable in the workflow by its participants and the records managers.',
    ]));
  });
});

describe('who may have it', () => {
  it('outside the drafting circle, never for a revision approved but not in force yet (D-14), nor is its journal entry shown', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'approved', effectiveAt: '2026-10-20', versions: ['owner'] }] });
    expect((await fetchRecord('writer2', ID, '?rev=B')).status).toBe(404);
    expect((await fetchRecord('writer2', ID, '?rev=B', { method: 'HEAD' })).status).toBe(404);
    expect((await fetchRecord('auditor', ID, '?rev=B')).status).toBe(404);
    // Its drafting circle has it, « Approuvé » and not in force yet.
    const owner = await fetchRecord('owner', ID, '?rev=B');
    expect(owner.status).toBe(200);
    expect(readPdf(owner.body).pages.flat()).toEqual(expect.arrayContaining(['Révision B · Approuvé', 'Date d’effet 20/10/2026', 'Mise en vigueur —']));
    expect((await fetchRecord('manager', ID, '?rev=B')).status).toBe(200);
    // The entries follow the revision: hidden from readers outside the circle while it is not in force.
    expect((await fetchRecord('writer2', ID, '?rev=A')).status).toBe(200);
    actAs('writer2');
    const seen = (await listAudit(await getCtx(), { docId: ID })).filter((e) => e.action === 'visa');
    expect(seen.map((e) => [e.user, e.detail])).toEqual([['writer2', 'A']]);
    actAs('owner');
    expect((await listAudit(await getCtx(), { docId: ID })).filter((e) => e.action === 'visa').map((e) => e.detail).sort()).toEqual(['A', 'B', 'B']);
  });

  it('never for a revision that was not approved, even to its drafting circle', async () => {
    await addDoc(db(), { id: ID, revisions: [{ letter: 'A', status: 'in_force', versions: ['owner'] }, { letter: 'B', status: 'draft', versions: ['owner'] }] });
    expect((await fetchRecord('owner', ID, '?rev=B')).status).toBe(404);
    expect((await fetchRecord('manager', ID, '?rev=B')).status).toBe(404);
    expect((await fetchRecord('writer2', ID, '?rev=C')).status).toBe(404);
    expect((await journalOf(db(), ID)).filter((e) => e.action === 'visa')).toEqual([]);
  });

  it('never for a document the user may not read: confidential outside its department, or never in force', async () => {
    await addDoc(db(), { id: ID, conf: 'confidentiel' });
    expect((await fetchRecord('writer2', ID, '?rev=A')).status).toBe(404);
    expect((await fetchRecord('head', ID, '?rev=A')).status).toBe(200);
    await addDoc(db(), { id: 'PRO-QUA-0002', revisions: [{ letter: 'A', status: 'draft', versions: ['owner'] }] });
    expect((await fetchRecord('writer2', 'PRO-QUA-0002', '?rev=A')).status).toBe(404);
  });

  it('answers 404 to a missing or malformed letter and to an unknown document; a former ID resolves to the current one', async () => {
    await addDoc(db(), { id: ID, aliases: ['PRO-QUA-0009'] });
    for (const q of ['', '?rev=', '?rev=1', '?rev=A.1', '?rev=ABCD']) expect((await fetchRecord('owner', ID, q)).status).toBe(404);
    expect((await fetchRecord('owner', 'PRO-QUA-0404', '?rev=A')).status).toBe(404);
    expect(await fetchRecord('owner', 'PRO-QUA-0009', '?rev=A')).toMatchObject({ status: 200, disposition: `attachment; filename*=UTF-8''${ID}_A_VISA.pdf` });
  });
});

describe('a revision migrated from the legacy system', () => {
  it('says its approval took place in the legacy system', async () => {
    const res = await importDocument({ legacyRef: 'LEG-0042', title: 'Procédure héritée', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'C', inForceAt: '2025-03-12' }, null);
    expect(res).toMatchObject({ kind: 'created', revStatus: 'in_force' });
    const id = (res as { id: string }).id;
    const rows = readPdf((await fetchRecord('writer2', id, '?rev=C')).body).pages.flat();
    expect(rows).toEqual(expect.arrayContaining(['Approbation Dans l’ancien système', 'Mise en vigueur 12/03/2025']));
    const body = rows.join(' ');
    expect(body).toContain('Révision reprise de l’ancien système (référence LEG-0042) le 10/10/2026 : son approbation a eu lieu dans l’ancien système.');
    expect(body).not.toContain(t.visa_no_circuit);
  });

  it('migrated as a draft then approved by a circuit of Codex: its approval date and circuit, and when it came, not a legacy approval', async () => {
    const res = await importDocument({ legacyRef: 'LEG-0077', title: 'Procédure reprise en brouillon', typeCode: 'PRO', department: 'QUA', ownerId: 'owner', revision: 'B', status: 'draft' }, null);
    expect(res).toMatchObject({ kind: 'created', revStatus: 'draft', version: null });
    const id = (res as { id: string }).id;
    const b = await getRevision(db(), id, 'B');
    expect((await journalOf(db(), id)).filter((e) => e.action === 'import')).toEqual([expect.objectContaining({ detail: 'LEG-0077 → B', revisionId: b.id })]);
    // Not approved yet: no record.
    expect((await fetchRecord('owner', id, '?rev=B')).status).toBe(404);
    await db().insert(s.workingVersions).values({ revisionId: b.id, docId: id, n: 1, comment: { fr: 'Reprise', en: 'Migrated' }, authorId: 'owner', date: '2026-10-10' });
    expect(await act('owner', async () => requestValidation(id, null, await baseOf(db(), id)))).toMatchObject({ ok: true });
    expect(await act('head', () => decideStep('W-1', true, 1))).toEqual({ ok: true });
    expect(await act('quality', () => decideStep('W-1', true, 2))).toEqual({ ok: true });
    expect(await revisionStatuses(db(), id)).toEqual({ B: 'in_force' });
    for (const who of ['owner', 'writer2'] as const) {
      const rows = readPdf((await fetchRecord(who, id, '?rev=B')).body).pages.flat();
      expect(rows).toEqual(expect.arrayContaining([
        'Approbation 10/10/2026', 'Reprise 10/10/2026, en brouillon, de l’ancien système (référence LEG-0077)',
        'Circuit de validation W-1', 'Approuvé le 10/10/2026 10:00', 'quality · Approuvée · 10/10/2026 10:00',
      ]));
      expect(rows).not.toContain('Approbation Dans l’ancien système');
      expect(rows.join(' ')).not.toContain('son approbation a eu lieu dans l’ancien système');
    }
  });
});
