import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { contextOf, formatId, idMatches, isFinalStatus, lettersUpTo, nextLetter, revLabel, seqWidth, TEMPLATE_CONTEXT, TEMPLATE_TYPE, type IdInput } from '@/lib/codes';

// Identifiers TYPE-CONTEXTE-SEQ (D-09, D-10, docs/modele-cible.md §3) and revision letters (D-11, D-12, §4).

const project: IdInput = { typeCode: 'PID', attachment: 'project', projectCode: 'HLT-026', department: 'ING' };
const research: IdInput = { typeCode: 'PRT', attachment: 'research', programCode: 'R2601', department: 'RDI' };
const template: IdInput = { typeCode: 'FRM', attachment: 'none', department: 'QUA' };
const department: IdInput = { typeCode: 'PRO', attachment: 'none', department: 'QUA' };

describe('contextOf', () => {
  it('uses the full Keystone project code for a project document (D-09)', () => {
    expect(contextOf(project)).toBe('HLT-026');
  });

  it('uses the research programme code for a research document (D-10)', () => {
    expect(contextOf(research)).toBe('R2601');
  });

  it('uses QMS for templates, whatever their department (D-10)', () => {
    expect(TEMPLATE_TYPE).toBe('FRM');
    expect(TEMPLATE_CONTEXT).toBe('QMS');
    expect(contextOf(template)).toBe('QMS');
    expect(contextOf({ ...template, department: 'HSE' })).toBe('QMS');
  });

  it('uses the owning department for any other document without attachment (D-10, O-09)', () => {
    expect(contextOf(department)).toBe('QUA');
    expect(contextOf({ ...department, department: 'HSE' })).toBe('HSE');
  });

  it('ignores the department of an attached document', () => {
    expect(contextOf({ ...project, department: 'FIN' })).toBe('HLT-026');
    expect(contextOf({ ...research, department: 'FIN' })).toBe('R2601');
  });
});

describe('seqWidth', () => {
  it('counts on 3 digits within a project, a programme or the template space, on 4 within a department', () => {
    expect(seqWidth(project)).toBe(3);
    expect(seqWidth(research)).toBe(3);
    expect(seqWidth(template)).toBe(3);
    expect(seqWidth(department)).toBe(4);
  });

  it('gives 4 digits exactly when the context is the department', () => {
    const cases: IdInput[] = [
      project, research, template, department,
      { ...project, projectCode: null }, { ...research, programCode: null },
      { ...department, attachment: 'project', projectCode: null }, { ...template, attachment: 'research', programCode: null },
    ];
    for (const d of cases) expect(seqWidth(d), JSON.stringify(d)).toBe(contextOf(d) === d.department ? 4 : 3);
  });
});

describe('formatId', () => {
  it('writes the examples of the decisions and of the target model', () => {
    expect(formatId(project, 1)).toBe('PID-HLT-026-001');
    expect(formatId(research, 4)).toBe('PRT-R2601-004');
    expect(formatId(template, 12)).toBe('FRM-QMS-012');
    expect(formatId(department, 3)).toBe('PRO-QUA-0003');
    expect(formatId({ ...department, department: 'HSE' }, 3)).toBe('PRO-HSE-0003');
  });

  it('never truncates a number wider than the sequence', () => {
    expect(formatId(project, 1000)).toBe('PID-HLT-026-1000');
    expect(formatId(department, 12345)).toBe('PRO-QUA-12345');
  });
});

