import { afterEach } from 'vitest';
import { COOKIE_LANG, COOKIE_ROLE, COOKIE_USER } from '@/lib/context';
import type { Lang, SimRole } from '@/lib/i18n';
import type { Person } from './fixtures';

// The simulated session of the Server Actions (lib/context.ts reads it from cookies). A test file that calls actions
// mocks next/headers with cookieStore() and next/cache's refresh() with a no-op:
//
//   vi.mock('next/headers', () => ({ cookies: async () => (await import('../support/session')).cookieStore() }));
//   vi.mock('next/cache', () => ({ refresh: () => {} }));
//
// (imported when cookies() is called, not when the mock is built: this module imports lib/context.ts, which imports
// next/headers.)

const jar = new Map<string, string>();

/** The cookies() of next/headers, over an in-memory jar. */
export async function cookieStore() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  };
}

/** The next actions run as `user`, with their default role or the simulated `role`. */
export function actAs(user: Person, role?: SimRole): void {
  jar.set(COOKIE_USER, user);
  if (role) jar.set(COOKIE_ROLE, role);
  else jar.delete(COOKIE_ROLE);
}

/** The interface language of the next actions and reads (French by default). */
export function setLangCookie(lang: Lang): void {
  jar.set(COOKIE_LANG, lang);
}

afterEach(() => {
  jar.clear();
});
