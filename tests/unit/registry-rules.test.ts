import { describe, expect, it } from 'vitest';
import {
  builtInScopeIssue, builtInTypeIssue, departmentCodeIssue, keyIssue, outsideType, parseFamilyForm, parseFunctionForm, parseProgramForm, parseSubtypes,
  parseTypeForm, programCodeIssue, subtypesJournal, SUBTYPE_ROWS_MAX, typeCodeIssue, type CodeSpace,
} from '@/lib/registry-rules';

// Rules of the register's administration (Administration › Registre des types, Fonctions & circuits): an ID reads
// TYPE-CONTEXTE-SEQ (D-09, D-10, docs/modele-cible.md §3), QMS is the context of templates, and a code names one thing
// only. Point 1 of docs/registre-points-ouverts.md (FIN-FIN-0001) is not settled (O-05): the codes already shared stay,
// no new one is given.

const space: CodeSpace = { types: ['PRO', 'FIN', 'GA'], departments: ['QUA', 'FIN', 'HSE'], projects: ['HLT-026'], programs: ['R2601', 'ABC'] };

describe('type codes', () => {
  it('are 2 or 3 capital letters', () => {
    for (const bad of ['', 'P', 'PROC', 'pro', 'P1O', 'PR-', 'É']) expect(typeCodeIssue(bad, space), bad).toBe('Type code: 2 or 3 capital letters.');
    expect(typeCodeIssue('NEW', space)).toBeNull();
    expect(typeCodeIssue('NW', space)).toBeNull();
  });

  it('name one thing in an ID: neither another type, nor a department, a programme or QMS', () => {
    expect(typeCodeIssue('PRO', space)).toBe('This code is already taken.');
    expect(typeCodeIssue('QUA', space)).toBe('This code already names a department: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(typeCodeIssue('ABC', space)).toBe('This code already names a research programme: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(typeCodeIssue('QMS', space)).toBe('QMS is the context of templates (FRM-QMS-001): it cannot be used as a code.');
  });

  it('let a type keep its own code, even one a department shares already (FIN, point 1 of the open questions)', () => {
    expect(typeCodeIssue('FIN', space, 'FIN')).toBeNull();
    expect(typeCodeIssue('PRO', space, 'PRO')).toBeNull();
    // Changing to it is a new code: refused.
    expect(typeCodeIssue('FIN', space, 'GA')).toBe('This code is already taken.');
  });
});

describe('programme codes', () => {
  it('start with a capital letter, then 2 to 9 capitals or digits, without a dash', () => {
    for (const bad of ['R1', 'r2601', '2601', 'R-2601', 'R26010000000']) expect(programCodeIssue(bad, space), bad).toBe('Programme code: a capital letter, then 2 to 9 capital letters or digits.');
    expect(programCodeIssue('R2701', space)).toBeNull();
  });

  it('are no other context of an ID, nor a type code', () => {
    expect(programCodeIssue('R2601', space)).toBe('This code is already taken.');
    expect(programCodeIssue('QUA', space)).toBe('This code already names a department: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(programCodeIssue('QMS', space)).toBe('QMS is the context of templates (FRM-QMS-001): it cannot be used as a code.');
    expect(programCodeIssue('PRO', space)).toBe('This code already names a document type: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(programCodeIssue('R2601', space, 'R2601')).toBeNull();
  });
});

describe('department codes', () => {
  it('are 3 letters that no type, programme or QMS has', () => {
    expect(departmentCodeIssue('QU', space)).toBe('Department code: 3 letters.');
    expect(departmentCodeIssue('QUA', space)).toBe('This code is already taken.');
    expect(departmentCodeIssue('PRO', space)).toBe('This code already names a document type: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(departmentCodeIssue('ABC', space)).toBe('This code already names a research programme: in an ID (TYPE-CONTEXT-SEQ), a code names one thing only.');
    expect(departmentCodeIssue('QMS', space)).toBe('QMS is the context of templates (FRM-QMS-001): it cannot be used as a code.');
    expect(departmentCodeIssue('LOG', space)).toBeNull();
  });
});

describe('keys of families and functions', () => {
  it('are lower-case words joined by _, unique', () => {
    for (const bad of ['', 'a', 'Qualite', 'qualité', '1qualite', 'qualite-qhse', 'q'.repeat(41)]) expect(keyIssue(bad, ['qualite']), bad).toBe('Key: a lower-case letter, then 1 to 39 lower-case letters, digits or _.');
    expect(keyIssue('qualite', ['qualite'])).toBe('This code is already taken.');
    expect(keyIssue('qualite', ['qualite'], 'qualite')).toBeNull();
    expect(keyIssue('resp_achats_2', ['qualite'])).toBeNull();
  });
});

describe('sub-types', () => {
  it('pair the French and English rows, drop empty ones, default the English label, keep a French label once', () => {
    expect(parseSubtypes(['Fiche', ' ', 'fiche', '', 'Plan'], ['Sheet', '', 'Sheet 2', 'Only EN', ''])).toEqual([
      { fr: 'Fiche', en: 'Sheet' }, { fr: 'Only EN', en: 'Only EN' }, { fr: 'Plan', en: 'Plan' },
    ]);
  });

  it('are refused beyond 40, or beyond 120 characters', () => {
    expect(parseSubtypes(Array.from({ length: 41 }, (_, i) => `S${i}`), [])).toBeNull();
    expect(parseSubtypes(['x'.repeat(121)], [''])).toBeNull();
    expect(parseSubtypes(['x'], ['y'.repeat(121)])).toBeNull();
  });

  it('are refused unread beyond twice that many rows, even rows repeating one label (a request must not hold the server)', () => {
    expect(SUBTYPE_ROWS_MAX).toBe(80);
    // Read, these would make one sub-type.
    expect(parseSubtypes(Array.from({ length: 10_000 }, () => 'Fiche'), [])).toBeNull();
    expect(parseSubtypes([], Array.from({ length: 81 }, () => ''))).toBeNull();
    const flood = Array.from({ length: 100_000 }, (_, i) => `Sous-type ${i}`);
    const start = performance.now();
    expect(parseSubtypes(flood, flood)).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
    // Forty rows and as many empty ones still pass.
    const forty = Array.from({ length: 40 }, (_, i) => `S${i}`);
    expect(parseSubtypes([...forty, ...Array.from({ length: 40 }, () => '')], [])).toHaveLength(40);
  });

  it('are journaled in both languages when they differ', () => {
    expect(subtypesJournal([{ fr: 'Fiche', en: 'Sheet' }, { fr: 'Plan', en: 'Plan' }])).toEqual(['Fiche / Sheet', 'Plan']);
  });
});

/** A complete type dialog; `over` replaces fields, a list sends a repeated field. */
function typeForm(over: Record<string, string | string[]> = {}) {
  const fields: Record<string, string | string[]> = {
    code: 'new', labelFr: ' Nouveau ', labelEn: '', family: 'qualite', origins: ['interne'], attachments: ['none', 'project'],
    subtypeFr: ['Fiche'], subtypeEn: ['Sheet'], circuit: ['resp_qualite', 'unknown', 'resp_qualite'], confAllowed: ['restreint', 'interne'], confDefault: 'interne',
    retentionYears: '10', retentionTrigger: 'superseded', retentionDisposition: 'destroy', retentionBasis: 'Usage', reviewMonths: '', iso: '', ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}
const refs = { families: ['qualite'], functions: ['resp_qualite'] };

describe('the type dialog', () => {
  it('reads every setting of a type', () => {
    expect(parseTypeForm(typeForm(), refs)).toEqual({
      ok: true,
      value: {
        code: 'NEW', labelFr: 'Nouveau', labelEn: 'Nouveau', family: 'qualite', origins: ['interne'], attachments: ['none', 'project'],
        subtypes: [{ fr: 'Fiche', en: 'Sheet' }], circuit: ['resp_qualite'], confAllowed: ['restreint', 'interne'], confDefault: 'interne',
        retentionYears: 10, retentionTrigger: 'superseded', retentionDisposition: 'destroy', retentionBasis: 'Usage', retentionBasisEn: '', reviewMonths: null, iso: null,
        clientDeliverable: false, active: true,
      },
    });
    const off = parseTypeForm(typeForm({ clientDeliverable: 'on', active: 'off', iso: '8.3', reviewMonths: '24', retentionYears: '' }), refs);
    expect(off).toMatchObject({ ok: true, value: { clientDeliverable: true, active: false, iso: '8.3', reviewMonths: 24, retentionYears: null } });
  });

  it('refuses what the register would not hold, naming the field', () => {
    expect(parseTypeForm(typeForm({ labelFr: '' }), refs)).toEqual({ ok: false, key: 'The label is required.', field: 'labelFr' });
    expect(parseTypeForm(typeForm({ labelEn: 'x'.repeat(161) }), refs)).toEqual({ ok: false, key: 'Text too long.', field: 'labelEn' });
    expect(parseTypeForm(typeForm({ family: 'autre' }), refs)).toEqual({ ok: false, key: 'Choose the family.', field: 'family' });
    expect(parseTypeForm(typeForm({ origins: [] }), refs)).toEqual({ ok: false, key: 'At least one origin allowed.', field: 'origins' });
    expect(parseTypeForm(typeForm({ attachments: ['ailleurs'] }), refs)).toEqual({ ok: false, key: 'At least one attachment allowed.', field: 'attachments' });
    expect(parseTypeForm(typeForm({ confDefault: 'public' }), refs)).toEqual({ ok: false, key: 'Confidentiality level not allowed for this type.', field: 'confDefault' });
    expect(parseTypeForm(typeForm({ confAllowed: [] }), refs)).toEqual({ ok: false, key: 'Confidentiality level not allowed for this type.', field: 'confDefault' });
    for (const y of ['-1', '201', '2.5', 'dix']) expect(parseTypeForm(typeForm({ retentionYears: y }), refs), y).toEqual({ ok: false, key: 'Retention period: a whole number of years, from 0 to 200, or empty.', field: 'retentionYears' });
    expect(parseTypeForm(typeForm({ reviewMonths: '0' }), refs)).toEqual({ ok: false, key: 'Invalid review periodicity: a whole number of months from 1 to 240, or nothing.', field: 'reviewMonths' });
    expect(parseTypeForm(typeForm({ retentionTrigger: 'never' }), refs)).toEqual({ ok: false, key: 'Something went wrong', field: undefined });
    expect(parseTypeForm(typeForm({ iso: 'x'.repeat(121) }), refs)).toEqual({ ok: false, key: 'Text too long.', field: 'iso' });
    expect(parseTypeForm(typeForm({ retentionBasis: 'x'.repeat(501) }), refs)).toEqual({ ok: false, key: 'Text too long.', field: 'retentionBasis' });
    // Its English wording (point 68), within the same bound.
    expect(parseTypeForm(typeForm({ retentionBasisEn: ' Practice ' }), refs)).toMatchObject({ ok: true, value: { retentionBasis: 'Usage', retentionBasisEn: 'Practice' } });
    expect(parseTypeForm(typeForm({ retentionBasisEn: 'x'.repeat(501) }), refs)).toEqual({ ok: false, key: 'Text too long.', field: 'retentionBasisEn' });
  });
});

describe('the family, function and programme dialogs', () => {
  const fd = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it('read their fields, with a deck group or a scope from the known ones', () => {
    expect(parseFamilyForm(fd({ key: 'Logistique', labelFr: 'Logistique', grp: 'DI' }))).toEqual({ ok: true, value: { key: 'logistique', labelFr: 'Logistique', labelEn: 'Logistique', grp: 'DI' } });
    expect(parseFamilyForm(fd({ key: 'x', labelFr: 'X', grp: 'DZ' }))).toMatchObject({ ok: false, key: 'Something went wrong' });
    expect(parseFunctionForm(fd({ key: 'resp_log', labelFr: 'Responsable logistique', labelEn: 'Logistics manager', scope: 'department' })))
      .toEqual({ ok: true, value: { key: 'resp_log', labelFr: 'Responsable logistique', labelEn: 'Logistics manager', scope: 'department' } });
    expect(parseFunctionForm(fd({ key: 'resp_log', labelFr: 'X', scope: 'site' }))).toMatchObject({ ok: false, key: 'Something went wrong' });
    expect(parseProgramForm(fd({ code: ' r2701 ', name: 'Programme', managerId: 'u', active: 'off' }))).toEqual({ ok: true, value: { code: 'R2701', name: 'Programme', managerId: 'u', active: false } });
    expect(parseProgramForm(fd({ code: 'R2701', name: ' ', managerId: 'u' }))).toEqual({ ok: false, key: 'The label is required.', field: 'name' });
  });
});

describe('settings the code of Codex relies on', () => {
  it('the type of templates admits no attachment but none: its ID takes the context QMS (D-10)', () => {
    expect(builtInTypeIssue('FRM', { attachments: ['none'] })).toBeNull();
    for (const attachments of [['none', 'project'], ['project'], ['none', 'research'], []] as const) {
      expect(builtInTypeIssue('FRM', { attachments: [...attachments] }), attachments.join()).toBe('The type of templates (FRM) stays without attachment: attached to a project or a programme, a template would take its context instead of QMS (D-10).');
    }
    expect(builtInTypeIssue('PRO', { attachments: ['none', 'project'] })).toBeNull();
  });

  it('the functions the rules name keep their scope: project for the project manager and client approval, department for its head', () => {
    expect(builtInScopeIssue('chef_projet', 'project')).toBeNull();
    for (const scope of ['global', 'department', 'research'] as const) {
      expect(builtInScopeIssue('chef_projet', scope)).toBe('The scope of this function does not change: the rules of Codex rely on it (the project manager when no holder is named, the heads of departments).');
      expect(builtInScopeIssue('validation_client', scope)).toBe('The scope of this function does not change: the rules of Codex rely on it (the project manager when no holder is named, the heads of departments).');
    }
    expect(builtInScopeIssue('resp_departement', 'department')).toBeNull();
    expect(builtInScopeIssue('resp_departement', 'global')).toBe('The scope of this function does not change: the rules of Codex rely on it (the project manager when no holder is named, the heads of departments).');
    expect(builtInScopeIssue('resp_qualite', 'research')).toBeNull();
    // A key that names a property of every object is no built-in function.
    expect(builtInScopeIssue('constructor', 'global')).toBeNull();
  });
});

describe('documents a type would no longer admit', () => {
  const type = { origins: ['interne' as const], attachments: ['none' as const], confAllowed: ['interne' as const] };
  it('are those whose origin, attachment or confidentiality it leaves out', () => {
    expect(outsideType({ origin: 'interne', attachment: 'none', conf: 'interne' }, type)).toBe(false);
    expect(outsideType({ origin: 'externe', attachment: 'none', conf: 'interne' }, type)).toBe(true);
    expect(outsideType({ origin: 'interne', attachment: 'project', conf: 'interne' }, type)).toBe(true);
    expect(outsideType({ origin: 'interne', attachment: 'none', conf: 'confidentiel' }, type)).toBe(true);
  });
});
