import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEPARTMENTS, SITES } from '@/db/seed-org';
import { csv } from '@/lib/csv';
import { checkOrgCsv, ORG_COLUMNS, orgOk, orgReportLines } from '@/lib/org-review';

// Lot 10, step 2: check of an org chart given as CSV (O-04), npm run org:check. Nothing is written.

const HEADER = [...ORG_COLUMNS];
type Row = Partial<Record<(typeof ORG_COLUMNS)[number], string>>;
const file = (rows: Row[], header: string[] = HEADER) => csv([header, ...rows.map((r) => header.map((h) => r[h as keyof Row] ?? ''))]);

const VALID: Row[] = [
  { Nature: 'département', Code: 'DGE', 'Libellé FR': 'Direction générale', 'Libellé EN': 'Executive management', Société: 'EPC2I SAS', Responsable: 'adupont' },
  { Nature: 'département', Code: 'QAL', 'Libellé FR': 'Qualité', Société: 'EPC2I SAS' },
  { Nature: 'site', Code: 'lyon', 'Libellé FR': 'Lyon', Société: 'EPC2I SAS' },
  { Nature: 'personne', Code: 'adupont', Nom: 'A. Dupont', 'Libellé FR': 'Directeur', Département: 'DGE', Site: 'lyon', 'Rôle Codex': 'validateur' },
  { Nature: 'personne', Code: 'bmartin', Nom: 'B. Martin', Département: 'QAL', Société: 'EPC2I Services' },
];

describe('checkOrgCsv', () => {
  it('passes a valid org chart and reads its departments, sites, people and companies', () => {
    const r = checkOrgCsv(file(VALID));
    expect(orgOk(r)).toBe(true);
    expect(r.departments.map((d) => d.code)).toEqual(['DGE', 'QAL']);
    expect(r.departments[1].labelEn).toBe('Qualité');
    expect(r.sites.map((s) => s.key)).toEqual(['lyon']);
    expect(r.people.map((p) => p.id)).toEqual(['adupont', 'bmartin']);
    expect(r.companies).toEqual(['EPC2I SAS', 'EPC2I Services']);
    expect(orgReportLines(r, 'org.csv').join('\n')).toContain('Aucune erreur, aucun doublon, aucune collision.');
  });

  it('takes the company column as optional', () => {
    const r = checkOrgCsv(file(VALID, HEADER.filter((h) => h !== 'Société')));
    expect(orgOk(r)).toBe(true);
    expect(r.companies).toEqual([]);
  });

  it('reports a department code that is a type code (FIN, HSE, COM, JUR) or QMS as a collision', () => {
    const r = checkOrgCsv(file([...VALID, ...['FIN', 'HSE', 'COM', 'JUR', 'QMS'].map((Code) => ({ Nature: 'département', Code, 'Libellé FR': Code }))]));
    expect(r.collisions.map((c) => c.code)).toEqual(['FIN', 'HSE', 'COM', 'JUR', 'QMS']);
    expect(r.collisions[3].message).toContain('JUR-JUR-0001');
    expect(r.errors).toEqual([]);
    expect(orgOk(r)).toBe(false);
  });

  it('reports duplicates, unknown references and bad values', () => {
    const r = checkOrgCsv(file([
      ...VALID,
      { Nature: 'département', Code: 'QAL', 'Libellé FR': 'Qualité bis' },
      { Nature: 'personne', Code: 'bmartin', Nom: 'Homonyme', Département: 'QAL' },
      { Nature: 'département', Code: 'Ach', 'Libellé FR': 'Achats', Responsable: 'personne_absente' },
      { Nature: 'département', Code: 'RHU', 'Libellé FR': '' },
      { Nature: 'site', Code: 'Le Havre', 'Libellé FR': 'Le Havre' },
      { Nature: 'personne', Code: 'cdurand', Nom: '', Département: 'XXX', Site: 'paris', 'Rôle Codex': 'chef' },
      { Nature: 'personne', Code: 'd durand', Nom: 'D. Durand' },
      { Nature: 'service', Code: 'ZZZ', 'Libellé FR': 'Inconnu' },
    ]));
    expect(r.duplicates.map((d) => [d.code, d.message])).toEqual([['QAL', 'déjà donné ligne 3'], ['bmartin', 'déjà donné ligne 6']]);
    const errs = r.errors.map((e) => `${e.code}|${e.column}`);
    expect(errs).toEqual(expect.arrayContaining([
      'Ach|Code', 'Ach|Responsable', 'RHU|Libellé FR', 'Le Havre|Code',
      'cdurand|Nom', 'cdurand|Département', 'cdurand|Site', 'cdurand|Rôle Codex', 'd durand|Code', 'd durand|Département', 'ZZZ|Nature',
    ]));
    expect(r.errors.find((e) => e.code === 'Ach' && e.column === 'Responsable')!.message).toBe('personne « personne_absente » absent du fichier');
    expect(orgOk(r)).toBe(false);
  });

  it('refuses a file without the columns of the model, or without a department', () => {
    expect(checkOrgCsv('Nature;Code\nsite;lyon\n').errors[0].message).toContain('colonnes absentes');
    const r = checkOrgCsv(file([{ Nature: 'site', Code: 'lyon', 'Libellé FR': 'Lyon' }]));
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining('aucun département')]);
  });
});

describe('model docs/modeles/organigramme.csv', () => {
  const text = readFileSync(new URL('../../docs/modeles/organigramme.csv', import.meta.url), 'utf8');

  it('holds the provisional departments and sites of Codex, no person, and the columns of the check', () => {
    const r = checkOrgCsv(text);
    expect(r.departments.map((d) => [d.code, d.labelFr, d.labelEn])).toEqual(DEPARTMENTS);
    expect(r.sites.map((s) => [s.key, s.labelFr, s.labelEn])).toEqual(SITES);
    expect(r.people).toEqual([]);
    expect(text.split('\r\n')[0]).toBe(`﻿${ORG_COLUMNS.join(';')}`);
  });

  it('shows the four collisions of question 1 of the register and nothing else', () => {
    const r = checkOrgCsv(text);
    expect(r.collisions.map((c) => c.code).sort()).toEqual(['COM', 'FIN', 'HSE', 'JUR']);
    expect(r.errors).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });
});
