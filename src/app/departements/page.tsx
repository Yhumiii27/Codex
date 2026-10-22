import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/ui/Forbidden';
import { getCtx } from '@/lib/context';
import { defaultDepartment } from '@/lib/departments';
import { screenTitle } from '@/lib/titles';

/** /departements opens the page of the user's department (the first one for someone without a department). */
export function generateMetadata() {
  return screenTitle('nav_departments');
}

export default async function DepartmentsPage() {
  const ctx = await getCtx();
  const code = defaultDepartment(ctx.user.department, ctx.departments);
  if (!code) return <Forbidden text={ctx.t.dept_unknown} back={ctx.t.back_home} />;
  redirect(`/departements/${encodeURIComponent(code)}`);
}
