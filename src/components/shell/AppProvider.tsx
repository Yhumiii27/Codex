'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Lang, T } from '@/lib/i18n';
import type { MyAction, Todo } from '@/lib/queries';
import { latestTodo } from './todo';
import type { DialogData, DialogSpec } from '@/components/dialogs/types';
import { Dialogs } from '@/components/dialogs/Dialogs';

/** `error`: a refusal; 'warn': done, with something to know (ActionResult.warning), left on screen longer. */
type Toast = { id: number; text: string; error?: boolean | 'warn' };

type AppCtx = {
  t: T;
  lang: Lang;
  data: DialogData;
  open: (d: DialogSpec) => void;
  close: () => void;
  toast: (text: string, error?: boolean | 'warn') => void;
  /** « À traiter » (lib/queries.ts myTodo): the sidebar badge and the bell, the most recent list the shell was given. */
  todo: MyAction[];
  reportTodo: (x: Todo) => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/**
 * Hands the home page's « À traiter » to the shell. A client navigation renders the page again but not the layout,
 * whose list may be older: the badge and the bell follow the list the page shows (same source, same count).
 */
export function TodoSync({ todo }: { todo: Todo }) {
  const { reportTodo } = useApp();
  useEffect(() => reportTodo(todo), [reportTodo, todo]);
  return null;
}

export function AppProvider({ t, lang, data, todo, children }: { t: T; lang: Lang; data: DialogData; todo: Todo; children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  // The layout's list, or a more recent one the home page reported (latestTodo).
  const [reported, setReported] = useState<Todo | null>(null);
  const reportTodo = useCallback((x: Todo) => setReported((r) => (r ? latestTodo(r, x) : x)), []);
  const items = latestTodo(todo, reported).items;

  const toast = useCallback((text: string, error?: boolean | 'warn') => {
    const id = ++seq.current;
    setToasts((xs) => [...xs, { id, text, error }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), error === 'warn' ? 10_000 : 3200);
  }, []);
  const close = useCallback(() => setDialog(null), []);
  const value = useMemo(() => ({ t, lang, data, open: setDialog, close, toast, todo: items, reportTodo }), [t, lang, data, close, toast, items, reportTodo]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialog && <Dialogs spec={dialog} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={x.error === 'warn' ? 'toast toast-warn' : x.error ? 'toast toast-error' : 'toast'} role={x.error === 'warn' ? 'status' : undefined}>{x.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
