import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema as s } from '@/db';
import type { Ctx } from '@/lib/context';
import { DICT } from '@/lib/i18n';
import { auditDetailL } from '@/lib/queries';
import { setupDb } from '../support/db';

// codex.pub_editer (Matrix's request M-19, migration 0004; decision D-30): the IT administrator corrects Codex's data
// from Matrix's viewer, through Codex's own rules and journal, never by writing in its tables. Four tables are open
// (departments, sites, research programmes, function holders), with the rules of Administration; any other is refused.

const db = setupDb();
type Edit = [table: string, action: string, key: unknown, values: unknown, by?: string, reason?: string];

async function edit(...[table, action, key, values, by = 'Jeanne Martin (DSI)', reason = 'correction demandée']: Edit) {
  const { rows } = await db().$client.query<{ r: Record<string, unknown> }>(
    'select codex.pub_editer($1, $2, $3::jsonb, $4::jsonb, $5, $6) as r',
    [table, action, key == null ? null : JSON.stringify(key), values == null ? null : JSON.stringify(values), by, reason],
  );
  return rows[0].r;
}
/** The message the function raises, as Matrix shows it. */
async function refusal(...args: Edit): Promise<string> {
  try {
    await edit(...args);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('not refused');
}
const journal = () => db().select().from(s.auditLog).where(eq(s.auditLog.userId, 'matrix')).orderBy(asc(s.auditLog.id));

describe('codex.pub_editer: departments', () => {
  it('adds one with a free code, corrects its labels, makes it inactive on « retirer », journaled under matrix', async () => {
    expect(await edit('departments', 'ajouter', null, { code: 'lab', label_fr: 'Laboratoire', label_en: 'Laboratory' })).toMatchObject({ code: 'LAB', label_fr: 'Laboratoire', active: true });
    expect(await edit('departments', 'corriger', { code: 'LAB' }, { label_fr: 'Laboratoire central' })).toMatchObject({ code: 'LAB', label_fr: 'Laboratoire central', label_en: 'Laboratory' });
    expect(await edit('departments', 'retirer', { code: 'LAB' }, null)).toMatchObject({ code: 'LAB', active: false });
    // Kept, never removed: documents may carry it.
    expect(await db().select().from(s.departments).where(eq(s.departments.code, 'LAB'))).toHaveLength(1);
    const entries = await journal();
    expect(entries.map((e) => [e.action, e.targetKind, e.targetId])).toEqual([['org_add', 'department', 'LAB'], ['org_edit', 'department', 'LAB'], ['org_edit', 'department', 'LAB']]);
    expect(entries[1].data).toEqual({
      changes: [{ field: 'labelFr', before: 'Laboratoire', after: 'Laboratoire central' }],
      via: { app: 'matrix', person: 'Jeanne Martin (DSI)', reason: 'correction demandée' },
    });
    const ctx = { t: DICT.fr, lang: 'fr', seesAll: true, label: (_: string, k: string) => k, userName: (x: string) => x } as unknown as Ctx;
    expect(auditDetailL(ctx, entries[1])).toContain('depuis Matrix, par Jeanne Martin (DSI) — motif : correction demandée');
    expect((await db().select().from(s.users).where(eq(s.users.id, 'matrix')))[0]).toMatchObject({ name: 'Matrix', isSystem: true });
  });

  it('keeps the rules of Codex: a code taken or malformed, a code changed, the last active department', async () => {
    expect(await refusal('departments', 'ajouter', null, { code: 'QUA', label_fr: 'X' })).toMatch(/déjà pris/);
    expect(await refusal('departments', 'ajouter', null, { code: 'PID', label_fr: 'X' })).toMatch(/déjà pris/);
    expect(await refusal('departments', 'ajouter', null, { code: 'AB', label_fr: 'X' })).toMatch(/3 lettres/);
    expect(await refusal('departments', 'ajouter', null, { code: 'ABC', label_fr: ' ' })).toMatch(/libellé obligatoire/);
    expect(await refusal('departments', 'corriger', { code: 'QUA' }, { code: 'QUX' })).toMatch(/ne change jamais/);
    expect(await refusal('departments', 'corriger', { code: 'ZZZ' }, { label_fr: 'X' })).toMatch(/introuvable/);
    await db().update(s.departments).set({ active: false });
    await db().update(s.departments).set({ active: true }).where(eq(s.departments.code, 'QUA'));
    expect(await refusal('departments', 'retirer', { code: 'QUA' }, null)).toMatch(/un département actif au moins/);
    expect(await journal()).toEqual([]);
  });
});

describe('codex.pub_editer: sites, programmes, holders', () => {
  it('adds, corrects and retires a site', async () => {
    expect(await edit('sites', 'ajouter', null, { key: 'lyon', label_fr: 'Lyon' })).toMatchObject({ key: 'lyon', label_en: 'Lyon', active: true });
    expect(await edit('sites', 'corriger', { key: 'lyon' }, { label_en: 'Lyon (FR)' })).toMatchObject({ label_en: 'Lyon (FR)' });
    expect(await edit('sites', 'retirer', { key: 'lyon' }, null)).toMatchObject({ active: false });
    expect(await refusal('sites', 'ajouter', null, { key: 'Lyon 2', label_fr: 'X' })).toMatch(/clé de site/);
  });

  it('adds a programme with a known manager, closes it on « retirer »', async () => {
    expect(await edit('research_programs', 'ajouter', null, { code: 'r2603', name: 'Robotique', manager_id: 'researcher' })).toMatchObject({ code: 'R2603', active: true });
    expect(await edit('research_programs', 'retirer', { code: 'R2603' }, null)).toMatchObject({ active: false });
    expect(await refusal('research_programs', 'ajouter', null, { code: 'R2604', name: 'X', manager_id: 'nobody' })).toMatch(/responsable nobody inconnu/);
    expect(await refusal('research_programs', 'ajouter', null, { code: 'HSE', name: 'X', manager_id: 'researcher' })).toMatch(/déjà pris/);
    expect((await journal()).map((e) => e.action)).toEqual(['program_add', 'program']);
  });

  it('names a holder who may approve, for an admitted scope value, and removes one; never « corriger »', async () => {
    const added = await edit('function_holders', 'ajouter', null, { function_key: 'resp_departement', scope_value: 'ING', user_id: 'engineer' });
    expect(added).toMatchObject({ function_key: 'resp_departement', scope_value: 'ING', user_id: 'engineer' });
    expect(await refusal('function_holders', 'ajouter', null, { function_key: 'resp_departement', scope_value: 'ING', user_id: 'owner' })).toMatch(/ne peut pas être titulaire/);
    expect(await refusal('function_holders', 'ajouter', null, { function_key: 'resp_departement', scope_value: 'XYZ', user_id: 'engineer' })).toMatch(/portée XYZ non admise/);
    expect(await refusal('function_holders', 'corriger', { id: added.id }, { user_id: 'head' })).toMatch(/retirez-le puis ajoutez/);
    expect(await edit('function_holders', 'retirer', { id: added.id }, null)).toMatchObject({ user_id: 'engineer' });
    expect(await db().select().from(s.functionHolders).where(eq(s.functionHolders.id, added.id as number))).toEqual([]);
    expect((await journal()).map((e) => [e.action, e.targetId, e.data?.changes])).toEqual([
      ['holder_add', 'resp_departement', [{ field: 'holder', scope: 'ING', before: null, after: 'engineer' }]],
      ['holder_remove', 'resp_departement', [{ field: 'holder', scope: 'ING', before: 'engineer', after: null }]],
    ]);
  });
});

describe('codex.pub_editer: what it refuses', () => {
  it('any other table, an unknown column, an unknown action, a missing person or reason', async () => {
    for (const table of ['documents', 'revisions', 'workflows', 'audit_log', 'users', 'doc_types']) {
      expect(await refusal(table, 'corriger', { id: 'x' }, { title: 'x' }), table).toMatch(/ne se modifie pas depuis Matrix/);
    }
    expect(await refusal('departments', 'corriger', { code: 'QUA' }, { sort: 3 })).toMatch(/colonne « sort » non modifiable/);
    expect(await refusal('departments', 'effacer', { code: 'QUA' }, null)).toMatch(/action inconnue/);
    expect(await refusal('departments', 'corriger', { code: 'QUA' }, { label_fr: 'X' }, '', 'm')).toMatch(/personne qui modifie/);
    expect(await refusal('departments', 'corriger', { code: 'QUA' }, { label_fr: 'X' }, 'p', ' ')).toMatch(/motif est obligatoire/);
    expect(await journal()).toEqual([]);
  });

  it('is SECURITY DEFINER, with its search_path set, and not executable by everyone', async () => {
    const { rows } = await db().$client.query<{ definer: boolean; config: string[] | null; open: boolean }>(`
      select p.prosecdef as definer, p.proconfig as config,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as open
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'codex' and p.proname = 'pub_editer'`);
    expect(rows).toEqual([{ definer: true, config: ['search_path=codex, pg_temp'], open: false }]);
  });
});
