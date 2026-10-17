import { describe, expect, it } from 'vitest';
import { followsCircuit, mayGetApprovalRecord } from '@/lib/access';
import { parseDelegation, stepOutcome, visaCircuit, visaFileName, visaFooter, visaLines, type JournalRow, type VisaRecord } from '@/lib/approval';
import { DICT } from '@/lib/i18n';

// Approval record of a revision (« fiche de visa », point 21 of docs/reste-a-faire.md): who may have it (D-14), what
// each step came to, the delegations read from the journal, what a reader who does not follow a circuit gets of it,
// and what the sheet says, the legacy approval of a migrated revision and the absence of electronic signature included.

const t = DICT.fr;
const names: Record<string, string> = { writer: 'Julien Wagner', head: 'Gabriel Comte', director: 'Lucie Fabre', quality: 'Anne Roy', quality2: 'Marc Petit', vigie: 'Vigie' };
const name = (id: string | null | undefined) => (id ? names[id] ?? id : '—');

describe('who may have the approval record', () => {
  it('needs an approved revision', () => {
    expect(mayGetApprovalRecord(true, { status: 'draft', approvedAt: null })).toBe(false);
    expect(mayGetApprovalRecord(true, { status: 'in_review', approvedAt: null })).toBe(false);
    expect(mayGetApprovalRecord(true, { status: 'approved', approvedAt: '2026-10-10' })).toBe(true);
  });

  it('outside the drafting circle, only for the revision in force and those it replaced (D-14)', () => {
    expect(mayGetApprovalRecord(false, { status: 'in_force', approvedAt: '2026-10-10' })).toBe(true);
    expect(mayGetApprovalRecord(false, { status: 'superseded', approvedAt: '2026-09-10' })).toBe(true);
    expect(mayGetApprovalRecord(false, { status: 'approved', approvedAt: '2026-10-10' })).toBe(false);
    expect(mayGetApprovalRecord(false, { status: 'cancelled', approvedAt: '2026-10-10' })).toBe(false);
    expect(mayGetApprovalRecord(true, { status: 'cancelled', approvedAt: '2026-10-10' })).toBe(true);
  });
});

describe('who follows a circuit, and reads its comments on the record', () => {
  const w = { requesterId: 'writer' };
  const steps = [{ assigneeId: 'writer' }, { assigneeId: 'director' }, { assigneeId: 'quality' }];
  const viewer = (id: string, seesAll = false) => ({ user: { id }, seesAll, can: () => true }) as unknown as Parameters<typeof followsCircuit>[0];

  it('records managers, its requester and the holders of its steps; nobody else', () => {
    expect(followsCircuit(viewer('manager', true), w, steps)).toBe(true);
    expect(followsCircuit(viewer('writer'), w, [])).toBe(true);
    expect(followsCircuit(viewer('director'), w, steps)).toBe(true);
    expect(followsCircuit(viewer('owner'), w, steps)).toBe(false);
    expect(followsCircuit(viewer('auditor'), w, steps)).toBe(false);
  });
});

describe('what each step came to', () => {
  const outcomes = (w: { step: number; outcome: 'approved' | 'rejected' | 'recalled' | null; closedBy: string | null }, holders: string[]) => holders.map((h, i) => stepOutcome(w, i, h));
  const holders = ['writer', 'head', 'quality'];

  it('approved: the drafting step sent it, every other step approved it', () => {
    expect(outcomes({ step: 3, outcome: 'approved', closedBy: 'quality' }, holders)).toEqual(['submitted', 'approved', 'approved']);
  });

  it('rejected by the holder of the current step; closed by someone else (a withdrawal), undecided', () => {
    expect(outcomes({ step: 1, outcome: 'rejected', closedBy: 'head' }, holders)).toEqual(['submitted', 'rejected', 'not_reached']);
    expect(outcomes({ step: 2, outcome: 'rejected', closedBy: 'vigie' }, holders)).toEqual(['submitted', 'approved', 'closed']);
  });

  it('recalled before the current step was decided; running, the current step waits', () => {
    expect(outcomes({ step: 2, outcome: 'recalled', closedBy: 'writer' }, holders)).toEqual(['submitted', 'approved', 'recalled']);
    expect(outcomes({ step: 1, outcome: null, closedBy: null }, holders)).toEqual(['submitted', 'pending', 'not_reached']);
  });
});

