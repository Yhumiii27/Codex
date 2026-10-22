import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import type { PreviewStatus } from '@/db/schema';
import { logger } from './log';
import { converterOf, convertible, previewMaxBytes, previewTimeoutMs, type Converter } from './preview-config';
import { countPdfPages, readStored, removeRendering, sha256Of, storeRendering, FileNotFoundError } from './storage';

// PDF preview of Office files (point 15 of docs/reste-a-faire.md, M12): the file of a working version converted to PDF
// by LibreOffice run headless (CODEX_PREVIEW_SOFFICE) or by a Gotenberg service (CODEX_PREVIEW_GOTENBERG_URL), the first
// time someone who may see it opens it (src/app/api/documents/[id]/file/route.ts, ?preview=pdf), then kept: the
// rendering is stored in the local store and recorded in version_previews with its page count and SHA-256. Nothing is
// converted when no service is configured (lib/preview-config.ts): the record shows "Aperçu indisponible" and the
// download, as before.
//
// Like stageUpload, a conversion never runs inside a database transaction: it may take seconds. At most two run at once
// in a process (others wait, up to eight; beyond, the request gets the stand-in), and one at a time per version (a
// second request waits for the first one's outcome). A failure is recorded and not tried again for an hour, so that a
// file the service cannot convert does not tie it up at every visit. The rights are those of the file itself, checked by
// the route before anything is converted (D-14). LibreOffice is started with an environment of its own (no variable of
// Codex, no secret) and a profile in a temporary folder, removed afterwards.

const log = logger('preview');

/** Why there is no rendering to show. `busy`, `missing`, `altered` and `off` are not recorded: the next visit tries again. */
export type PreviewFailure = 'timeout' | 'failed' | 'invalid' | 'too_large' | 'busy' | 'missing' | 'altered' | 'off';

export type PreviewRow = typeof s.versionPreviews.$inferSelect;
export type Rendering = { ok: true; row: PreviewRow & { status: 'ready'; fileKey: string } } | { ok: false; reason: PreviewFailure };

/** A failed conversion is tried again after this long. */
export const RETRY_MS = 60 * 60_000;
/** Largest rendering kept. */
const MAX_RENDER_BYTES = 200 * 1024 * 1024;
const MAX_RUNNING = 2;
const MAX_WAITING = 8;

class ConversionError extends Error {
  constructor(readonly reason: 'timeout' | 'failed' | 'invalid') {
    super(`conversion ${reason}`);
  }
}

/** The converter in use, as the environment names it now; null when there is none (or an invalid one). */
export function activeConverter(env: Record<string, string | undefined> = process.env): Exclude<Converter, { kind: 'off' | 'invalid' }> | null {
  const c = converterOf(env);
  return c.kind === 'soffice' || c.kind === 'gotenberg' ? c : null;
}

/** The version's rendering or last failure, as recorded. */
export async function previewRow(workingVersionId: number): Promise<PreviewRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(s.versionPreviews).where(eq(s.versionPreviews.workingVersionId, workingVersionId));
  return row ?? null;
}

/** What the record shows of a stored file: a rendering to make or made, none because it failed lately or is too large, or none at all. */
export type PreviewPlan = { kind: 'render'; pages: number | null } | { kind: 'failed'; reason: 'failed' | 'too_large' } | null;

/** The plan for the file of a working version of this extension and size (the record page, before the route is asked). */
export async function previewPlan(v: { id: number; fileKey: string | null; size: number | null }, ext: string, now = Date.now()): Promise<PreviewPlan> {
  if (!v.fileKey || !convertible(ext) || !activeConverter()) return null;
  if (v.size != null && v.size > previewMaxBytes(process.env)) return { kind: 'failed', reason: 'too_large' };
  const row = await previewRow(v.id);
  if (row?.status === 'ready') return { kind: 'render', pages: row.pages };
  if (row?.status === 'failed' && now - Date.parse(row.at) < RETRY_MS) return { kind: 'failed', reason: 'failed' };
  return { kind: 'render', pages: null };
}

