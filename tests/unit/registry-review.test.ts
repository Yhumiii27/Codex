import { describe, expect, it } from 'vitest';
import { TYPES } from '@/db/registry';
import { FUNCTIONS } from '@/db/seed-org';
import { csv, parseCsv, unneutralise } from '@/lib/csv';
import {
  checkFunctionsWorkbook, checkTypesWorkbook, FUNCTION_COLUMNS, functionKeysOf, functionRows, parseHolders, reportLines,
  reviewFiles, TYPE_COLUMNS, typeFlags, typeRows, workbookKind, type TypeFlag,
} from '@/lib/registry-review';

// Lot 10, step 2: validation workbooks of the register (O-05 to O-08). The expected numbers were counted in
// src/db/registry.ts and src/db/seed-org.ts on 18 October 2026: if the register changes, they change with it.

const flagged = (flag: TypeFlag) => TYPES.filter((t) => typeFlags(t).some((f) => f.flag === flag)).map((t) => t.code);

/** A workbook as written, changed cell by cell (by code and column), then saved back as a spreadsheet would. */
function edit(text: string, changes: [code: string, column: string, value: string][], extra: string[][] = [], drop: string[] = []): string {
  const [header, ...rows] = parseCsv(text);
  for (const [code, column, value] of changes) {
    const row = rows.find((r) => r[0] === code);
    if (!row) throw new Error(`no row ${code}`);
    row[header.indexOf(column)] = value;
  }
  return csv([header, ...rows.filter((r) => !drop.includes(r[0])), ...extra]);
}

