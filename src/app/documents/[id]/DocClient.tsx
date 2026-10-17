'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/components/shell/AppProvider';
import { recordConsultation } from '@/lib/actions';
import { Icon } from '@/components/ui/Icon';
import type { VersionLite } from '@/components/dialogs/types';
import { previewKind } from '@/lib/filetypes';
import styles from './document.module.css';

type PreviewDoc = { id: string; title: string; revLabel: string; departmentL: string; owner: string; dateF: string };
type PreviewFile = { url: string; mime: string; name: string; sizeF: string };

/**
 * Journals that the record was opened (lib/actions.ts recordConsultation), once it is shown in the browser: a prefetch
 * renders the page without running this. Repeated openings are folded together on the server.
 */
export function RecordConsultation({ docId }: { docId: string }) {
  useEffect(() => {
    recordConsultation(docId).catch(() => {});
  }, [docId]);
  return null;
}

/**
 * Centre pane: the stored file when the file route serves it inline (PDF, PNG/JPEG/GIF/WebP image, plain text); a
 * download panel for any other stored file (no conversion exists); the design's paper mock-up only for a version without
 * a file. `pages` is null when the PDF's page count is unknown: the browser's own viewer then pages through it.
 */
export function Preview({ doc, file, pages, hasVersion }: { doc: PreviewDoc; file: PreviewFile | null; pages: number | null; hasVersion: boolean }) {
  const { t } = useApp();
  const [page, setPage] = useState(1);
  // Only what the file route serves inline: any other image (image/vnd.dwg, image/tiff…) would show as a broken one.
  const kind = previewKind(file?.mime);
  const isPdf = kind === 'pdf';
  const isImage = kind === 'image';
  const isText = kind === 'text';
  const shown = isPdf || isImage || isText;
  const paged = isPdf && pages != null;
  const rev = doc.revLabel ? `${t.rev_short} ${doc.revLabel}` : '';
  return (
    <div className={styles.previewCol}>
      <div className={styles.previewScroll}>
        {isPdf ? (
          <iframe key={page} title={doc.title} src={paged ? `${file!.url}#page=${page}&toolbar=0` : file!.url} className={styles.pdf} />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file!.url} alt={doc.title} className={styles.image} />
        ) : isText ? (
          <iframe title={doc.title} src={file!.url} className={styles.pdf} />
        ) : file ? (
          <div className={styles.unavailable}>
            <div style={{ fontSize: 14, wordBreak: 'break-all' }}>{file.name}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{file.sizeF}</div>
            <div style={{ fontSize: 13 }}>{t.preview_unavailable}</div>
            <a href={`${file.url}&download=1`} className="btn btn-secondary"><Icon name="download" size={14} />{t.download}</a>
          </div>
        ) : (
          <div className={styles.paper}>
            <div className={styles.paperHead}><span>{doc.id}{rev ? ` · ${rev}` : ''}</span><span>{doc.departmentL}</span></div>
            <div style={{ fontSize: 18, lineHeight: 1.25, fontWeight: 500, marginTop: 10 }}>{doc.title}</div>
            <div style={{ height: 1, background: 'var(--color-neutral-300)', margin: '4px 0 10px' }} />
            <div className={styles.bar} style={{ height: 8, width: '38%', background: 'var(--color-neutral-400)' }} />
            <div className={styles.lines}><div className={styles.bar} /><div className={styles.bar} /><div className={styles.bar} style={{ width: '82%' }} /></div>
            <div className={styles.bar} style={{ height: 8, width: '46%', background: 'var(--color-neutral-400)', marginTop: 10 }} />
            <div className={styles.lines}><div className={styles.bar} /><div className={styles.bar} style={{ width: '94%' }} /><div className={styles.bar} /><div className={styles.bar} style={{ width: '61%' }} /></div>
            <div className={styles.cartouche}><div>{rev || '—'}</div><div>{doc.owner}</div><div>{doc.dateF}</div></div>
            <div className={styles.lines} style={{ marginTop: 6 }}><div className={styles.bar} /><div className={styles.bar} style={{ width: '88%' }} /><div className={styles.bar} style={{ width: '40%' }} /></div>
          </div>
        )}
      </div>
      <div className={styles.pager}>
        {paged && (
          <>
            <button type="button" className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} aria-label={t.prev_page} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><Icon name="chevronLeft" size={13} sw={1.8} /></button>
            <span className="tabnum" style={{ fontSize: 12 }}>{t.page} {page} {t.of} {pages}</span>
            <button type="button" className="btn btn-ghost btn-icon" style={{ width: 28, height: 28 }} aria-label={t.next_page} disabled={page >= pages!} onClick={() => setPage((p) => Math.min(pages!, p + 1))}><Icon name="chevronRight" size={13} sw={1.8} /></button>
          </>
        )}
        <span className="text-muted" style={{ fontSize: 11, marginLeft: paged ? 12 : 0 }}>{shown ? t.original_file : file ? file.name : hasVersion ? t.no_file : t.no_version}</span>
      </div>
    </div>
  );
}

