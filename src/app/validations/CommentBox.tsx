'use client';

import { useState, useTransition } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { addComment } from '@/lib/actions';

export function CommentBox({ workflowId }: { workflowId: string }) {
  const { t, toast } = useApp();
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const send = () => {
    if (!text.trim()) return;
    start(async () => {
      try {
        const r = await addComment(workflowId, text);
        if (r.ok) setText('');
        else toast(r.error, true);
      } catch {
        toast(t.error, true);
      }
    });
  };
  return (
    <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <input className="input" placeholder={t.add_comment} aria-label={t.add_comment} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn-secondary" disabled={pending}>{t.send}</button>
    </form>
  );
}
