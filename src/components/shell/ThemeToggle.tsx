'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Seg } from '@/components/ui/Seg';
import { themeCookie, type Theme } from '@/lib/theme';
import { useApp } from './AppProvider';

/**
 * Dark / light display, right of the FR / EN switch (Norma 1.0, as norma/charte/ds/ThemeToggle.tsx, written with Codex's
 * own segmented control and icons). Changes <html data-theme> and the epc2i-theme cookie in the browser, with no round
 * trip to the server, which reads the cookie again on the next pages (app/layout.tsx).
 */
export function ThemeToggle({ theme: initial }: { theme: Theme }) {
  const { t } = useApp();
  const [theme, setTheme] = useState<Theme>(initial);
  const option = (key: Theme, icon: 'moon' | 'sun', label: string) => ({
    key, title: label,
    label: <><Icon name={icon} size={14} /><span className="sr-only">{label}</span></>,
  });
  return (
    <Seg
      name="theme"
      ariaLabel={t.theme_group}
      value={theme}
      optStyle={{ padding: '5px 8px', fontSize: 12 }}
      options={[option('dark', 'moon', t.theme_dark), option('light', 'sun', t.theme_light)]}
      onPick={(k) => {
        const v: Theme = k === 'light' ? 'light' : 'dark';
        setTheme(v);
        document.documentElement.dataset.theme = v;
        document.cookie = themeCookie(v);
      }}
    />
  );
}
