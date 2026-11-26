'use client';

import { useState, useTransition } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { addComment } from '@/lib/actions';
import { failureText } from '@/lib/errors';

export function CommentBox({ workflowId }: { workflowId: string }) {
  // A failure's text comes from the shared error messages (lib/errors.ts failureText), still keyed.
  const { t, tr, toast } = useApp();
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const send = () => {
    if (!text.trim()) return;
    start(async () => {
      try {
        const r = await addComment(workflowId, text);
        if (r.ok) setText('');
        else toast(r.error, true);
      } catch (err) {
        toast(failureText(t, err), true);
      }
    });
  };
  return (
    <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <input className="input" placeholder={tr('Add a comment…')} aria-label={tr('Add a comment…')} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>{tr('Send')}</button>
    </form>
  );
}
