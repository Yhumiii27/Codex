import 'server-only';
import { createConnection, type NetConnectOpts } from 'node:net';

// Virus scan of every file entering Codex, before it reaches the store (stageFile, src/lib/storage.ts).
//   CODEX_CLAMD             clamd's address: host:port (TCP, port 3310 by default) or the absolute path of its Unix
//                           socket. Unset: no scan, said once in the server log and on the Administration screen.
//   CODEX_CLAMD_TIMEOUT_MS  longest wait for clamd's answer (30 000 by default).
//   CODEX_CLAMD_ON_ERROR    refuse (default): a file clamd could not scan is refused; accept: it is stored unscanned.
// clamd's own limits must hold the largest file (CODEX_MAX_FILE_MB): StreamMaxLength (beyond it clamd closes the stream
// with an error) and MaxFileSize (beyond it clamd answers OK without scanning), 100 MB each by default since ClamAV 0.105
// and 25 MB before; MaxScanSize (what is scanned once unpacked: 400 MB, 100 MB before 0.105). With AlertExceedsMax yes,
// a file beyond MaxFileSize, MaxScanSize or MaxRecursion is reported "Heuristics.Limits.Exceeded…" rather than OK: Codex
// then refuses it as beyond the scan's limits (ScanLimitError), like a stream beyond StreamMaxLength.

export type ScanVerdict = { infected: false } | { infected: true; threat: string };

/** The scanner could not give a verdict: unreachable, timed out, or an error reported by it. */
export class ScanError extends Error {}

/** The file is beyond what the scanner examines (size, or depth of what it holds): sending it again changes nothing. */
export class ScanLimitError extends ScanError {}

export interface Scanner {
  readonly engine: string;
  /** Where it is reached, for the log and the Administration screen. */
  readonly address: string;
  /** The verdict on these bytes; throws ScanError when there is none. */
  scan(buf: Buffer): Promise<ScanVerdict>;
}

/**
 * clamd's answer to INSTREAM, NUL-terminated: "stream: OK", "stream: <threat> FOUND", or "<message> ERROR". A stream
 * beyond StreamMaxLength ("INSTREAM size limit exceeded. ERROR") and, with AlertExceedsMax, a file beyond clamd's other
 * limits ("stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND"…) throw ScanLimitError: not scanned, not a threat.
 */
export function parseClamdReply(reply: string): ScanVerdict {
  const r = reply.replace(/\0+$/, '').trim();
  if (/^stream: OK$/.test(r)) return { infected: false };
  const found = /^stream: (.+) FOUND$/.exec(r);
  if (found && /^Heuristics\.Limits\.Exceeded/.test(found[1])) throw new ScanLimitError(`clamd: ${found[1]}`);
  if (found) return { infected: true, threat: found[1] };
  if (/size limit exceeded/i.test(r)) throw new ScanLimitError(`clamd: ${r}`);
  throw new ScanError(`clamd: ${r || 'empty reply'}`);
}

/** Where CODEX_CLAMD points: a Unix socket for an absolute path, else host:port (IPv6 between brackets). */
export function clamdTarget(address: string): NetConnectOpts {
  const a = address.trim();
  if (a.startsWith('/')) return { path: a };
  const url = new URL(`tcp://${a.replace(/^tcp:\/\//, '')}`);
  if (!url.hostname || url.pathname.replace(/^\/$/, '') || url.search) throw new ScanError(`invalid CODEX_CLAMD: ${address}`);
  return { host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port: url.port ? Number(url.port) : 3310 };
}

/** Bytes sent per INSTREAM chunk: well under clamd's own buffer. */
const CHUNK = 64 * 1024;

