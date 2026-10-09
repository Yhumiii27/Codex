'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Lang, T } from '@/lib/i18n';
import type { DialogData, DialogSpec } from '@/components/dialogs/types';
import { Dialogs } from '@/components/dialogs/Dialogs';

type Toast = { id: number; text: string; error?: boolean };

type AppCtx = {
  t: T;
  lang: Lang;
  data: DialogData;
  open: (d: DialogSpec) => void;
  close: () => void;
  toast: (text: string, error?: boolean) => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ t, lang, data, children }: { t: T; lang: Lang; data: DialogData; children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, error?: boolean) => {
    const id = ++seq.current;
    setToasts((xs) => [...xs, { id, text, error }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);
  const close = useCallback(() => setDialog(null), []);
  const value = useMemo(() => ({ t, lang, data, open: setDialog, close, toast }), [t, lang, data, close, toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialog && <Dialogs spec={dialog} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={x.error ? 'toast toast-error' : 'toast'}>{x.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