describe('delegations read from the journal', () => {
  it('reads the step and the person it went to, for this circuit only', () => {
    expect(parseDelegation('W-12 · Responsable qualité → Lucie Fabre', 'W-12')).toEqual({ step: 'Responsable qualité', to: 'Lucie Fabre' });
    expect(parseDelegation('W-12 · Responsable qualité → Lucie Fabre', 'W-1')).toBeNull();
    expect(parseDelegation('W-12', 'W-12')).toBeNull();
  });
});

const W2 = { id: 'W-2', step: 3, outcome: 'approved' as const, requesterId: 'writer', closedBy: 'quality', closedAt: '2026-10-09', reason: null, createdAt: '2026-10-05' };
const STEPS = [
  { idx: 0, name: { fr: 'Rédaction', en: 'Drafting' }, assigneeId: 'writer', date: '2026-10-05' },
  { idx: 1, name: { fr: 'Responsable de département', en: 'Head of department' }, assigneeId: 'director', date: '2026-10-07' },
  { idx: 2, name: { fr: 'Responsable qualité', en: 'Quality manager' }, assigneeId: 'quality', date: '2026-10-09' },
];
const JOURNAL: JournalRow[] = [
  { at: '2026-10-02 09:00:00', userId: 'writer', action: 'request', detail: 'W-1 · B' },
  { at: '2026-10-05 09:12:00', userId: 'writer', action: 'request', detail: 'W-2 · B' },
  { at: '2026-10-06 11:30:00', userId: 'head', action: 'delegate', detail: 'W-2 · Responsable de département → Lucie Fabre' },
  { at: '2026-10-07 14:05:00', userId: 'director', action: 'approve', detail: 'W-2' },
  { at: '2026-10-08 08:00:00', userId: 'quality2', action: 'delegate', detail: 'W-2 · Ancien nom → Anne Roy' },
  { at: '2026-10-09 16:45:00', userId: 'quality', action: 'approve', detail: 'W-2' },
  { at: '2026-10-09 16:45:00', userId: 'quality', action: 'approve', detail: 'W-20' },
];

describe('one circuit as the record tells it', () => {
  const c = visaCircuit(W2, [...STEPS].reverse(), [{ authorId: 'quality', at: '2026-10-09', text: { fr: 'Vu, conforme.', en: 'Seen, compliant.' } }], JOURNAL, 'fr', name, true);

  it('gives each step its holder, outcome and the moment the journal recorded, ignoring other circuits', () => {
    expect(c.steps.map((s) => [s.name, s.holder, s.outcome, s.at])).toEqual([
      ['Rédaction', 'Julien Wagner', 'submitted', '2026-10-05 09:12:00'],
      ['Responsable de département', 'Lucie Fabre', 'approved', '2026-10-07 14:05:00'],
      ['Responsable qualité', 'Anne Roy', 'approved', '2026-10-09 16:45:00'],
    ]);
    expect(c.requestedAt).toBe('2026-10-05 09:12:00');
    expect(c.closedAt).toBe('2026-10-09 16:45:00');
  });

  it('puts a delegation under its step, and one it cannot place under the circuit', () => {
    expect(c.steps[1].delegations).toEqual([{ from: 'Gabriel Comte', to: 'Lucie Fabre', at: '2026-10-06 11:30:00' }]);
    expect(c.delegations).toEqual([{ step: 'Ancien nom', from: 'Marc Petit', to: 'Anne Roy', at: '2026-10-08 08:00:00' }]);
  });

  it('gives its comments to whoever follows it', () => {
    expect(c.comments).toEqual([{ who: 'Anne Roy', at: '2026-10-09', text: 'Vu, conforme.' }]);
    expect(c.withheld).toBe(0);
  });

  it('to a reader who does not follow it: the number of comments, not their text; no holder for a step never decided', () => {
    const comments = [{ authorId: 'head', at: '2026-10-03', text: { fr: 'Note interne : ne pas diffuser', en: 'Internal note' } }, { authorId: 'head', at: '2026-10-03', text: { fr: 'Rejeté — motif', en: 'Rejected' } }];
    const rejected = visaCircuit({ ...W2, id: 'W-1', step: 1, outcome: 'rejected', closedBy: 'head', closedAt: '2026-10-03', reason: 'Motif' }, STEPS.map((s, i) => (i === 1 ? { ...s, assigneeId: 'head' } : s)), comments, JOURNAL, 'fr', name, false);
    expect(rejected.comments).toEqual([]);
    expect(rejected.withheld).toBe(2);
    expect(rejected.steps.map((s) => [s.holder, s.outcome])).toEqual([['Julien Wagner', 'submitted'], ['Gabriel Comte', 'rejected'], [null, 'not_reached']]);
    const recalled = visaCircuit({ ...W2, step: 2, outcome: 'recalled', closedBy: 'writer' }, STEPS, [], JOURNAL, 'fr', name, false);
    expect(recalled.steps.map((s) => s.holder)).toEqual(['Julien Wagner', 'Lucie Fabre', null]);
    // An approved circuit: every step was decided, its holders are those the journal names.
    expect(visaCircuit(W2, STEPS, comments, JOURNAL, 'fr', name, false).steps.map((s) => s.holder)).toEqual(['Julien Wagner', 'Lucie Fabre', 'Anne Roy']);
  });

  it('falls back on the days kept on the circuit when the journal has no entry', () => {
    const bare = visaCircuit(W2, STEPS, [], [], 'en', name, true);
    expect(bare.steps.map((s) => [s.name, s.at])).toEqual([['Drafting', '2026-10-05'], ['Head of department', '2026-10-07'], ['Quality manager', '2026-10-09']]);
    expect(bare.requestedAt).toBe('2026-10-05');
  });
});

