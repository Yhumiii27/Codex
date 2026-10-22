import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { checkAtStart, checkConfig, checkDirectories, checkMode, ConfigRefusedError, dataDirOf, refuses, startupCheck, type Finding } from '@/lib/config-check';

// The configuration checked when the server starts (point 37 of docs/reste-a-faire.md, lib/config-check.ts): each value
// the code would ignore or misread is named in the technical log; in production, a dangerous one stops the server.
// Without any variable (local use, the Mac app), nothing stops it.

const tmp = mkdtempSync(path.join(tmpdir(), 'codex-config-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const codes = (f: Finding[], severity?: Finding['severity']) => f.filter((x) => !severity || x.severity === severity).map((x) => x.code);
const prod = (env: Record<string, string>) => checkConfig(env, { production: true });
const dev = (env: Record<string, string>) => checkConfig(env, { production: false });
const TOKEN = 'k3Jq9vR2mX8pL5tW0zY7bN4cH6fD1gS-aE+uQ'; // 38 varied characters
const SP = { CODEX_SP_TENANT_ID: '0b6f0f2e-6f7c-4d55-9a1e-2f3b4c5d6e7f', CODEX_SP_CLIENT_ID: '6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d', CODEX_SP_CLIENT_SECRET: 'sp~Secret.Value_123', CODEX_SP_DRIVE_ID: 'b!AbCdEf123' };

describe('the default configuration', () => {
  it('has no error, in production (next start, the Mac app) as in development', () => {
    expect(codes(prod({}), 'error')).toEqual([]);
    expect(codes(dev({}), 'error')).toEqual([]);
    expect(refuses(prod({}), {}, true)).toBe(false);
  });

  it('says the integration endpoints are disabled and the registry open, and in production that files go unscanned and users are simulated (O-02)', () => {
    expect(codes(dev({}))).toEqual(['token_unset', 'token_unset', 'registry_open']);
    expect(codes(prod({}))).toEqual(['token_unset', 'token_unset', 'registry_open', 'clamd_off', 'auth_simulated']);
    expect(codes(prod({}), 'warn')).toEqual(['clamd_off', 'auth_simulated']);
  });
});

describe('file storage', () => {
  it('refuses a store it does not know, which lib/storage.ts would silently turn into the local one', () => {
    for (const v of ['SharePoint', 'sharepoint ', 's3', 'locale']) expect(codes(prod({ CODEX_STORAGE: v }), 'error'), v).toEqual(['storage_unknown']);
    for (const v of ['local', ' local ', '']) expect(codes(prod({ CODEX_STORAGE: v }), 'error'), v).toEqual([]);
  });

  it('refuses SharePoint half set up, names what is missing, never shows the secret', () => {
    const f = prod({ CODEX_STORAGE: 'sharepoint', CODEX_SP_TENANT_ID: SP.CODEX_SP_TENANT_ID, CODEX_SP_CLIENT_SECRET: SP.CODEX_SP_CLIENT_SECRET });
    const missing = f.find((x) => x.code === 'sharepoint_incomplete')!;
    expect(missing.severity).toBe('error');
    expect(missing.message).toContain('CODEX_SP_CLIENT_ID, CODEX_SP_DRIVE_ID');
    expect(JSON.stringify(f)).not.toContain(SP.CODEX_SP_CLIENT_SECRET);
    // Complete: only the reminder that it was never tried on a real tenant (O-01).
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP }), 'error')).toEqual([]);
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP }), 'warn')).toContain('sharepoint_untested');
  });

  it('refuses SharePoint identifiers that cannot be ones', () => {
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_SP_CLIENT_ID: 'my-app' }), 'error')).toEqual(['sharepoint_invalid']);
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_SP_TENANT_ID: 'contoso.onmicrosoft.com' }), 'error')).toEqual([]);
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_SP_TENANT_ID: 'not a tenant' }), 'error')).toEqual(['sharepoint_invalid']);
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_SP_DRIVE_ID: 'b!x/../y' }), 'error')).toEqual(['sharepoint_invalid']);
    expect(codes(prod({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_SP_DRIVE_ID: ' b!x ' }), 'error')).toEqual(['sharepoint_invalid']);
  });

  it('warns of SharePoint variables left while the store is local', () => {
    expect(codes(dev({ CODEX_SP_TENANT_ID: SP.CODEX_SP_TENANT_ID }), 'warn')).toEqual(['sharepoint_unused']);
  });
});

