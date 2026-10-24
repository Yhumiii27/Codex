import { describe, expect, it, vi } from 'vitest';
import { addDoc, addWorkflow, fixClock, setupDb } from '../support/db';

// Shared data of the EPC2I suite (decision M-01; Matrix, infra/postgres/partage/40-codex.sql, migration 0001_partage):
// Codex publishes views pub_ in its schema, read by Keystone, Vigie, Matrix and Crucible (pub_programmes_recherche,
// migration 0002, Crucible's request CX-2). Their contract: a column is never
// removed nor renamed (a new view _v2 instead), only added at the end; « très confidentiel » documents are never
// published. The columns below are those of 40-codex.sql, in its order; pub_journal.quand is an instant (timestamptz),
// as the four tools' pub_journal must be for matrix.journal_unifie.

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));

const db = setupDb();
fixClock();

const CONTRACT: Record<string, string[]> = {
  pub_documents: ['id', 'aliases', 'title', 'origin', 'attachment', 'project_code', 'program_code', 'family', 'type_code', 'subtype', 'department', 'site',
    'owner_id', 'owner_name', 'author_id', 'author_name', 'conf', 'keywords', 'lang', 'state', 'status', 'rev_in_force', 'rev_working', 'issued_at',
    'review_due_at', 'expires_at', 'discipline', 'project_phase', 'work_package', 'source_org', 'external_ref', 'legal_hold', 'obsolete_at', 'archived_at',
    'created_at', 'modified_at', 'distribution', 'review_months', 'process_code', 'owner_matricule'],
  pub_revisions_document: ['revision_id', 'doc_id', 'letter', 'status', 'created_at', 'effective_at', 'approved_at', 'in_force_at', 'superseded_at',
    'modifier_id', 'change_ref', 'working_versions', 'last_version_id', 'last_version_n', 'last_version_date', 'last_version_author_id',
    'last_version_author_name', 'last_version_comment', 'file_name', 'mime', 'size'],
  pub_validations: ['workflow_id', 'doc_id', 'revision', 'requester_id', 'due', 'current_step', 'outcome', 'created_at', 'idx', 'function_key', 'step_label',
    'assignee_id', 'assignee_name', 'done_on', 'assignee_matricule'],
  pub_types_document: ['code', 'label_fr', 'label_en', 'family', 'family_label_fr', 'family_label_en', 'family_group', 'family_sort', 'origins', 'attachments',
    'subtypes', 'circuit', 'retention_years', 'retention_trigger', 'retention_disposition', 'retention_basis', 'conf_allowed', 'conf_default', 'iso',
    'client_deliverable', 'active', 'source', 'sort'],
  pub_circuits_type: ['type_code', 'position', 'function_key', 'label_fr', 'label_en', 'scope'],
  pub_titulaires_fonction: ['id', 'function_key', 'label_fr', 'label_en', 'scope', 'scope_value', 'user_id', 'user_name', 'user_matricule'],
  pub_journal: ['ref_source', 'nature', 'quand', 'qui', 'qui_ref', 'qui_role', 'action', 'objet', 'detail', 'projet', 'qui_matricule'],
  pub_programmes_recherche: ['code', 'libelle', 'responsable_matricule', 'actif'],
};

const q = async <T,>(text: string, params?: unknown[]) => (await db().$client.query<T>(text, params)).rows;

