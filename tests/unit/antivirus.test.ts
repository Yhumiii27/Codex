import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { antivirusSettings, clamd, clamdTarget, parseClamdReply, ScanError, scanFile, ScanLimitError } from '@/lib/antivirus';
import { deadAddress, EICAR, fakeClamd, type FakeClamd } from '../support/clamd';

// Virus scan of incoming files (src/lib/antivirus.ts), against a fake clamd that speaks INSTREAM (tests/support/clamd.ts):
// the file goes as length-prefixed chunks, the answer says clean, infected (EICAR) or error. Without CODEX_CLAMD there
// is no scan; with one, a scan that fails refuses the file unless CODEX_CLAMD_ON_ERROR=accept.

let server: FakeClamd | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('clamd replies and address', () => {
  it('reads clean, infected and error replies', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ infected: false });
    expect(parseClamdReply('stream: Eicar-Test-Signature FOUND\0')).toEqual({ infected: true, threat: 'Eicar-Test-Signature' });
    expect(parseClamdReply('stream: Win.Trojan.Agent-1 FOUND')).toEqual({ infected: true, threat: 'Win.Trojan.Agent-1' });
    expect(() => parseClamdReply('Can\'t allocate memory ERROR\0')).toThrow(ScanError);
    expect(() => parseClamdReply('')).toThrow(ScanError);
  });

  it('tells a file beyond clamd\'s limits from a failure: sending it again changes nothing', () => {
    // StreamMaxLength, and with AlertExceedsMax: MaxFileSize, MaxScanSize, MaxRecursion…
    for (const reply of ['INSTREAM size limit exceeded. ERROR\0', 'stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0', 'stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND']) {
      expect(() => parseClamdReply(reply), reply).toThrow(ScanLimitError);
    }
    expect(() => parseClamdReply('Can\'t allocate memory ERROR')).not.toThrow(ScanLimitError);
    expect(parseClamdReply('stream: Heuristics.Phishing.Email.SpoofedDomain FOUND')).toEqual({ infected: true, threat: 'Heuristics.Phishing.Email.SpoofedDomain' });
  });

  it('reaches clamd by host and port (3310 by default) or by its Unix socket', () => {
    expect(clamdTarget('127.0.0.1:3311')).toEqual({ host: '127.0.0.1', port: 3311 });
    expect(clamdTarget('clamav')).toEqual({ host: 'clamav', port: 3310 });
    expect(clamdTarget('tcp://clamav:3310')).toEqual({ host: 'clamav', port: 3310 });
    expect(clamdTarget('[::1]:3310')).toEqual({ host: '::1', port: 3310 });
    expect(clamdTarget('/run/clamav/clamd.ctl')).toEqual({ path: '/run/clamav/clamd.ctl' });
    expect(() => clamdTarget('clamav/x')).toThrow(ScanError);
  });
});