describe('integration tokens', () => {
  it('refuses a token short or simple enough to be guessed, without writing it', () => {
    for (const v of ['change-me', 'abc', 'x'.repeat(40), 'ab'.repeat(30)]) {
      const f = prod({ CODEX_IMPORT_TOKEN: v });
      expect(codes(f, 'error'), v).toEqual(['token_weak']);
      expect(JSON.stringify(f)).not.toContain(v);
    }
    expect(codes(prod({ CODEX_IMPORT_TOKEN: TOKEN, VIGIE_WEBHOOK_TOKEN: `${TOKEN}2` }), 'error')).toEqual([]);
  });

  it('asks for 32 characters at least, however varied', () => {
    const varied = 'Abcdefghij1234567890XYZklmnopqrstuvw'; // 36 characters, all different
    for (const n of [16, 23, 31]) expect(codes(prod({ CODEX_IMPORT_TOKEN: varied.slice(0, n) }), 'error'), String(n)).toEqual(['token_weak']);
    for (const n of [32, 36]) expect(codes(prod({ CODEX_IMPORT_TOKEN: varied.slice(0, n) }), 'error'), String(n)).toEqual([]);
  });

  it('refuses a token no Authorization header can carry, and warns of one token for both endpoints', () => {
    expect(codes(prod({ VIGIE_WEBHOOK_TOKEN: `${TOKEN} ${TOKEN}` }), 'error')).toEqual(['token_invalid']);
    expect(codes(prod({ CODEX_IMPORT_TOKEN: TOKEN, VIGIE_WEBHOOK_TOKEN: ` ${TOKEN}` }), 'warn')).toContain('token_shared');
  });
});

describe('signing secrets and rotation', () => {
  it('holds a secret and the values of a rotation (_NEXT) to the rule of the tokens, without writing them', () => {
    const f = prod({ VIGIE_WEBHOOK_SECRET: 'change-me', CODEX_IMPORT_TOKEN_NEXT: 'abc', CODEX_REGISTRY_TOKEN: 'x'.repeat(40) });
    expect(codes(f, 'error')).toEqual(['token_weak', 'token_weak', 'token_weak']);
    expect(f.filter((x) => x.code === 'token_weak').map((x) => x.message.split(' ')[0])).toEqual(['CODEX_IMPORT_TOKEN_NEXT', 'VIGIE_WEBHOOK_SECRET', 'CODEX_REGISTRY_TOKEN']);
    expect(JSON.stringify(f)).not.toContain('change-me');
    // A secret is never sent in a header: a space in it is no error.
    expect(codes(prod({ VIGIE_WEBHOOK_SECRET: `${TOKEN} ${TOKEN}` }), 'error')).toEqual([]);
  });

  it('enables an endpoint by its secret alone, and the registry by its token', () => {
    expect(codes(dev({ VIGIE_WEBHOOK_SECRET: TOKEN }))).toEqual(['token_unset', 'registry_open']);
    expect(codes(dev({ CODEX_REGISTRY_TOKEN: TOKEN }))).toEqual(['token_unset', 'token_unset']);
  });

  it('warns of a _NEXT without its current value, and of one value under two names', () => {
    expect(codes(dev({ VIGIE_WEBHOOK_TOKEN_NEXT: TOKEN }), 'warn')).toEqual(['rotation_incomplete']);
    expect(codes(dev({ VIGIE_WEBHOOK_TOKEN: TOKEN, VIGIE_WEBHOOK_SECRET: TOKEN }), 'warn')).toEqual(['token_shared']);
    expect(codes(dev({ CODEX_IMPORT_TOKEN: TOKEN, CODEX_REGISTRY_TOKEN_NEXT: TOKEN, CODEX_REGISTRY_TOKEN: `${TOKEN}2` }), 'warn')).toEqual(['token_shared']);
    // The same value as current and next is pointless, not shared.
    expect(codes(dev({ CODEX_IMPORT_TOKEN: TOKEN, CODEX_IMPORT_TOKEN_NEXT: TOKEN }), 'warn')).toEqual([]);
  });

  it('warns of a signature window it cannot read', () => {
    expect(codes(dev({ CODEX_SIGNATURE_WINDOW_S: '120' }), 'warn')).toEqual([]);
    for (const v of ['5m', '10', '7200']) expect(codes(dev({ CODEX_SIGNATURE_WINDOW_S: v }), 'warn'), v).toEqual(['signature_window_invalid']);
  });
});