/** clamd over its INSTREAM command: the file goes as length-prefixed chunks on one connection, nothing touches the disk. */
export function clamd(address: string, timeoutMs: number): Scanner {
  return {
    engine: 'clamd',
    address,
    scan: (buf) => new Promise<ScanVerdict>((resolve, reject) => {
      let target: NetConnectOpts;
      try {
        target = clamdTarget(address);
      } catch (err) {
        reject(err instanceof ScanError ? err : new ScanError(String(err)));
        return;
      }
      const received: Buffer[] = [];
      let settled = false;
      const sock = createConnection(target);
      const finish = (err: unknown, verdict?: ScanVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        if (err) reject(err);
        else resolve(verdict!);
      };
      // An answer may come before the whole file is sent (a size limit reached): it counts, whatever happens next.
      const answer = () => {
        const all = Buffer.concat(received);
        const end = all.indexOf(0);
        if (end < 0) return false;
        try {
          finish(null, parseClamdReply(all.subarray(0, end).toString('utf8')));
        } catch (err) {
          finish(err as Error);
        }
        return true;
      };
      const timer = setTimeout(() => finish(new ScanError(`clamd: no answer within ${timeoutMs} ms`)), timeoutMs);
      sock.on('data', (chunk: Buffer) => {
        received.push(chunk);
        answer();
      });
      // clamd closes the connection once it has answered; an answer without its NUL is still read.
      sock.on('end', () => {
        if (answer()) return;
        try {
          finish(null, parseClamdReply(Buffer.concat(received).toString('utf8')));
        } catch (err) {
          finish(err as Error);
        }
      });
      sock.on('error', (err) => {
        if (!answer()) finish(new ScanError(`clamd: ${err.message}`));
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let at = 0; at < buf.length; at += CHUNK) {
          const part = buf.subarray(at, at + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          sock.write(size);
          sock.write(part);
        }
        sock.write(Buffer.alloc(4));
      });
    }),
  };
}

export type AntivirusSettings = { scanner: Scanner | null; onError: 'refuse' | 'accept' };

type AvEnv = Readonly<Record<string, string | undefined>>;

/** The scanner set up by the environment, or none; what to do when it fails (refuse unless told to accept). */
export function antivirusSettings(env: AvEnv = process.env): AntivirusSettings {
  const address = env.CODEX_CLAMD?.trim();
  const ms = Number(env.CODEX_CLAMD_TIMEOUT_MS);
  const timeout = Number.isFinite(ms) && ms > 0 ? ms : 30_000;
  return {
    scanner: address ? clamd(address, timeout) : null,
    onError: env.CODEX_CLAMD_ON_ERROR?.trim().toLowerCase() === 'accept' ? 'accept' : 'refuse',
  };
}

/** What the Administration screen says of the scan. */
export function antivirusStatus(): { engine: string; address: string; onError: 'refuse' | 'accept' } | null {
  const { scanner, onError } = antivirusSettings();
  return scanner ? { engine: scanner.engine, address: scanner.address, onError } : null;
}

let toldOff = false;

export type ScanOutcome =
  | { kind: 'clean' }
  | { kind: 'unscanned' }
  | { kind: 'infected'; threat: string }
  | { kind: 'failed'; error: string }
  /** Beyond clamd's limits (ScanLimitError). */
  | { kind: 'too_large'; error: string };

/**
 * Scans a file before it is stored. Without a scanner, the file passes unscanned (said once in the log). A scanner that
 * fails gives 'failed', or 'too_large' for a file beyond its limits; both give 'unscanned' when CODEX_CLAMD_ON_ERROR=accept.
 */
export async function scanFile(buf: Buffer, name: string): Promise<ScanOutcome> {
  const { scanner, onError } = antivirusSettings();
  if (!scanner) {
    if (!toldOff) {
      toldOff = true;
      console.warn('[antivirus] scanning off: CODEX_CLAMD is not set, uploaded files are stored unscanned');
    }
    return { kind: 'unscanned' };
  }
  try {
    const verdict = await scanner.scan(buf);
    if (!verdict.infected) return { kind: 'clean' };
    console.warn('[antivirus] infected file refused', name, verdict.threat);
    return { kind: 'infected', threat: verdict.threat };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const limit = err instanceof ScanLimitError;
    console.error(limit ? '[antivirus] file beyond clamd limits' : '[antivirus] scan failed', name, buf.length, error, onError === 'accept' ? '(stored unscanned: CODEX_CLAMD_ON_ERROR=accept)' : '(refused)');
    if (onError === 'accept') return { kind: 'unscanned' };
    return limit ? { kind: 'too_large', error } : { kind: 'failed', error };
  }
}