// One conversion at a time per version, at most MAX_RUNNING in all, on globalThis: route handlers and pages may sit in
// different bundles of one process.
type State = { inflight: Map<number, Promise<Rendering>>; running: number; waiting: (() => void)[] };
const state: State = ((globalThis as unknown as { __codexPreview?: State }).__codexPreview ??= { inflight: new Map(), running: 0, waiting: [] });

async function slot(): Promise<(() => void) | null> {
  if (state.running >= MAX_RUNNING) {
    if (state.waiting.length >= MAX_WAITING) return null;
    await new Promise<void>((resolve) => state.waiting.push(resolve));
  }
  state.running++;
  return () => {
    state.running--;
    state.waiting.shift()?.();
  };
}

export type SourceVersion = { id: number; storage: string | null; fileKey: string | null; size: number | null; sha256: string | null };

/**
 * The rendering of a working version's file, made now if none is recorded (or the last attempt failed over an hour
 * ago). The caller has checked that the user may see the file. `ext`: the extension the file is stored with.
 */
export function ensureRendering(v: SourceVersion, ext: string, docId: string, label: string): Promise<Rendering> {
  const running = state.inflight.get(v.id);
  if (running) return running;
  const p = render(v, ext, docId, label).finally(() => state.inflight.delete(v.id));
  state.inflight.set(v.id, p);
  return p;
}

async function render(v: SourceVersion, ext: string, docId: string, label: string): Promise<Rendering> {
  const converter = activeConverter();
  if (!converter || !v.fileKey || !convertible(ext)) return { ok: false, reason: 'off' };
  const row = await previewRow(v.id);
  if (row?.status === 'ready' && row.fileKey) return { ok: true, row: row as PreviewRow & { status: 'ready'; fileKey: string } };
  if (row?.status === 'failed' && Date.now() - Date.parse(row.at) < RETRY_MS) return { ok: false, reason: (row.error as PreviewFailure) ?? 'failed' };
  if (v.size != null && v.size > previewMaxBytes(process.env)) return { ok: false, reason: 'too_large' };
  const release = await slot();
  if (!release) return { ok: false, reason: 'busy' };
  try {
    let source: Buffer;
    try {
      source = await readStored(v.storage, v.fileKey);
    } catch (err) {
      if (!(err instanceof FileNotFoundError)) log.error('source file out of reach', { version: v.id, err });
      return { ok: false, reason: 'missing' };
    }
    if (source.length > previewMaxBytes(process.env)) return { ok: false, reason: 'too_large' };
    // A file that is no longer the one recorded is not shown, converted or not (lib/integrity-core.mjs).
    if (v.sha256 && sha256Of(source) !== v.sha256) {
      log.error('source file altered: not converted', { version: v.id });
      return { ok: false, reason: 'altered' };
    }
    const started = Date.now();
    let pdf: Buffer;
    try {
      pdf = await convert(converter, source, ext, previewTimeoutMs(process.env));
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || pdf.length > MAX_RENDER_BYTES) throw new ConversionError('invalid');
    } catch (err) {
      const reason = err instanceof ConversionError ? err.reason : 'failed';
      log.warn('conversion failed', { version: v.id, converter: converter.kind, reason, ms: Date.now() - started, detail: (err as { detail?: string }).detail, err: err instanceof ConversionError ? undefined : err });
      await record(v.id, { status: 'failed', fileKey: null, size: null, pages: null, sha256: null, error: reason, converter: converter.kind });
      return { ok: false, reason };
    }
    const fileKey = await storeRendering(pdf, docId, label);
    const kept = await record(v.id, { status: 'ready', fileKey, size: pdf.length, pages: countPdfPages(pdf, 'application/pdf'), sha256: sha256Of(pdf), error: null, converter: converter.kind });
    if (kept?.fileKey !== fileKey) {
      // Another process recorded its own rendering meanwhile: ours goes.
      await removeRendering(fileKey);
      const other = await previewRow(v.id);
      return other?.status === 'ready' && other.fileKey ? { ok: true, row: other as PreviewRow & { status: 'ready'; fileKey: string } } : { ok: false, reason: 'busy' };
    }
    log.info('rendering made', { version: v.id, converter: converter.kind, pages: kept.pages, bytes: pdf.length, ms: Date.now() - started });
    return { ok: true, row: kept as PreviewRow & { status: 'ready'; fileKey: string } };
  } finally {
    release();
  }
}