describe('scheduler', () => {
  it('warns of an interval it cannot read, of the deferred entry into force turned off, and of the scheduler off', () => {
    expect(codes(dev({ CODEX_SCHEDULE_BACKUP: '1d', CODEX_SCHEDULE_ORPHANS: 'off' }), 'warn')).toEqual([]);
    expect(codes(dev({ CODEX_SCHEDULE_BACKUP: 'daily' }), 'warn')).toEqual(['schedule_invalid']);
    expect(codes(dev({ CODEX_SCHEDULE_PROMOTE: 'off' }), 'warn')).toEqual(['schedule_promote_off']);
    expect(codes(dev({ CODEX_SCHEDULER: 'off' }), 'warn')).toEqual(['scheduler_off']);
    expect(codes(dev({ CODEX_SCHEDULER: 'maybe' }), 'warn')).toEqual(['flag_invalid']);
    expect(codes(dev({ CODEX_SCHEDULE_EXPORT_KEEP: '0' }), 'warn')).toEqual(['export_keep_invalid']);
  });
});

describe('Vigie and Keystone', () => {
  it('refuses an address that is not http(s), or that carries credentials', () => {
    for (const v of ['localhost:3200', 'javascript:alert(1)', 'ftp://vigie', 'vigie.local/api', 'http://']) {
      expect(codes(prod({ NEXT_PUBLIC_VIGIE_URL: v }), 'error'), v).toEqual(['url_invalid']);
    }
    expect(codes(prod({ NEXT_PUBLIC_KEYSTONE_URL: 'https://user:pw@keystone.epc2i.fr' }), 'error')).toEqual(['url_credentials']);
    // Never the value: without its scheme, an address with credentials reads as "scheme:password@host".
    for (const v of ['admin:S3cretPass@vigie.epc2i.local:3200/api', 'ftp://codex:S3cretPass@vigie.interne/api', 'vigie.local/api?apikey=S3cretKey', 'https://user:S3cretPass@keystone.epc2i.fr']) {
      const f = prod({ VIGIE_API_URL: v, NEXT_PUBLIC_VIGIE_URL: v, NEXT_PUBLIC_KEYSTONE_URL: v });
      expect(codes(f, 'error').length, v).toBe(3);
      expect(JSON.stringify(f), v).not.toMatch(/S3cret/);
    }
    expect(codes(prod({ NEXT_PUBLIC_KEYSTONE_URL: 'https://keystone.epc2i.fr', NEXT_PUBLIC_VIGIE_URL: 'http://localhost:3200' }), 'error')).toEqual([]);
  });

  it('warns that VIGIE_API_URL turns the simulation off while Codex does not call Vigie yet', () => {
    expect(codes(prod({ VIGIE_API_URL: 'https://vigie.epc2i.fr/api' }), 'warn')).toEqual(expect.arrayContaining(['vigie_api_not_wired', 'vigie_no_webhook']));
    expect(codes(prod({ VIGIE_API_URL: 'https://vigie.epc2i.fr/api', VIGIE_WEBHOOK_TOKEN: TOKEN }), 'warn')).not.toContain('vigie_no_webhook');
  });
});

