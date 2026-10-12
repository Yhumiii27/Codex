import { describe, expect, it } from 'vitest';
import { schema as s } from '@/db';
import { SIM_ROLES } from '@/lib/i18n';
import { fixClock, setupDb } from '../support/db';
import { compareAccess, PERSONS, variedDocuments } from '../support/varied';

// canRead and inDraftingCircle (lib/access.ts) as SQL conditions (readableSql, draftingCircleSql), which filter the
// lists, counts and pages of /recherche and /explorateur in the database: for every person and every simulated role,
// both select the same documents, on varied documents (confidentiality, department, project team, named readers,
// open revisions, running and finished circuits, changes accepted by Vigie). tests/integration/seed-sql.test.ts does
// the same on the demo seed.

const db = setupDb();
fixClock();

describe('readableSql and draftingCircleSql select what canRead and inDraftingCircle select', () => {
  it('on varied documents, for every person and every role', async () => {
    // A function scoped to the project (its holder joins the team), one scoped to a department (no team), a person
    // without department.
    await db().insert(s.functionHolders).values([
      { functionKey: 'chef_projet', scopeValue: 'HLT-026', userId: 'engineer' },
      { functionKey: 'resp_departement', scopeValue: 'ING', userId: 'writer2' },
    ]);
    await db().insert(s.users).values({ id: 'nodept', name: 'nodept', initials: 'ND', role: 'collaborateur', department: null });
    await variedDocuments(db(), 2026, 90);
    expect(await compareAccess(db())).toBe((PERSONS.length + 1) * SIM_ROLES.length);
  });

  it('on other draws', async () => {
    for (const seed of [7, 11]) {
      await variedDocuments(db(), seed, 40);
      await compareAccess(db());
      await db().delete(s.changeRequests);
      await db().delete(s.workflowSteps);
      await db().delete(s.workflows);
      await db().delete(s.documentReaders);
      await db().delete(s.workingVersions);
      await db().delete(s.revisions);
      await db().delete(s.documents);
    }
  });
});