describe('INSTREAM connector', () => {
  it('sends the whole file in chunks and reads a clean verdict', async () => {
    server = await fakeClamd();
    // Larger than one chunk (64 KB): the stream must arrive whole and in order.
    const file = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
    expect(await clamd(server.address, 2000).scan(file)).toEqual({ infected: false });
    expect(server.commands).toEqual(['zINSTREAM']);
    expect(server.streams).toHaveLength(1);
    expect(server.streams[0].equals(file)).toBe(true);
  });

  it('reports the EICAR test file as infected', async () => {
    server = await fakeClamd();
    expect(await clamd(server.address, 2000).scan(Buffer.from(EICAR))).toEqual({ infected: true, threat: 'Eicar-Test-Signature' });
  });

  it('works over a Unix socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-clamd-'));
    try {
      server = await fakeClamd('normal', join(dir, 'clamd.sock'));
      expect(server.address).toBe(join(dir, 'clamd.sock'));
      expect(await clamd(server.address, 2000).scan(Buffer.from(`notes\n${EICAR}`))).toEqual({ infected: true, threat: 'Eicar-Test-Signature' });
    } finally {
      await server?.close();
      server = null;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails, without a verdict, on an error reply, a size limit, silence or no clamd', async () => {
    server = await fakeClamd('error');
    await expect(clamd(server.address, 2000).scan(Buffer.from('x'))).rejects.toThrow(/ERROR/);
    await server.close();

    // clamd answers as soon as the stream passes its StreamMaxLength and closes: no hang, no verdict.
    server = await fakeClamd('limit');
    await expect(clamd(server.address, 2000).scan(Buffer.alloc(300_000, 1))).rejects.toThrow(ScanLimitError);
    await server.close();

    server = await fakeClamd('exceeds');
    await expect(clamd(server.address, 2000).scan(Buffer.from('x'))).rejects.toThrow(ScanLimitError);
    await server.close();

    server = await fakeClamd('silent');
    const started = Date.now();
    await expect(clamd(server.address, 300).scan(Buffer.from('x'))).rejects.toThrow(/no answer within 300 ms/);
    expect(Date.now() - started).toBeLessThan(2000);
    await server.close();
    server = null;

    await expect(clamd(await deadAddress(), 2000).scan(Buffer.from('x'))).rejects.toThrow(ScanError);
  });
});

describe('settings', () => {
  it('scans nothing without CODEX_CLAMD, and refuses on a failed scan unless told to accept', () => {
    expect(antivirusSettings({})).toEqual({ scanner: null, onError: 'refuse' });
    expect(antivirusSettings({ CODEX_CLAMD: '  ' }).scanner).toBeNull();
    const set = antivirusSettings({ CODEX_CLAMD: '127.0.0.1:3310' });
    expect([set.scanner?.engine, set.scanner?.address, set.onError]).toEqual(['clamd', '127.0.0.1:3310', 'refuse']);
    expect(antivirusSettings({ CODEX_CLAMD: 'x', CODEX_CLAMD_ON_ERROR: 'ACCEPT' }).onError).toBe('accept');
    expect(antivirusSettings({ CODEX_CLAMD: 'x', CODEX_CLAMD_ON_ERROR: 'oui' }).onError).toBe('refuse');
  });

  it('says once in the log that scanning is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('CODEX_CLAMD', '');
    expect(await scanFile(Buffer.from('a'), 'a.txt')).toEqual({ kind: 'unscanned' });
    expect(await scanFile(Buffer.from('b'), 'b.txt')).toEqual({ kind: 'unscanned' });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('scanning off'))).toHaveLength(1);
  });

  it('gives the scan outcome of a file: clean, infected, failed, or unscanned when failures are accepted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    server = await fakeClamd();
    vi.stubEnv('CODEX_CLAMD', server.address);
    expect(await scanFile(Buffer.from('%PDF-1.7'), 'a.pdf')).toEqual({ kind: 'clean' });
    expect(await scanFile(Buffer.from(EICAR), 'eicar.txt')).toEqual({ kind: 'infected', threat: 'Eicar-Test-Signature' });
    server.mode = 'limit';
    expect(await scanFile(Buffer.alloc(300_000, 1), 'gros.pdf')).toMatchObject({ kind: 'too_large' });
    server.mode = 'exceeds';
    expect(await scanFile(Buffer.from('x'), 'gros.pdf')).toMatchObject({ kind: 'too_large' });
    vi.stubEnv('CODEX_CLAMD', await deadAddress());
    expect(await scanFile(Buffer.from('x'), 'x.txt')).toMatchObject({ kind: 'failed' });
    vi.stubEnv('CODEX_CLAMD_ON_ERROR', 'accept');
    expect(await scanFile(Buffer.from('x'), 'x.txt')).toEqual({ kind: 'unscanned' });
    vi.stubEnv('CODEX_CLAMD', server.address);
    expect(await scanFile(Buffer.from('x'), 'gros.pdf')).toEqual({ kind: 'unscanned' });
  });
});