describe('virus scan', () => {
  it('refuses an address clamd cannot be reached at, and accepts host:port, a host, IPv6 and a socket path', () => {
    for (const v of ['run/clamav/clamd.ctl', 'clamav:3310/scan', 'clamav:abc', 'clamav:99999', 'user@clamav:3310']) {
      expect(codes(prod({ CODEX_CLAMD: v }), 'error'), v).toEqual(['clamd_invalid']);
    }
    for (const v of ['127.0.0.1:3310', 'clamav', '[::1]:3310', '/run/clamav/clamd.ctl', 'tcp://clamav:3310']) {
      expect(codes(prod({ CODEX_CLAMD: v }), 'error'), v).toEqual([]);
    }
    // The address is quoted without its credentials.
    const f = prod({ CODEX_CLAMD: 'scan:S3cretPass@clamav:3310?key=S3cretKey' });
    expect(codes(f, 'error')).toEqual(['clamd_invalid']);
    expect(JSON.stringify(f)).not.toMatch(/S3cret/);
  });

  it('warns of a value ignored and of files accepted unscanned', () => {
    const f = prod({ CODEX_CLAMD: 'clamav', CODEX_CLAMD_TIMEOUT_MS: '30s', CODEX_CLAMD_ON_ERROR: 'accept' });
    expect(codes(f, 'warn')).toEqual(expect.arrayContaining(['clamd_timeout_invalid', 'clamd_accept']));
    expect(codes(prod({ CODEX_CLAMD: 'clamav', CODEX_CLAMD_ON_ERROR: 'ignore' }), 'warn')).toContain('clamd_on_error_invalid');
  });
});

describe('other settings', () => {
  it('warns of each value the code would replace by its default', () => {
    const f = dev({
      CODEX_MAX_FILE_MB: 'cinquante', CODEX_FILE_EXTENSIONS: 'pdf,exe,docm', CODEX_RATE_WRITES: 'beaucoup', CODEX_HTTPS: 'oui',
      CODEX_ORPHAN_GRACE_HOURS: '1.5', CODEX_BACKUP_KEEP: '0', CODEX_LOG_LEVEL: 'verbose', CODEX_LOG_FORMAT: 'xml', CODEX_CONFIG_CHECK: 'maybe',
    });
    expect(codes(f, 'warn').sort()).toEqual([
      'backup_keep_invalid', 'config_check_invalid', 'extensions_dropped', 'flag_invalid', 'log_format_invalid', 'log_level_invalid',
      'max_file_invalid', 'orphan_grace_invalid', 'rate_invalid',
    ]);
    expect(f.find((x) => x.code === 'extensions_dropped')!.message).toContain('exe, docm');
    expect(codes(dev({ CODEX_FILE_EXTENSIONS: 'exe,bat' }), 'warn')).toEqual(['extensions_dropped', 'extensions_default']);
    expect(codes(dev({ CODEX_STORAGE: 'sharepoint', ...SP, CODEX_MAX_FILE_MB: '500' }), 'warn')).toContain('max_file_capped');
    expect(codes(prod({ CODEX_RATE_LIMIT: 'off' }), 'warn')).toContain('rate_off');
  });

  it('refuses a seed mode it does not know, and says when migrations go without a backup (src/db/index.ts)', () => {
    expect(codes(prod({ CODEX_SEED: 'minimal' }))).not.toContain('seed_unknown');
    expect(codes(prod({ CODEX_SEED: 'reference' }), 'error')).toEqual(['seed_unknown']);
    expect(codes(dev({ CODEX_MIGRATION_BACKUP: 'off' }), 'warn')).toEqual(['migration_backup_off']);
    expect(codes(dev({ CODEX_MIGRATION_BACKUP: 'peut-être' }), 'warn')).toEqual(['flag_invalid']);
    expect(codes(dev({ CODEX_MIGRATION_BACKUP: '1' }), 'warn')).toEqual([]);
  });

  it('reads the data folder as src/db/index.ts does', () => {
    expect(dataDirOf({}, '/srv/codex')).toBe('/srv/codex/.data');
    expect(dataDirOf({ CODEX_DATA_DIR: 'donnees' }, '/srv/codex')).toBe('/srv/codex/donnees');
    expect(codes(dev({ CODEX_DATA_DIR: ' ' }), 'warn')).toEqual(['data_dir_empty']);
  });
});

describe('what an error does', () => {
  it('stops the server in production unless CODEX_CONFIG_CHECK=warn; in development only when strict is asked', () => {
    const bad = prod({ CODEX_STORAGE: 'nas' });
    expect([checkMode({}, true), checkMode({}, false)]).toEqual(['strict', 'warn']);
    expect(refuses(bad, {}, true)).toBe(true);
    expect(refuses(bad, { CODEX_CONFIG_CHECK: 'warn' }, true)).toBe(false);
    expect(refuses(bad, {}, false)).toBe(false);
    expect(refuses(bad, { CODEX_CONFIG_CHECK: ' Strict ' }, false)).toBe(true);
    // Warnings never stop it.
    expect(refuses(prod({ CODEX_RATE_WRITES: 'beaucoup' }), {}, true)).toBe(false);
  });
});

