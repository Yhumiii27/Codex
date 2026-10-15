'use client';

import { Fragment, useEffect, useId, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/actions';
import { acceptAttr, fileIssue, fileIssueText, fmtMax } from '@/lib/filetypes';
import { fmtSize } from '@/lib/format';
import { useApp } from '@/components/shell/AppProvider';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * `.dialog-backdrop` + `.dialog` from the design system; closes on Escape and on a click that starts and ends on the
 * backdrop (a text selection released outside the dialog keeps it open). Named by its title; focus moves in on
 * opening, stays inside while it is open, and returns to where it was on closing.
 */
export function Modal({ title, children, actions, width = 520, style }: { title: ReactNode; children: ReactNode; actions: ReactNode; width?: number; style?: CSSProperties }) {
  const { close } = useApp();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    (el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus();
    };
  }, [close]);
  return (
    <div
      className="dialog-backdrop"
      style={{ zIndex: 10 }}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const ok = downOnBackdrop.current && e.target === e.currentTarget;
        downOnBackdrop.current = false;
        if (ok) close();
      }}
    >
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ width: `min(${width}px, 100%)`, maxHeight: '90vh', overflow: 'auto', ...style }}>
        <div className="dialog-title" id={titleId}>{title}</div>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

/**
 * Runs a server action from a dialog: pending state, inline error, then close, navigate and toast. An error about one
 * field (`field`) is returned as such, for the dialog to show it under that field, which gets the focus in `form`.
 */
export function useSubmit() {
  const { t, close, toast } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  /** `staleError`: an error meaning the page is out of date (the step moved on): close, say so, refresh the page. */
  const run = (fn: () => Promise<ActionResult>, opts: { keepOpen?: boolean; staleError?: string; form?: HTMLFormElement } = {}) =>
    start(async () => {
      setError(null);
      setField(null);
      setOutdated(false);
      try {
        const r = await fn();
        if (!r.ok) {
          if (opts.staleError && r.error === opts.staleError) { close(); toast(r.error, true); router.refresh(); return; }
          setError(r.error);
          // The record changed since the dialog opened: the entries stay on screen until the user chooses to reload.
          setOutdated(!!r.stale);
          const input = r.field ? opts.form?.elements.namedItem(r.field) : null;
          if (r.field && input instanceof HTMLElement) {
            setField(r.field);
            input.focus();
          }
          return;
        }
        if (!opts.keepOpen) close();
        if (r.href) router.push(r.href);
        if (r.message) toast(r.message);
      } catch {
        setError(t.error);
      }
    });
  /** After a refusal from an outdated view (ActionResult `stale`): closes the dialog and reloads the record; else undefined. */
  const reload = outdated ? () => { close(); router.refresh(); } : undefined;
  return { pending, error, field, run, reload };
}

export type SelectOption = { key: string; label: string; group?: string };

/**
 * `.input` select. Options carrying a `group` are rendered in `<optgroup>`s (in order of first appearance);
 * `empty` adds a first blank option (optional fields).
 */
export function Select({ id, name, value, onChange, options, defaultValue, required, empty, disabled, ariaLabel }: {
  id?: string; name?: string; value?: string; onChange?: (v: string) => void; defaultValue?: string; options: SelectOption[]; required?: boolean; empty?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const groups: { label: string | undefined; items: SelectOption[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.label === o.group);
    if (g) g.items.push(o); else groups.push({ label: o.group, items: [o] });
  }
  const opt = (o: SelectOption) => <option key={o.key} value={o.key}>{o.label}</option>;
  return (
    <select
      id={id}
      className="input"
      name={name}
      value={value}
      defaultValue={value === undefined ? defaultValue : undefined}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {groups.map((g) => (g.label === undefined
        ? <Fragment key="">{g.items.map(opt)}</Fragment>
        : <optgroup key={g.label} label={g.label}>{g.items.map(opt)}</optgroup>))}
    </select>
  );
}

/**
 * File input of the upload dialogs: offers the admitted formats and gives the largest size (lib/filetypes.ts); a file
 * whose name or size the server would refuse is said at once, and the form is not sent with it. The server checks again,
 * content and virus scan included (lib/storage.ts stageFile).
 */
export function FilePicker({ label, required }: { label: string; required?: boolean }) {
  const { lang, t, data } = useApp();
  const rules = data.files;
  const [file, setFile] = useState<File | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="file-drop" style={{ position: 'relative' }}>
        <input
          type="file"
          name="file"
          required={required}
          accept={acceptAttr(rules)}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? errorId : undefined}
          onChange={(e) => {
            const input = e.currentTarget;
            const f = input.files?.[0] ?? null;
            const found = f ? fileIssue(f.name, f.size, null, rules) : null;
            const text = found ? fileIssueText(t, lang, found, rules) : null;
            input.setCustomValidity(text ?? '');
            setFile(f);
            setIssue(text);
          }}
        />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-accent)', flex: 'none' }}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
        <span className="ellipsis" style={{ flex: 1 }}>{file ? file.name : label}</span>
        <span className="text-muted sub nowrap">{file ? fmtSize(file.size, lang) : t.file_max_hint.replace('{max}', fmtMax(rules.maxBytes, lang))}</span>
      </label>
      {issue && <p id={errorId} className="form-error" role="alert">{issue}</p>}
    </div>
  );
}
