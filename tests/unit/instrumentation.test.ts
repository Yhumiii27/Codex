import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Instrumentation } from 'next';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestError, register } from '@/instrumentation';
import { ConfigRefusedError } from '@/lib/config-check';

// src/instrumentation.ts, which Next.js calls when a server starts (register) and for each server error it catches
// (onRequestError): the configuration check runs there and refuses a dangerous configuration in production (point 37 of
// docs/reste-a-faire.md); the errors caught go to the technical log (point 49). Nothing on the edge runtime.

const tmp = mkdtempSync(path.join(tmpdir(), 'codex-instrumentation-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let lines: { level: string; entry: Record<string, unknown> }[] = [];
let exitCode: typeof process.exitCode;
beforeEach(() => {
  lines = [];
  exitCode = process.exitCode;
  vi.stubEnv('CODEX_LOG_FORMAT', 'json');
  vi.stubEnv('CODEX_DATA_DIR', tmp);
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((l: unknown) => void lines.push({ level, entry: JSON.parse(String(l)) }));
  }
});
afterEach(() => {
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const settle = () => new Promise((r) => setTimeout(r, 150));

describe('register', () => {
  it('refuses a dangerous configuration in production: the start fails and the process ends with code 1', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CODEX_STORAGE', 'nas');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await expect(register()).rejects.toThrow(ConfigRefusedError);
    await settle();
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.at(-1)).toMatchObject({ level: 'error', entry: { scope: 'config', codes: ['storage_unknown'] } });
  });

  it('starts with the default configuration, and checks nothing on the edge runtime', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(register()).resolves.toBeUndefined();
    expect(lines.at(-1)).toMatchObject({ level: 'info', entry: { scope: 'config', msg: 'configuration checked' } });
    lines = [];
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('CODEX_STORAGE', 'nas');
    await expect(register()).resolves.toBeUndefined();
    await settle();
    expect(exit).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});

describe('onRequestError', () => {
  const request = { path: '/recherche?q=projet+secret', method: 'GET', headers: { cookie: 'codex-user=cbardet' } };
  const context = { routerKind: 'App Router', routePath: '/recherche', routeType: 'render', renderSource: 'react-server-components' } as Parameters<Instrumentation.onRequestError>[2];

  it('writes each server error Next.js catches to the technical log', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await onRequestError(Object.assign(new Error('render failed'), { digest: 'instr-1' }), request, context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', entry: { scope: 'next', path: '/recherche', route: '/recherche', err: { digest: 'instr-1' } } });
    expect(JSON.stringify(lines)).not.toMatch(/secret|cbardet/);
  });

  it('does nothing on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await onRequestError(Object.assign(new Error('render failed'), { digest: 'instr-2' }), request, context);
    expect(lines).toEqual([]);
  });
});