describe('folders', () => {
  it('accepts a data folder Codex can write, or one it can create', async () => {
    expect(await checkDirectories({ CODEX_DATA_DIR: tmp }, '/')).toEqual([]);
    expect(await checkDirectories({ CODEX_DATA_DIR: path.join(tmp, 'new', 'data') }, '/')).toEqual([]);
  });

  it('refuses a data folder that is a file, or that cannot be created', async () => {
    const file = path.join(tmp, 'a-file');
    writeFileSync(file, 'x');
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: file }, '/'))).toEqual(['data_dir_unwritable']);
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: path.join(file, 'data') }, '/'))).toEqual(['data_dir_unwritable']);
    const data = path.join(tmp, 'with-files');
    mkdirSync(data);
    writeFileSync(path.join(data, 'files'), 'not a folder');
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: data }, '/'))).toEqual(['data_dir_unwritable']);
  });

  it.skipIf(process.getuid?.() === 0)('refuses a data folder it cannot write', async () => {
    const ro = path.join(tmp, 'read-only');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    try {
      expect(codes(await checkDirectories({ CODEX_DATA_DIR: ro }, '/'))).toEqual(['data_dir_unwritable']);
    } finally {
      chmodSync(ro, 0o700);
    }
  });

  it('warns of backups set inside the database or the files, which would all be refused', async () => {
    const data = path.join(tmp, 'd');
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: data, CODEX_BACKUP_DIR: path.join(data, 'files', 'b') }, '/'))).toEqual(['backup_dir_inside']);
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: data, CODEX_BACKUP_DIR: data }, '/'))).toEqual(['backup_dir_inside']);
    expect(codes(await checkDirectories({ CODEX_DATA_DIR: data }, '/'))).toEqual([]);
  });
});

describe('at start', () => {
  it('writes each finding and a summary, and stops on a refusal with the codes, never a secret', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((l: unknown) => void lines.push(String(l)));
    const env = { NODE_ENV: 'production', CODEX_LOG_FORMAT: 'json', CODEX_DATA_DIR: tmp, CODEX_IMPORT_TOKEN: 'change-me', CODEX_STORAGE: 'sharepoint', CODEX_SP_CLIENT_SECRET: 'very-secret' };
    vi.stubEnv('CODEX_LOG_FORMAT', 'json');
    await expect(startupCheck(env, { cwd: tmp })).rejects.toThrow(ConfigRefusedError);
    const entries = lines.map((l) => JSON.parse(l));
    expect(entries.every((e) => e.scope === 'config')).toBe(true);
    expect(entries.at(-1)).toMatchObject({ level: 'error', codes: ['sharepoint_incomplete', 'token_weak'], check: 'strict', mode: 'production' });
    expect(lines.join('\n')).not.toMatch(/change-me|very-secret/);
  });

  it('starts anyway with CODEX_CONFIG_CHECK=warn, and in development', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(startupCheck({ NODE_ENV: 'production', CODEX_DATA_DIR: tmp, CODEX_STORAGE: 'nas', CODEX_CONFIG_CHECK: 'warn' }, { cwd: tmp })).resolves.toHaveLength(6);
    expect(warn.mock.calls.at(-1)?.[0]).toContain('started anyway');
    await expect(startupCheck({ NODE_ENV: 'development', CODEX_DATA_DIR: tmp, CODEX_STORAGE: 'nas' }, { cwd: tmp })).resolves.toBeDefined();
  });

  it('ends the process with code 1 when the configuration is refused', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CODEX_DATA_DIR', tmp);
    vi.stubEnv('CODEX_STORAGE', 'nas');
    const exitCode = process.exitCode;
    const exit = vi.fn();
    try {
      await expect(checkAtStart(exit)).rejects.toThrow(ConfigRefusedError);
      await new Promise((r) => setTimeout(r, 150));
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = exitCode;
    }
    // A sound configuration starts.
    vi.stubEnv('CODEX_STORAGE', 'local');
    const ok = vi.fn();
    await checkAtStart(ok);
    await new Promise((r) => setTimeout(r, 150));
    expect(ok).not.toHaveBeenCalled();
  });
});
