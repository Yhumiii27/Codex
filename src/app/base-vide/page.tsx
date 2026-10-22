import { redirect } from 'next/navigation';
import { databaseIsEmpty } from '@/lib/empty-database';

// Where every page leads while the database is empty (lib/context.ts getCtx, EMPTY_DATABASE_PATH). The root layout then
// renders EmptyDatabase in place of the shell and of this page; once the database is filled, back to the home.

export const dynamic = 'force-dynamic';

export default async function EmptyDatabasePage() {
  if (!(await databaseIsEmpty())) redirect('/');
  return null;
}