describe('views pub_ of the shared data (0001_partage, 0002_pub_programmes_recherche)', () => {
  it('are the views of the contract, in the schema codex, with their columns in order', async () => {
    const views = await q<{ name: string }>(`select table_name as name from information_schema.views where table_schema = 'codex' order by 1`);
    expect(views.map((v) => v.name)).toEqual(Object.keys(CONTRACT).sort());
    for (const [view, columns] of Object.entries(CONTRACT)) {
      const cols = await q<{ name: string }>(`select column_name as name from information_schema.columns where table_schema = 'codex' and table_name = $1 order by ordinal_position`, [view]);
      expect(cols.map((c) => c.name), view).toEqual(columns);
    }
  });

  it('are security barriers, and publish the journal with an instant', async () => {
    const opts = await q<{ name: string; options: string[] | null }>(`select c.relname as name, c.reloptions as options from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'codex' and c.relkind = 'v' order by 1`);
    for (const o of opts) expect(o.options, o.name).toEqual(['security_barrier=true']);
    expect(await q(`select data_type from information_schema.columns where table_schema = 'codex' and table_name = 'pub_journal' and column_name = 'quand'`)).toEqual([{ data_type: 'timestamp with time zone' }]);
  });

  it('leave the « très confidentiel » documents out, and read Codex as it is', async () => {
    await addDoc(db(), { id: 'PRO-QUA-0001' });
    await addDoc(db(), { id: 'PRO-QUA-0002', conf: 'tres_confidentiel' });
    await addWorkflow(db(), { id: 'W-1', docId: 'PRO-QUA-0001', letter: 'A', requesterId: 'owner', author: 'owner', approvers: ['quality'] });
    await db().$client.exec(`insert into audit_log (at, user_id, action, doc_id, detail) values (now(), 'owner', 'view', 'PRO-QUA-0001', '')`);
    expect((await q<{ id: string }>(`select id from codex.pub_documents order by id`)).map((r) => r.id)).toEqual(['PRO-QUA-0001']);
    expect((await q<{ doc_id: string }>(`select distinct doc_id from codex.pub_revisions_document`)).map((r) => r.doc_id)).toEqual(['PRO-QUA-0001']);
    expect(await q(`select count(*)::int as n from codex.pub_types_document`)).toEqual(await q(`select count(*)::int as n from codex.doc_types`));
    expect((await q<{ type_code: string; position: number }>(`select type_code, position from codex.pub_circuits_type where type_code = 'PRO' order by position`)).map((r) => r.position)).toEqual([1, 2]);
    const [entry] = await q<{ quand: string; objet: string; qui_ref: string }>(`select quand::text, objet, qui_ref from codex.pub_journal where action = 'view'`);
    expect(entry).toMatchObject({ objet: 'PRO-QUA-0001', qui_ref: 'owner' });
    expect((await q<{ function_key: string }>(`select function_key from codex.pub_titulaires_fonction where function_key = 'resp_qualite'`)).length).toBeGreaterThan(0);
    expect(await q(`select workflow_id, idx, assignee_id from codex.pub_validations order by idx`)).toEqual([
      { workflow_id: 'W-1', idx: 0, assignee_id: 'owner' }, { workflow_id: 'W-1', idx: 1, assignee_id: 'quality' },
    ]);
  });

  it('carry the prerequisites of the shared data, with their rules', async () => {
    await expect(db().$client.exec(`update users set matricule = 'EMP-12' where id = 'owner'`)).rejects.toThrow(/users_matricule_check/);
    await db().$client.exec(`update users set matricule = 'EMP-0012' where id = 'owner'`);
    await expect(db().$client.exec(`update users set matricule = 'EMP-0013' where id = 'codex'`)).rejects.toThrow(/users_matricule_check/);
    await addDoc(db(), { id: 'PRO-QUA-0003' });
    await expect(db().$client.exec(`update documents set review_months = 0 where id = 'PRO-QUA-0003'`)).rejects.toThrow(/documents_review_months_check/);
    expect(await q(`select distribution, review_months, process_code from documents where id = 'PRO-QUA-0003'`)).toEqual([{ distribution: '', review_months: null, process_code: null }]);
    expect(await q(`select owner_matricule from codex.pub_documents where id = 'PRO-QUA-0003'`)).toEqual([{ owner_matricule: 'EMP-0012' }]);
  });

  it('publish the research programmes with the matricule of their manager, closed ones included (actif)', async () => {
    await db().$client.exec(`update users set matricule = 'EMP-0042' where id = 'researcher'`);
    await db().$client.exec(`insert into research_programs (code, name, manager_id, active) values ('R2502', 'Programme clos', 'owner', false)`);
    expect(await q(`select code, libelle, responsable_matricule, actif from codex.pub_programmes_recherche order by code`)).toEqual([
      { code: 'R2502', libelle: 'Programme clos', responsable_matricule: null, actif: false },
      { code: 'R2601', libelle: 'Capteurs', responsable_matricule: 'EMP-0042', actif: true },
    ]);
    expect(await q(`select obj_description('codex.pub_programmes_recherche'::regclass) as c`)).toEqual([{ c: expect.stringContaining('crucible_app') }]);
  });
});
