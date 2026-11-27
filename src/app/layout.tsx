import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './nocturne.css';
import '@norma/charte/touch.css';
import '@norma/charte/coque.css';
import './globals.css';
import { AppProvider } from '@/components/shell/AppProvider';
import { EmptyDatabase } from '@/components/shell/EmptyDatabase';
import { Shell } from '@/components/shell/Shell';
import { databaseIsEmpty } from '@/lib/empty-database';
import type { DialogData } from '@/components/dialogs/types';
import { interClassName } from '@/fonts/inter';
import { getCtx } from '@/lib/context';
import { fileRules } from '@/lib/filetypes';
import { CONF_LEVELS, MATRIX_ROLE, type SimRole } from '@/lib/i18n';
import { keystoneUrl } from '@/server/integrations/keystone';
import { authMode } from '@/server/integrations/clavis/rules';
import { themeFromCookies } from '@/lib/theme';
import { translate } from '@/i18n';
import { getMatrix, listTemplates, myTodo, recentActivity, typeView, vocabSuggestions } from '@/lib/queries';
import { CONF_LABEL, ROLE_LABEL, labelOf } from '@/i18n/labels';

/** Title and description in the user's language; each screen names itself (lib/titles.ts screenTitle, WCAG 2.4.2). */
export async function generateMetadata(): Promise<Metadata> {
  if (await databaseIsEmpty()) return { title: `${translate('fr', 'Codex’s database is empty')} · ${translate('en', 'Codex’s database is empty')} — Codex` };
  const { tr } = await getCtx();
  return { title: `${tr('Codex')} — ${tr('Group DMS')}`, description: tr('Document management for the group') };
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Dark / light display (Norma 1.0): the atrium-theme cookie, set on <html> at render so that the page never flashes.
  const theme = themeFromCookies(await cookies());
  // A server database left empty (no CODEX_SEED): one page that says how to fill it, in place of the shell and of every
  // screen, which need a person to act as (getCtx leads them to /base-vide).
  if (await databaseIsEmpty()) {
    return (
      <html lang="fr" className={interClassName} data-theme={theme}>
        <body><EmptyDatabase /></body>
      </html>
    );
  }
  const ctx = await getCtx();
  const fr = ctx.lang === 'fr';
  // What waits for me (approval steps, revisions to draft, grafts, review and expiry dates): the badge and the bell list
  // the same items as the home's « À traiter », each linking to where to act (myTodo, AppProvider).
  // Only what the shell shows is read (lib/queries.ts): the documents and workflows « À traiter » may come from, the
  // templates, the five latest entries of the 60 latest about documents the user may see (each under its current ID).
  const [todo, templates, recent, matrix, vocab] = await Promise.all([myTodo(ctx), listTemplates(ctx), recentActivity(ctx, 5, 60), getMatrix(), vocabSuggestions(ctx)]);
  const data: DialogData = {
    templates: templates.map((x) => ({ id: x.id, label: x.label, rev: x.rev, owner: x.owner, types: x.types, uses: x.uses })),
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
    capex: ctx.capex.map((x) => ({ key: x.code, label: x.subsidiary ? `${x.name} — ${x.subsidiary}` : x.name, active: x.active })),
    confs: CONF_LEVELS.map((c) => ({ key: c, label: labelOf(ctx.tr, CONF_LABEL, c) })),
    users: [...ctx.users.values()].filter((u) => !u.isSystem).sort((a, b) => a.name.localeCompare(b.name, ctx.lang))
      .map((u) => ({ id: u.id, name: u.name, initials: u.initials, role: u.role, department: u.department, approver: !!matrix.get(`${MATRIX_ROLE[u.role as SimRole]}:approve`) })),
    functions: ctx.functions.map((x) => ({ key: x.key, label: fr ? x.labelFr : x.labelEn, scope: x.scope })),
    currentUserId: ctx.user.id,
    currentRole: ctx.role,
    currentDepartment: ctx.user.department,
    perms: [...ctx.perms],
    seesAll: ctx.seesAll,
    files: fileRules(process.env),
    vocab,
  };
  return (
    <html lang={ctx.lang} className={interClassName} data-theme={theme}>
      <body>
        <AppProvider
          lang={ctx.lang} data={data} todo={todo} theme={theme}
          recent={recent.map((a) => ({ id: a.id, when: a.when, user: a.user, actionLabel: a.actionLabel, ref: a.currentId ?? a.ref, href: a.href }))}
        >
          {/* The common shell (Norma 2.0): skip link first, sidebar, then <main id="main-content"> holding the screen. */}
          <Shell sidebar={{ screens: ctx.screens, user: { name: ctx.user.name, initials: ctx.user.initials }, roleTitle: labelOf(ctx.tr, ROLE_LABEL, ctx.role), keystoneUrl: keystoneUrl(), signOut: authMode() === 'clavis' }}>
            {children}
          </Shell>
        </AppProvider>
      </body>
    </html>
  );
}
