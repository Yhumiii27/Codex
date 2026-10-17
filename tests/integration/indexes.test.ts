import { describe, expect, it, vi } from 'vitest';
import { getCtx } from '@/lib/context';
import { getDoc } from '@/lib/queries';
import { addDoc, fixClock, setupDb } from '../support/db';
import { actAs } from '../support/session';

// Indexes of the targeted queries (point 39 of docs/reste-a-faire.md): the migration creates them, and a former ID
// resolves with `aliases @>` through documents_aliases instead of loading every document (lib/queries.ts getDoc).

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => (await import('../support/db')).currentDb(),
}));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();
fixClock();

const INDEXES = [
  'documents_aliases', 'working_versions_doc', 'working_versions_file_key', 'workflows_doc', 'workflows_revision', 'workflow_steps_assignee',
  'workflow_comments_workflow', 'change_requests_doc', 'change_requests_replacement', 'document_links_source', 'document_links_target',
  'document_readers_user', 'project_expected_project', 'project_expected_doc', 'audit_log_user', 'audit_log_action', 'audit_log_revision',
];

describe('indexes', () => {
  it('are created by the migration', async () => {
    const { rows } = await db().$client.query<{ name: string }>(`select indexname as name from pg_indexes where schemaname = 'public'`);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(INDEXES));
  });

  it('serve the lookup of a former ID', async () => {
    await db().$client.exec('set enable_seqscan = off');
    try {
      const { rows } = await db().$client.query<{ 'QUERY PLAN': string }>(`explain select * from documents where aliases @> '["PRO-QUA-0005"]'::jsonb`);
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('documents_aliases');
    } finally {
      await db().$client.exec('reset enable_seqscan');
    }
  });
});

describe('getDoc', () => {
  it('resolves a former ID to the document under its current one, and nothing else', async () => {
    await addDoc(db(), { id: 'PRO-ING-0001', department: 'ING', aliases: ['PRO-QUA-0005', 'LEG-42'] });
    await addDoc(db(), { id: 'PRO-QUA-0006' });
    actAs('owner');
    const ctx = await getCtx();
    for (const id of ['PRO-ING-0001', 'PRO-QUA-0005', 'LEG-42']) {
      const res = await getDoc(ctx, id);
      expect(res && res !== 'hidden' ? res.doc.id : res, id).toBe('PRO-ING-0001');
    }
    // Neither a part of an alias nor the array itself: only an element equal to the ID.
    for (const id of ['PRO-QUA-000', 'LEG', '["LEG-42"]', 'PRO-QUA-0007']) expect(await getDoc(ctx, id), id).toBeNull();
  });
});