export type RevVersion = VersionLite & { current: boolean };
export type RevItem = {
  id: number; letter: string; statusLabel: string; tagClass: string;
  /** Dates, designated author and change order, already formatted. */
  lines: string[];
  /** Working versions newest first (drafting circle); outside it, only the final file of the revision in force; null otherwise. */
  versions: RevVersion[] | null;
  /** Address of its approval record (PDF), once approved; null otherwise. */
  visa: string | null;
};

/**
 * Revisions tab: each revision (newest first) with its working versions. Click a version to compare it with the
 * current file (defaults to the newest other version).
 */
export function RevisionsTab({ docId, revisions, current }: { docId: string; revisions: RevItem[]; current: VersionLite | null }) {
  const { t, open } = useApp();
  const [selected, setSelected] = useState<number | null>(null);
  const all = revisions.flatMap((r) => r.versions ?? []);
  const other = all.find((v) => v.id === selected && !v.current) ?? all.find((v) => !v.current) ?? null;
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {revisions.map((r) => (
          <section key={r.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{t.rev_short} {r.letter}</span>
              <span className={r.tagClass} style={{ fontSize: 10.5, padding: '2px 8px' }}>{r.statusLabel}</span>
              {r.visa && (
                <a href={r.visa} className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }} title={t.visa_hint} aria-label={`${t.visa} ${r.letter}`}>
                  <Icon name="download" size={12} />{t.visa}
                </a>
              )}
            </div>
            {r.lines.map((l) => <div key={l} className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>{l}</div>)}
            {r.versions && r.versions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
                {r.versions.map((v) => (
                  <div
                    key={v.id}
                    className={`hairline ${styles.versionRow}`}
                    data-selected={v.id === selected && !v.current ? 'true' : undefined}
                    onClick={() => !v.current && setSelected(v.id)}
                    role={v.current ? undefined : 'button'}
                    tabIndex={v.current ? undefined : 0}
                    onKeyDown={(e) => { if (!v.current && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(v.id); } }}
                  >
                    <div className={styles.versionBox}>{v.label}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{v.commentL}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{v.author} · {v.dateF}{v.fileName ? ` · ${v.fileName}` : ''}{v.fileName && v.sizeF !== '—' ? ` · ${v.sizeF}` : ''}</div>
                      {/* Fingerprint recorded when the file entered Codex: compare it with a copy (sha256sum, Get-FileHash). */}
                      {v.sha256 && <div className={`text-muted ${styles.sha}`} title={t.sha256_hint}>SHA-256 <span className={styles.shaValue}>{v.sha256}</span></div>}
                      {v.current && <span className="tag tag-accent" style={{ marginTop: 6 }}>{t.current}</span>}
                    </div>
                    <a
                      href={`/api/documents/${encodeURIComponent(docId)}/file?v=${v.id}&download=1`}
                      className="btn btn-ghost btn-icon"
                      style={{ width: 28, height: 28, flex: 'none' }}
                      aria-label={`${t.download} ${v.label}`}
                      title={t.download}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name="download" size={13} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={!current || !other} onClick={() => current && other && open({ kind: 'compare', current, other })}>{t.compare}</button>
      </div>
    </>
  );
}