const RECORD: VisaRecord = {
  doc: { id: 'PRO-QUA-0001', title: 'Maîtrise des documents', type: 'PRO · Procédure', context: 'Qualité', owner: 'Claire Bardet', conf: 'Interne', state: null },
  rev: { letter: 'B', status: 'En vigueur', createdAt: '2026-10-01', approvedAt: '2026-10-09', effectiveAt: null, inForceAt: '2026-10-09', supersededAt: null, modifier: 'Julien Wagner', changeRefs: ['ECO-2026-010', 'ECO-2026-012'], file: null },
  imported: null,
  circuits: [],
  issued: { at: '2026-10-12 10:15:00', by: 'James Holt' },
};
const text = (r: VisaRecord) => visaLines(t, 'fr', r).map((l) => (l.label ? `${l.label} ${l.text}` : l.text));

describe('what the sheet says', () => {
  it('names the approved file and its SHA-256 recorded at upload, or says it was not computed (point 31)', () => {
    const sha = 'a'.repeat(64);
    const withFile = text({ ...RECORD, rev: { ...RECORD.rev, file: { name: 'procedure.pdf', size: '12 Ko', sha256: sha } } });
    expect(withFile).toEqual(expect.arrayContaining(['Fichier approuvé procedure.pdf · 12 Ko', `SHA-256 ${sha}`]));
    const before = text({ ...RECORD, rev: { ...RECORD.rev, file: { name: 'procedure.pdf', size: '12 Ko', sha256: null } } });
    expect(before).toContain(`SHA-256 ${t.visa_no_sha}`);
    expect(text(RECORD).some((l) => l.startsWith('SHA-256'))).toBe(false);
  });
  it('names the document, the revision, its dates and every change order, and says it is an extract of the journal', () => {
    const lines = text({ ...RECORD, circuits: [visaCircuit(W2, STEPS, [], JOURNAL, 'fr', name, true)] });
    expect(lines).toEqual(expect.arrayContaining([
      'Fiche de visa', 'PRO-QUA-0001 · Rév. B', 'Maîtrise des documents', 'Identifiant PRO-QUA-0001', 'Révision B · En vigueur', 'Type PRO · Procédure',
      'Modificateur désigné Julien Wagner', 'Références ECO ECO-2026-010, ECO-2026-012', 'Approbation 09/10/2026', 'Date d’effet 09/10/2026',
      'Mise en vigueur 09/10/2026', 'Circuit de validation W-2', 'Demandé par Julien Wagner le 05/10/2026 09:12', 'Approuvé le 09/10/2026 16:45',
      '2. Responsable de département', 'Lucie Fabre · Approuvée · 07/10/2026 14:05', 'Déléguée par Gabriel Comte à Lucie Fabre le 06/10/2026 11:30',
      'Extrait du journal de Codex édité le 12/10/2026 10:15 par James Holt.', t.visa_no_signature,
    ]));
    expect(lines).not.toContain(t.visa_no_circuit);
  });

  it('gives the reason of a rejected circuit', () => {
    const rejected = visaCircuit({ ...W2, id: 'W-1', step: 1, outcome: 'rejected', closedBy: 'head', closedAt: '2026-10-03', reason: 'Le chapitre 4 ne cite pas la norme.' }, STEPS.map((s, i) => (i === 1 ? { ...s, assigneeId: 'head', date: null } : i === 2 ? { ...s, date: null } : s)), [], [], 'fr', name, true);
    const lines = text({ ...RECORD, circuits: [rejected] });
    expect(lines).toEqual(expect.arrayContaining(['Rejeté par Gabriel Comte le 03/10/2026', 'Motif du rejet Le chapitre 4 ne cite pas la norme.', 'Gabriel Comte · Rejetée · 03/10/2026', 'Anne Roy · Non atteinte']));
  });

  it('tells a reader who does not follow a circuit how many comments it has, without their text', () => {
    const comments = [{ authorId: 'quality', at: '2026-10-09', text: { fr: 'Vu, conforme.', en: 'Seen, compliant.' } }];
    const one = text({ ...RECORD, circuits: [visaCircuit(W2, STEPS, comments, JOURNAL, 'fr', name, false)] });
    expect(one).toEqual(expect.arrayContaining(['Commentaires', '1 commentaire, lisible dans le circuit par ses participants et les gestionnaires documentaires.']));
    expect(one).not.toContain('Vu, conforme.');
    const two = text({ ...RECORD, circuits: [visaCircuit(W2, STEPS, [...comments, ...comments], JOURNAL, 'fr', name, false)] });
    expect(two).toContain('2 commentaires, lisibles dans le circuit par ses participants et les gestionnaires documentaires.');
    expect(text({ ...RECORD, circuits: [visaCircuit(W2, STEPS, [], JOURNAL, 'fr', name, false)] })).not.toContain('Commentaires');
  });

  it('says a migrated revision was approved in the legacy system, and that none is recorded otherwise', () => {
    const imported = text({ ...RECORD, imported: { at: '2026-10-10 10:00:00', legacyRef: 'LEG-0042', approved: true } });
    expect(imported).toContain('Approbation Dans l’ancien système');
    expect(imported).toContain('Révision reprise de l’ancien système (référence LEG-0042) le 10/10/2026 : son approbation a eu lieu dans l’ancien système. Codex n’en a repris ni les visas ni les dates.');
    expect(imported).not.toContain(t.visa_no_circuit);
    expect(text(RECORD)).toContain(t.visa_no_circuit);
  });

  it('gives the approval date of a draft migrated from the legacy system and approved in Codex, and says when it came', () => {
    const lines = text({ ...RECORD, imported: { at: '2026-10-02 08:00:00', legacyRef: 'LEG-0077', approved: false }, circuits: [visaCircuit(W2, STEPS, [], JOURNAL, 'fr', name, true)] });
    expect(lines).toEqual(expect.arrayContaining(['Approbation 09/10/2026', 'Reprise 02/10/2026, en brouillon, de l’ancien système (référence LEG-0077)', 'Approuvé le 09/10/2026 16:45']));
    expect(lines).not.toContain('Approbation Dans l’ancien système');
    expect(lines.join(' ')).not.toContain('son approbation a eu lieu dans l’ancien système');
  });

  it('is named {ID}_{letter}_VISA.pdf, and numbers its pages in the footer', () => {
    expect(visaFileName('PRO-QUA-0001', 'B')).toBe('PRO-QUA-0001_B_VISA.pdf');
    expect(visaFooter(t, 'PRO-QUA-0001', 'B')(2, 3)).toBe('PRO-QUA-0001 · Rév. B · Fiche de visa · Page 2/3');
  });
});
