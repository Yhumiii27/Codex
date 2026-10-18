import { describe, expect, it, vi } from 'vitest';
import { schema as s } from '@/db';
import { getCtx } from '@/lib/context';
import { schedulerOverview } from '@/lib/scheduler';
import { setupDb } from '../support/db';
import type { Person } from '../support/fixtures';
import { actAs } from '../support/session';

// Revue du lot 9 : le panneau « Planificateur » d'Administration › Journal d'audit (src/app/administration/page.tsx,
// schedulerOverview(ctx)), ouvert à quiconque a l'accès Administration, affichait les chiffres de chaque exécution
// (fichiers vérifiés, altérés, absents, taille et nom de l'archive d'une sauvegarde ou d'un export). Le journal ne donne
// ces chiffres qu'aux gestionnaires documentaires : ils comptent les brouillons et les documents confidentiels (D-14,
// lib/queries.ts integrityL, backupL, archiveL).

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()), getDb: async () => (await import('../support/db')).currentDb() }));
vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
vi.mock('next/cache', () => ({ refresh: () => {} }));

const db = setupDb();

async function overviewAs(who: Person) {
  actAs(who);
  const ctx = await getCtx();
  expect(ctx.screens.admin).toBe(true);
  const view = await schedulerOverview(ctx, {}, db());
  return Object.fromEntries(view.tasks.map((x) => [x.task, { status: x.status, summary: x.summary }]));
}

describe('scheduler panel', () => {
  it('gives the figures of each run to records managers only; others see whether it went well, and why it was skipped', async () => {
    // An administrator who is not a records manager: the « Administrer » permission given to the auditors.
    await db().insert(s.rolePermissions).values({ role: 'auditeur', perm: 'admin', granted: true });
    const at = { startedAt: '2026-10-10 08:00:00+00', finishedAt: '2026-10-10 08:00:01+00' };
    await db().insert(s.schedulerRuns).values([
      { task: 'integrity', ...at, status: 'ok', summary: { checked: 4321, altered: 2, missing: 1 } },
      { task: 'backup', ...at, status: 'ok', summary: { archive: 'codex-backup-2026-10-10.zip', size: 987_654_321, rotatedOut: 0 } },
      { task: 'orphans', ...at, status: 'skipped', summary: { reason: 'busy' } },
    ]);
    expect(await overviewAs('manager')).toMatchObject({
      integrity: { status: 'ok', summary: { checked: 4321, altered: 2, missing: 1 } },
      backup: { status: 'ok', summary: { archive: 'codex-backup-2026-10-10.zip', size: 987_654_321 } },
      orphans: { status: 'skipped', summary: { reason: 'busy' } },
    });
    expect(await overviewAs('auditor')).toMatchObject({
      integrity: { status: 'ok', summary: {} },
      backup: { status: 'ok', summary: {} },
      orphans: { status: 'skipped', summary: { reason: 'busy' } },
    });
    const shown = JSON.stringify(await overviewAs('auditor'));
    expect(shown).not.toContain('4321');
    expect(shown).not.toContain('codex-backup');
    expect(shown).not.toContain('987654321');
  });
});