/** Records an outcome, never over a rendering already made; returns the row as it stands, or null. */
async function record(workingVersionId: number, values: Omit<PreviewRow, 'workingVersionId' | 'at'> & { status: PreviewStatus }): Promise<PreviewRow | null> {
  const db = await getDb();
  const at = new Date().toISOString();
  const [row] = await db.insert(s.versionPreviews).values({ workingVersionId, ...values, at })
    .onConflictDoUpdate({ target: s.versionPreviews.workingVersionId, set: { ...values, at }, setWhere: eq(s.versionPreviews.status, 'failed') })
    .returning();
  return row ?? (await previewRow(workingVersionId));
}

/**
 * Forgets a rendering found missing or altered when served, so that the next visit makes it again; its file is removed
 * (an altered one is not kept). Only the row that still names this key.
 */
export async function dropRendering(workingVersionId: number, fileKey: string): Promise<void> {
  const db = await getDb();
  await db.delete(s.versionPreviews).where(and(eq(s.versionPreviews.workingVersionId, workingVersionId), eq(s.versionPreviews.fileKey, fileKey)));
  await removeRendering(fileKey);
}

// ── Converters ──────────────────────────────────────────────────────────

async function convert(c: Exclude<Converter, { kind: 'off' | 'invalid' }>, source: Buffer, ext: string, timeoutMs: number): Promise<Buffer> {
  return c.kind === 'soffice' ? viaSoffice(c.path, source, ext, timeoutMs) : viaGotenberg(c.url, source, ext, timeoutMs);
}

/**
 * soffice --headless --convert-to pdf, in a temporary folder that holds the file, the result and LibreOffice's profile
 * (one per conversion: two can run at once), removed afterwards. Killed with its children beyond `timeoutMs`.
 */
async function viaSoffice(bin: string, source: Buffer, ext: string, timeoutMs: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-apercu-'));
  try {
    const input = path.join(dir, `source${ext}`);
    const outDir = path.join(dir, 'out');
    await writeFile(input, source, { mode: 0o600 });
    const args = [
      `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
      '--headless', '--invisible', '--nologo', '--nodefault', '--nolockcheck', '--norestore', '--nofirststartwizard',
      '--convert-to', 'pdf', '--outdir', outDir, input,
    ];
    // Its own environment: nothing of Codex's (database address, tokens) reaches LibreOffice.
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8', SAL_USE_VCLPLUGIN: 'svp' } as unknown as NodeJS.ProcessEnv;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { cwd: dir, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        if (stderr.length < 2000) stderr += d.toString();
      });
      const timer = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        reject(new ConversionError('timeout'));
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new ConversionError('failed'), { detail: stderr.trim().slice(0, 500), code }));
      });
    });
    const out = path.join(outDir, 'source.pdf');
    const st = await stat(out).catch(() => null);
    if (!st?.isFile()) throw new ConversionError('failed');
    if (st.size > MAX_RENDER_BYTES) throw new ConversionError('invalid');
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** POST <url>/forms/libreoffice/convert (Gotenberg 7 and 8), the file as `files`; the answer read up to its bound. */
async function viaGotenberg(base: string, source: Buffer, ext: string, timeoutMs: number): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(source)]), `source${ext}`);
  let res: Response;
  try {
    res = await fetch(`${base}/forms/libreoffice/convert`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') throw new ConversionError('timeout');
    throw err;
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new ConversionError('failed');
  }
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_RENDER_BYTES) {
    await res.body.cancel().catch(() => {});
    throw new ConversionError('invalid');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_RENDER_BYTES) throw new ConversionError('invalid');
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof ConversionError) throw err;
    if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') throw new ConversionError('timeout');
    throw err;
  }
  return Buffer.concat(chunks);
}