describe('idMatches', () => {
  it('accepts an ID built for the same type and context', () => {
    expect(idMatches('PRO-QUA-0003', department)).toBe(true);
    expect(idMatches('PID-HLT-026-001', project)).toBe(true);
    expect(idMatches('PRT-R2601-004', research)).toBe(true);
    expect(idMatches('FRM-QMS-012', template)).toBe(true);
  });

  it('rejects the ID once the type or the context changed (reclassification, D-10)', () => {
    expect(idMatches('PRO-QUA-0003', { ...department, department: 'HSE' })).toBe(false);
    expect(idMatches('PRO-QUA-0003', { ...department, typeCode: 'INS' })).toBe(false);
    expect(idMatches('PRO-QUA-0003', { ...department, attachment: 'project', projectCode: 'HLT-026' })).toBe(false);
    expect(idMatches('PID-HLT-026-001', { ...project, projectCode: 'NDC-031' })).toBe(false);
    expect(idMatches('PID-HLT-026-001', { ...project, attachment: 'none' })).toBe(false);
    expect(idMatches('PRT-R2601-004', { ...research, programCode: 'R2602' })).toBe(false);
  });

  it('does not take a code for the prefix of a longer one', () => {
    expect(idMatches('PID-HLT-026-001', { ...project, projectCode: 'HLT-02' })).toBe(false);
    expect(idMatches('PRO-QUA-0003', { ...department, typeCode: 'PR' })).toBe(false);
  });

  // Known gap, reported with this test: a department code equal to the client part of a project code (a client "FIN"
  // and the FIN department) makes a project ID look like a department ID, so a project document moved to that
  // department before its first approval would keep its project ID instead of being re-codified (D-10). The current
  // reference data has no such overlap (O-04). When idMatches is fixed, this test fails: drop `.fails`.
  it.fails('rejects a project ID for a department that shares the client code', () => {
    expect(idMatches('PRO-FIN-012-001', { typeCode: 'PRO', attachment: 'none', department: 'FIN' })).toBe(false);
  });
});

describe('nextLetter', () => {
  it('starts at A', () => {
    expect(nextLetter(null)).toBe('A');
    expect(nextLetter(undefined)).toBe('A');
    expect(nextLetter('')).toBe('A');
  });

  it('counts in letters only, with a carry after Z (D-11)', () => {
    expect(nextLetter('A')).toBe('B');
    expect(nextLetter('Y')).toBe('Z');
    expect(nextLetter('Z')).toBe('AA');
    expect(nextLetter('AA')).toBe('AB');
    expect(nextLetter('AZ')).toBe('BA');
    expect(nextLetter('BZ')).toBe('CA');
    expect(nextLetter('ZZ')).toBe('AAA');
  });
});

describe('lettersUpTo', () => {
  it('lists the letters from A up to and including the last one', () => {
    expect(lettersUpTo('A')).toEqual(['A']);
    expect(lettersUpTo('C')).toEqual(['A', 'B', 'C']);
    const toAB = lettersUpTo('AB');
    expect(toAB).toHaveLength(28);
    expect(toAB.slice(24)).toEqual(['Y', 'Z', 'AA', 'AB']);
  });

  it('stops on a value that is not a revision letter instead of looping', () => {
    // An endless synchronous loop would hang the suite, which Vitest's timeout cannot interrupt: the call runs under
    // the time limit of node:vm, which throws instead.
    const out = runInNewContext('lettersUpTo("a")', { lettersUpTo }, { timeout: 1000 }) as string[];
    expect(out.length).toBeLessThanOrEqual(201);
  });
});

describe('isFinalStatus and revLabel', () => {
  it('treats approved, in force and superseded revisions as final', () => {
    for (const s of ['approved', 'in_force', 'superseded']) expect(isFinalStatus(s), s).toBe(true);
    for (const s of ['draft', 'in_review', 'cancelled']) expect(isFinalStatus(s), s).toBe(false);
  });

  it('labels a revision being drafted or reviewed with its working version (D-12)', () => {
    expect(revLabel('A', 'draft', 1)).toBe('A.1');
    expect(revLabel('B', 'draft', 2)).toBe('B.2');
    expect(revLabel('B', 'in_review', 3)).toBe('B.3');
    expect(revLabel('C', 'cancelled', 1)).toBe('C.1');
  });

  it('labels a final revision with its letter alone, without minor index (D-11)', () => {
    expect(revLabel('A', 'approved', 3)).toBe('A');
    expect(revLabel('B', 'in_force', 2)).toBe('B');
    expect(revLabel('A', 'superseded', 5)).toBe('A');
    expect(revLabel('AA', 'in_force')).toBe('AA');
  });
});
