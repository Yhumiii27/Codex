'use client';

// `useI18n()` as the charte expects it (norma/charte/README.md: `@/i18n/client` → `{ lang, t }`): the components of
// norma/charte/ds translate their few labels through it; Codex's client components may use it too.
import { useApp } from '@/components/shell/AppProvider';

export function useI18n() {
  const { lang, tr } = useApp();
  return { lang, t: tr };
}
