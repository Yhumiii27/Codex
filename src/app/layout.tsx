import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './nocturne.css';
import './globals.css';
import { AppProvider } from '@/components/shell/AppProvider';
import { Header } from '@/components/shell/Header';
import { Sidebar } from '@/components/shell/Sidebar';
import type { DialogData } from '@/components/dialogs/types';
import { getCtx } from '@/lib/context';
import { fileRules } from '@/lib/filetypes';
import { CONF_LEVELS, MATRIX_ROLE, type SimRole, type TKey } from '@/lib/i18n';
import { keystoneUrl } from '@/lib/keystone';
import { getMatrix, listTemplates, myTodo, recentActivity, typeView } from '@/lib/queries';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Codex — GED Groupe',
  description: 'Gestion électronique des documents du groupe',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const ctx = await getCtx();
  const fr = ctx.lang === 'fr';
  // What waits for me (approval steps, revisions to draft, grafts, review and expiry dates): the badge and the bell list
  // the same items as the home's « À traiter », each linking to where to act (myTodo, AppProvider).
  // Only what the shell shows is read (lib/queries.ts): the documents and workflows « À traiter » may come from, the
  // templates, the five latest entries of the 60 latest about documents the user may see (each under its current ID).
  const [todo, templates, recent, matrix] = await Promise.all([myTodo(ctx), listTemplates(ctx), recentActivity(ctx, 5, 60), getMatrix()]);
  const data: DialogData = {
    templates: templates.map((x) => ({ id: x.id, label: x.label, rev: x.rev, owner: x.owner, types: x.types })),
    types: ctx.types.map((x) => {
      const v = typeView(ctx, x);
      return {
        code: v.code, label: v.label, family: v.family, familyLabel: v.familyLabel, origins: v.origins, attachments: v.attachments,
        subtypes: v.subtypesL, confAllowed: v.confAllowed, confDefault: v.confDefault, circuitL: v.circuitL, active: v.active, reviewMonths: v.reviewMonths,
      };
    }),
    families: ctx.families.map((x) => ({ key: x.key, label: fr ? x.labelFr : x.labelEn })),
    departments: ctx.departments.map((x) => ({ key: x.code, label: fr ? x.labelFr : x.labelEn, active: x.active })),
    sites: ctx.sites.map((x) => ({ key: x.key, label: fr ? x.labelFr : x.labelEn, active: x.active })),
    projects: ctx.projects.map((x) => ({ key: x.code, label: x.name })),
    programs: ctx.programs.map((x) => ({ key: x.code, label: x.name, active: x.active })),
    confs: CONF_LEVELS.map((c) => ({ key: c, label: ctx.t[`conf_${c}` as TKey] })),
    users: [...ctx.users.values()].filter((u) => !u.isSystem).sort((a, b) => a.name.localeCompare(b.name, ctx.lang))
      .map((u) => ({ id: u.id, name: u.name, initials: u.initials, role: u.role, department: u.department, approver: !!matrix.get(`${MATRIX_ROLE[u.role as SimRole]}:approve`) })),
    functions: ctx.functions.map((x) => ({ key: x.key, label: fr ? x.labelFr : x.labelEn, scope: x.scope })),
    currentUserId: ctx.user.id,
    currentRole: ctx.role,
    currentDepartment: ctx.user.department,
    perms: [...ctx.perms],
    seesAll: ctx.seesAll,
    files: fileRules(process.env),
  };
  return (
    <html lang={ctx.lang} className={inter.variable}>
      <body>
        <AppProvider t={ctx.t} lang={ctx.lang} data={data} todo={todo}>
          <div className="app">
            <Sidebar
              screens={ctx.screens}
              user={{ name: ctx.user.name, initials: ctx.user.initials }}
              roleTitle={ctx.t[`role_${ctx.role}`]}
              keystoneUrl={keystoneUrl()}
            />
            <div className="app-col">
              <Header notif={{
                recent: recent.map((a) => ({ id: a.id, when: a.when, user: a.user, actionLabel: a.actionLabel, ref: a.currentId ?? a.ref, href: a.href })),
              }} />
              <main className="app-main">{children}</main>
            </div>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