describe('csv read back (lib/csv.ts parseCsv)', () => {
  it('reads what csv() writes: BOM, semicolons, quotes, line breaks, neutralised formulas', () => {
    const rows = [['a;b', 'say "hi"', 'two\nlines', '=1+1', '-x', '']];
    const back = parseCsv(csv([['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], ...rows]));
    expect(back[1].map(unneutralise)).toEqual(rows[0]);
    expect(back[1][3]).toBe("'=1+1");
  });

  it('reads commas when the header has no semicolon, LF endings, and drops empty lines', () => {
    expect(parseCsv('a,b\n1,"2,5"\n\n,\n')).toEqual([['a', 'b'], ['1', '2,5']]);
  });
});

describe('types workbook', () => {
  const rows = typeRows();
  const col = (name: string) => TYPE_COLUMNS.indexOf(name as (typeof TYPE_COLUMNS)[number]);

  it('has one row per type of the register (69), in its order, with every column', () => {
    expect(TYPES).toHaveLength(69);
    expect(rows).toHaveLength(69);
    expect(rows.map((r) => r[0])).toEqual(TYPES.map((t) => t.code));
    for (const r of rows) expect(r).toHaveLength(TYPE_COLUMNS.length);
    const pol = rows[0];
    expect(pol[col('Famille')]).toBe('gouvernance_management');
    expect(pol[col('Circuit')]).toBe('resp_departement | resp_qualite | direction');
    expect(pol[col('Niveaux admis')]).toBe('public | restreint | interne | confidentiel');
    expect(pol[col('Durée (ans)')]).toBe('10');
  });

  it('leaves every answer empty: nothing is filled in for the user', () => {
    for (const r of rows) {
      expect(r[col('Validé (oui/non)')]).toBe('');
      expect(r[col('Correction')]).toBe('');
      expect(r[col('Nouveau code (renommage)')]).toBe('');
    }
    for (const r of functionRows()) expect(r.slice(-2)).toEqual(['', '']);
  });

  it('flags the 16 types without a duration (O-07): 14 « asset life », GOV and PUB permanent', () => {
    const noYears = flagged('no_years');
    expect(noYears).toHaveLength(16);
    expect(noYears.filter((c) => TYPES.find((t) => t.code === c)!.retention.trigger === 'asset_life')).toEqual(
      ['MNT', 'DTF', 'EXG', 'FDS', 'HMI', 'VAR', 'LDC', 'PID', 'PFD', 'SCH', 'GA', 'LST', 'BOM', 'MAN'],
    );
    expect(noYears.filter((c) => TYPES.find((t) => t.code === c)!.retention.trigger !== 'asset_life')).toEqual(['GOV', 'PUB']);
    expect(typeFlags(TYPES.find((t) => t.code === 'MNT')!)[0].text).toBe('O-07 : aucune durée (Durée de vie de l’actif)');
  });

  it('flags the 26 types kept until the end of the project (question 3 of the register)', () => {
    expect(flagged('project_end')).toHaveLength(26);
    expect(flagged('project_end')).toEqual(expect.arrayContaining(['DQF', 'CER', 'COC', 'HSE', 'PRT', 'SIM']));
  });

  it('flags the 5 types admitting « Public » (O-08), the 3 without circuit (O-06)', () => {
    expect(flagged('public')).toEqual(['POL', 'REG', 'DTF', 'PUB', 'COL']);
    expect(flagged('no_circuit')).toEqual(['LET', 'RFQ', 'PHO']);
  });

  it('flags the 4 type codes that are department codes too (question 1 of the register), JUR included', () => {
    expect(flagged('code_clash').sort()).toEqual(['COM', 'FIN', 'HSE', 'JUR']);
    const jur = rows.find((r) => r[0] === 'JUR')!;
    expect(jur[col('Question liée')]).toContain('JUR-JUR-0001');
  });

  it('writes both files as the other exports: BOM, semicolons, CRLF', () => {
    const files = reviewFiles();
    for (const body of Object.values(files)) {
      expect(body.startsWith('﻿')).toBe(true);
      expect(body).toContain('\r\n');
    }
    expect(files['types.csv'].split('\r\n')[0]).toBe(`﻿${TYPE_COLUMNS.join(';')}`);
    expect(workbookKind(files['types.csv'])).toBe('types');
    expect(workbookKind(files['fonctions.csv'])).toBe('functions');
    expect(workbookKind('a;b\n1;2')).toBeNull();
  });
});

describe('check of a types workbook', () => {
  const written = reviewFiles()['types.csv'];

  it('finds neither error nor difference in the workbook as written', () => {
    const r = checkTypesWorkbook(written);
    expect(r.rows).toBe(69);
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.added).toEqual([]);
    expect(r.answers).toEqual({ yes: [], no: [], blank: 69 });
  });

  it('reports answers and differences with the code, without deciding anything', () => {
    const r = checkTypesWorkbook(edit(written, [
      ['POL', 'Validé (oui/non)', 'Oui'],
      ['RSQ', 'Durée (ans)', '30'],
      ['RSQ', 'Validé (oui/non)', 'non'],
      ['RSQ', 'Correction', 'Incidents : 10 ans'],
      ['PRO', 'Validé (oui/non)', 'non'],
      ['MNT', 'Durée (ans)', '0'],
      ['POL', 'Niveaux admis', 'restreint, interne, confidentiel'],
      ['POL', 'Niveau par défaut', 'interne'],
      ['COC', 'Origines', 'externe | interne'],
      ['FIN', 'Nouveau code (renommage)', 'fia'],
    ], [], ['LET']));
    expect(r.errors).toEqual([]);
    expect(r.answers.yes).toEqual(['POL']);
    expect(r.answers.no).toEqual(['PRO', 'RSQ'].sort((a, b) => TYPES.findIndex((t) => t.code === a) - TYPES.findIndex((t) => t.code === b)));
    expect(r.changes).toEqual(expect.arrayContaining([
      { code: 'RSQ', column: 'Durée (ans)', before: '40', after: '30' },
      { code: 'MNT', column: 'Durée (ans)', before: '', after: '0' },
      { code: 'POL', column: 'Niveaux admis', before: 'public | restreint | interne | confidentiel', after: 'restreint | interne | confidentiel' },
      { code: 'COC', column: 'Origines', before: 'externe', after: 'interne | externe' },
    ]));
    expect(r.changes).toHaveLength(4);
    expect(r.renamed).toEqual([{ from: 'FIN', to: 'FIA' }]);
    expect(r.missing).toEqual(['LET']);
    // « non » with neither correction nor change is only noted.
    expect(r.notes.map((n) => n.code)).toEqual(['PRO']);
    const text = reportLines(r, 'types.csv').join('\n');
    expect(text).toContain('RSQ, Durée (ans) : 40 → 30');
    expect(text).toContain('FIN → FIA : renommage demandé');
    expect(text).toContain('LET : absent du cahier');
  });

  it('refuses values the rules of the register refuse, column by column', () => {
    const r = checkTypesWorkbook(edit(written, [
      ['POL', 'Durée (ans)', 'dix'],
      ['POL', 'Déclencheur', 'fin_de_programme'],
      ['PRO', 'Sort final', 'detruire'],
      ['PRO', 'Circuit', 'resp_qualite | resp_inconnu'],
      ['GOV', 'Niveau par défaut', 'public'],
      ['MIN', 'Famille', 'communication'],
      ['MIN', 'Origines', ''],
      ['FRM', 'Rattachements', 'none | project'],
      ['REG', 'Validé (oui/non)', 'peut-être'],
      ['REG', 'Livrable client', 'parfois'],
      ['FIN', 'Nouveau code (renommage)', 'QMS'],
      ['JUR', 'Nouveau code (renommage)', 'PRO'],
      ['COM', 'Nouveau code (renommage)', 'QUA'],
      ['HSE', 'Nouveau code (renommage)', 'H5E'],
    ], [
      // New rows: a code that is a department's, a duplicate, a good one.
      ['RDI', 'Recherche', '', 'pi_savoir_confidentiel', '', 'interne', 'research', '', '', '', '5', 'creation', 'review', '', '', 'interne', 'interne', 'non', '', '', '', '', '', ''],
      ['POL', 'Politique bis', '', 'gouvernance_management', '', 'interne', 'none', '', '', '', '5', 'creation', 'review', '', '', 'interne', 'interne', 'non', '', '', '', '', '', ''],
      ['CMQ', 'Communication', 'Communication', 'gouvernance_management', '', 'interne', 'none', '', '', '', '', 'creation', 'review', '', '', 'public | interne', 'public', 'non', '', '', '', '', '', ''],
    ]));
    const at = (code: string, column: string) => r.errors.filter((e) => e.code === code && e.column === column).map((e) => e.message);
    expect(at('POL', 'Durée (ans)')).toHaveLength(1);
    expect(at('POL', 'Déclencheur')[0]).toContain('fin_de_programme');
    expect(at('PRO', 'Sort final')).toHaveLength(1);
    expect(at('PRO', 'Circuit')).toEqual(['fonction « resp_inconnu » inconnue']);
    expect(at('GOV', 'Niveau par défaut')).toHaveLength(1);
    expect(at('MIN', 'Famille')[0]).toContain('communication');
    expect(at('MIN', 'Origines')).toHaveLength(1);
    expect(at('FRM', 'Rattachements')[0]).toContain('FRM');
    expect(at('REG', 'Validé (oui/non)')).toHaveLength(1);
    expect(at('REG', 'Livrable client')).toHaveLength(1);
    expect(at('FIN', 'Nouveau code (renommage)')[0]).toContain('QMS');
    expect(at('JUR', 'Nouveau code (renommage)')[0]).toContain('déjà pris');
    expect(at('COM', 'Nouveau code (renommage)')[0]).toContain('département');
    expect(at('HSE', 'Nouveau code (renommage)')[0]).toContain('2 ou 3 lettres');
    expect(at('RDI', 'Code')[0]).toContain('département');
    expect(at('POL', 'Code')).toEqual(['code en double dans le cahier']);
    expect(r.errors.filter((e) => e.code === 'CMQ')).toEqual([]);
    expect(r.added).toEqual(['RDI', 'CMQ']);
    // The codes FIN, HSE, COM and JUR the register already gives are kept as they are, not refused.
    expect(r.errors.filter((e) => e.column === 'Code' && ['FIN', 'HSE', 'COM', 'JUR'].includes(e.code))).toEqual([]);
  });

  it('accepts a function of a functions workbook checked alongside in the circuits', () => {
    const fns = edit(reviewFiles()['fonctions.csv'], [], [['resp_communication_ext', 'Responsable communication externe', '', 'global', '', '', '', '', '']]);
    const types = edit(written, [['PUB', 'Circuit', 'resp_communication_ext']]);
    expect(checkTypesWorkbook(types).errors).toHaveLength(1);
    expect(checkTypesWorkbook(types, { functions: functionKeysOf(fns) }).errors).toEqual([]);
  });

  it('refuses a file that is not a types workbook', () => {
    const r = checkTypesWorkbook('Code;Libellé FR\nPOL;Politique\n');
    expect(r.errors[0].message).toContain('colonnes absentes');
  });
});

describe('check of a functions workbook', () => {
  const written = reviewFiles()['fonctions.csv'];

  it('lists the 16 functions with their holders and finds nothing in the workbook as written', () => {
    expect(functionRows()).toHaveLength(FUNCTIONS.length);
    expect(FUNCTIONS).toHaveLength(16);
    const r = checkFunctionsWorkbook(written);
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([]);
    expect(r.answers.blank).toBe(16);
    const head = functionRows().find((x) => x[0] === 'resp_departement')!;
    expect(head[FUNCTION_COLUMNS.indexOf('Titulaires')]).toContain('JUR=irahmani (Inès Rahmani)');
  });

  it('reads holders with or without a scope value, names in brackets ignored', () => {
    expect(parseHolders('DIR=hcosta (Hélène Costa) | hcosta, gcomte')).toEqual([
      { scope: 'DIR', user: 'hcosta' }, { scope: null, user: 'hcosta' }, { scope: null, user: 'gcomte' },
    ]);
  });

  it('reports changed holders and refuses unknown people, scopes and values', () => {
    const r = checkFunctionsWorkbook(edit(written, [
      ['resp_qualite', 'Titulaires', 'gcomte'],
      ['resp_qualite', 'Validé (oui/non)', 'non'],
      ['chef_projet', 'Portée', 'global'],
      ['resp_hse', 'Titulaires', 'cbardet | inconnu'],
      ['resp_achats', 'Titulaires', 'QUA=fbertrand'],
      ['referent_ingenierie', 'Titulaires', 'XYZ-001=agirard'],
      ['resp_programme', 'Portée', 'site'],
    ], [['Mauvaise Clé', 'X', '', 'global', '', '', '', '', '']]));
    const at = (code: string, column: string) => r.errors.filter((e) => e.code === code && e.column === column);
    // The difference is shown for every row, a row with an error included.
    expect(r.changes).toContainEqual({ code: 'resp_qualite', column: 'Titulaires', before: 'gcomte | hsauvage', after: 'gcomte' });
    expect(r.changes.map((c) => c.code)).not.toContain('direction');
    expect(at('chef_projet', 'Portée')).toHaveLength(1);
    expect(at('resp_hse', 'Titulaires')[0].message).toContain('inconnu');
    expect(at('resp_achats', 'Titulaires')[0].message).toContain('portée global');
    expect(at('referent_ingenierie', 'Titulaires')[0].message).toContain('XYZ-001');
    expect(at('resp_programme', 'Portée')).toHaveLength(1);
    expect(at('mauvaise clé', 'Clé')).toHaveLength(1);
  });

  it('takes the people and departments of an org chart when given', () => {
    const r = checkFunctionsWorkbook(written, { people: ['hcosta'], departments: ['DIR'] });
    expect(r.errors.some((e) => e.message.includes('gcomte') && e.message.includes('organigramme'))).toBe(true);
    expect(r.errors.some((e) => e.message.includes('« COM »'))).toBe(true);
  });
});
