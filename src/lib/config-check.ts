import { constants as fsc } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { backupDirOf } from './backup-core.mjs';
import { admittedExtensions, DENIED_EXTENSIONS, SHAREPOINT_MAX_FILE_MB } from './filetypes';
import { LOG_LEVELS, write } from './log';
import { parseRule, RATE_LIMITS } from './ratelimit';
import { seedModeOf } from './seed-mode';
import { appVersion } from './version';

// Configuration checked when the server starts (point 37 of docs/reste-a-faire.md), from src/instrumentation.ts: the
// environment variables of .env.example, read as the code reads them, so that a value the code would silently ignore
// or misread is said once, clearly, in the technical log (lib/log.ts, scope "config"), with the variable to correct.
//
// Three severities. "error": a configuration that would not work, or not safely (a store half set up, a token that can
// be guessed, a link that is no web address, a data folder Codex cannot write); "warn": a value ignored, a default
// applied, a choice to confirm; "info": a state worth knowing (an integration endpoint disabled).
// CODEX_CONFIG_CHECK decides what an error does: "strict" refuses to start, "warn" logs it and starts. Default: strict
// in production (next start, the Mac app), warn otherwise (next dev). The default configuration, without any variable,
// has no error: local use and the Mac app start as before.
//
// No value of a secret is ever written: a token, a client secret are named, never shown.

export type Severity = 'error' | 'warn' | 'info';
export type Finding = { severity: Severity; code: string; message: string };
type Env = Readonly<Record<string, string | undefined>>;

const ON = /^(1|true|on|yes)$/i;
const OFF = /^(0|false|off|no)$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Shortest integration token admitted: `openssl rand -base64 32` (docs/api.md) gives 44 characters. */
export const MIN_TOKEN_LENGTH = 32;

export const SHAREPOINT_VARS = ['CODEX_SP_TENANT_ID', 'CODEX_SP_CLIENT_ID', 'CODEX_SP_CLIENT_SECRET', 'CODEX_SP_DRIVE_ID'] as const;
const TOKENS = [
  ['CODEX_IMPORT_TOKEN', 'POST /api/import'],
  ['VIGIE_WEBHOOK_TOKEN', 'POST /api/integrations/vigie'],
] as const;
const URLS = ['VIGIE_API_URL', 'NEXT_PUBLIC_VIGIE_URL', 'NEXT_PUBLIC_KEYSTONE_URL'] as const;

/** Where the database and the files live, as src/db/index.ts reads it (`cwd`: the folder the server runs in). */
export function dataDirOf(env: Env, cwd: string): string {
  return path.resolve(/*turbopackIgnore: true*/ cwd, env.CODEX_DATA_DIR ?? '.data');
}

/** What an error does: CODEX_CONFIG_CHECK, else strict in production and warn otherwise. */
export function checkMode(env: Env, production: boolean): 'strict' | 'warn' {
  const v = env.CODEX_CONFIG_CHECK?.trim().toLowerCase();
  return v === 'strict' || v === 'warn' ? v : production ? 'strict' : 'warn';
}

/** Whether the findings stop the server: an error while the mode is strict. */
export function refuses(findings: Finding[], env: Env, production: boolean): boolean {
  return checkMode(env, production) === 'strict' && findings.some((f) => f.severity === 'error');
}

/** The checks that need no file system: every variable of .env.example that the code reads. */
export function checkConfig(env: Env, { production }: { production: boolean }): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, code: string, message: string) => out.push({ severity, code, message });
  const set = (k: string) => !!env[k]?.trim();

  // ── File storage (lib/storage.ts compares the raw value with "sharepoint") ──
  const storage = env.CODEX_STORAGE;
  const sharepoint = storage === 'sharepoint';
  if (storage?.trim() && storage.trim() !== 'local' && !sharepoint) {
    add('error', 'storage_unknown', `CODEX_STORAGE="${storage.slice(0, 40)}" is neither local nor sharepoint: files would be stored locally ($CODEX_DATA_DIR/files) without a word`);
  }
  if (sharepoint) {
    const missing = SHAREPOINT_VARS.filter((k) => !env[k]);
    if (missing.length) add('error', 'sharepoint_incomplete', `CODEX_STORAGE=sharepoint but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set: every upload and every download would fail`);
    const spaced = SHAREPOINT_VARS.filter((k) => env[k] && env[k] !== env[k]!.trim());
    if (spaced.length) add('error', 'sharepoint_invalid', `${spaced.join(', ')}: spaces around the value, sent as they are to Microsoft Graph`);
    const tenant = env.CODEX_SP_TENANT_ID?.trim();
    if (tenant && !GUID.test(tenant) && !DOMAIN.test(tenant)) add('error', 'sharepoint_invalid', 'CODEX_SP_TENANT_ID is neither a directory (tenant) ID nor a domain name');
    const client = env.CODEX_SP_CLIENT_ID?.trim();
    if (client && !GUID.test(client)) add('error', 'sharepoint_invalid', 'CODEX_SP_CLIENT_ID is not an application (client) ID: a GUID is expected');
    const drive = env.CODEX_SP_DRIVE_ID?.trim();
    if (drive && /[\s/?#]/.test(drive)) add('error', 'sharepoint_invalid', 'CODEX_SP_DRIVE_ID holds a space, "/", "?" or "#": not a drive ID');
    add('warn', 'sharepoint_untested', 'CODEX_STORAGE=sharepoint: this store has not been tried against a real tenant yet (O-01, docs/decisions.md)');
  } else {
    const stray = SHAREPOINT_VARS.filter(set);
    if (stray.length) add('warn', 'sharepoint_unused', `${stray.join(', ')} set while CODEX_STORAGE is not sharepoint: not used, files are stored locally`);
  }

  // ── Integration tokens (lib/importer.ts checkBearer) ──
  for (const [name, route] of TOKENS) {
    const v = env[name]?.trim();
    if (!v) add('info', 'token_unset', `${name} is not set: ${route} is disabled (503)`);
    else if (/\s/.test(v)) add('error', 'token_invalid', `${name} holds a space: no Authorization header can carry it, ${route} would refuse every call`);
    else if (v.length < MIN_TOKEN_LENGTH || new Set(v).size < 10) {
      add('error', 'token_weak', `${name} is too short or too simple to resist guessing (at least ${MIN_TOKEN_LENGTH} varied characters; generate one with: openssl rand -base64 32)`);
    }
  }
  const [importToken, vigieToken] = TOKENS.map(([name]) => env[name]?.trim());
  if (importToken && importToken === vigieToken) add('warn', 'token_shared', 'CODEX_IMPORT_TOKEN and VIGIE_WEBHOOK_TOKEN are the same: whoever holds one can call both endpoints');

  // ── Vigie and Keystone addresses (lib/vigie.ts, lib/keystone.ts) ──
  for (const name of URLS) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      // reported below
    }
    // The value is never quoted: without its scheme, an address read as "user:password@host" puts the password first.
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) add('error', 'url_invalid', `${name} is not an http(s) address: it must start with http:// or https://`);
    else if (url.username || url.password) add('error', 'url_credentials', `${name} carries a user name or a password: links built from it would show them`);
  }
  if (env.VIGIE_API_URL) {
    add('warn', 'vigie_api_not_wired', 'VIGIE_API_URL is set but Codex does not call Vigie yet: requests stay in Codex and their decisions can no longer be simulated, they must come through POST /api/integrations/vigie');
    if (!vigieToken) add('warn', 'vigie_no_webhook', 'VIGIE_API_URL is set without VIGIE_WEBHOOK_TOKEN: no decision of Vigie can reach Codex');
  }
  if (env.NEXT_PUBLIC_VIGIE_URL !== undefined && !env.NEXT_PUBLIC_VIGIE_URL.trim()) add('warn', 'url_empty', 'NEXT_PUBLIC_VIGIE_URL is empty: links to Vigie would point to Codex itself');
  if (env.NEXT_PUBLIC_KEYSTONE_URL !== undefined && !env.NEXT_PUBLIC_KEYSTONE_URL.trim()) add('warn', 'url_empty', 'NEXT_PUBLIC_KEYSTONE_URL is empty: links to Keystone would point to Codex itself');

  // ── Virus scan (lib/antivirus.ts) ──
  const clamd = env.CODEX_CLAMD?.trim();
  if (clamd) {
    if (!clamdAddressOk(clamd)) add('error', 'clamd_invalid', `CODEX_CLAMD="${withoutCredentials(clamd)}" is neither host:port nor the absolute path of a socket: every upload would be refused (or stored unscanned with CODEX_CLAMD_ON_ERROR=accept)`);
    if (env.CODEX_CLAMD_ON_ERROR?.trim().toLowerCase() === 'accept') add('warn', 'clamd_accept', 'CODEX_CLAMD_ON_ERROR=accept: a file clamd cannot scan is stored unscanned');
  } else if (production) {
    add('warn', 'clamd_off', 'CODEX_CLAMD is not set: uploaded files are stored without a virus scan');
  }
  const timeout = env.CODEX_CLAMD_TIMEOUT_MS?.trim();
  if (timeout && !(Number(timeout) > 0)) add('warn', 'clamd_timeout_invalid', `CODEX_CLAMD_TIMEOUT_MS="${timeout}" is not a number of milliseconds: 30000 applies`);
  const onError = env.CODEX_CLAMD_ON_ERROR?.trim().toLowerCase();
  if (onError && onError !== 'accept' && onError !== 'refuse') add('warn', 'clamd_on_error_invalid', `CODEX_CLAMD_ON_ERROR="${onError}" is neither refuse nor accept: refuse applies`);

  // ── Files entering Codex (lib/filetypes.ts) ──
  const mb = env.CODEX_MAX_FILE_MB?.trim();
  if (mb) {
    const n = Number(mb);
    if (!(Number.isFinite(n) && n > 0)) add('warn', 'max_file_invalid', `CODEX_MAX_FILE_MB="${mb}" is not a positive number: 50 applies`);
    else if (sharepoint && n > SHAREPOINT_MAX_FILE_MB) add('warn', 'max_file_capped', `CODEX_MAX_FILE_MB=${mb} is beyond what the SharePoint store sends: ${SHAREPOINT_MAX_FILE_MB} applies`);
  }
  const exts = env.CODEX_FILE_EXTENSIONS?.trim();
  if (exts) {
    const entries = exts.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const dropped = entries.filter((e) => {
      const dotted = e.startsWith('.') ? e : `.${e}`;
      return !/^\.[a-z0-9]{1,10}$/.test(dotted) || DENIED_EXTENSIONS.has(dotted);
    });
    if (dropped.length) add('warn', 'extensions_dropped', `CODEX_FILE_EXTENSIONS: ${dropped.slice(0, 20).join(', ')} never admitted (refused formats or not an extension)`);
    if (dropped.length === entries.length) add('warn', 'extensions_default', `CODEX_FILE_EXTENSIONS leaves no extension: the default list applies (${admittedExtensions({}).length} extensions)`);
  }

  // ── Rate limits (lib/ratelimit.ts) ──
  for (const spec of Object.values(RATE_LIMITS)) {
    const raw = env[spec.env];
    if (raw?.trim() && parseRule(raw) === undefined) add('warn', 'rate_invalid', `${spec.env}="${raw.trim()}" is not a limit: ${spec.def} applies`);
  }
  const rateOff = env.CODEX_RATE_LIMIT?.trim();
  if (rateOff && OFF.test(rateOff) && production) add('warn', 'rate_off', 'CODEX_RATE_LIMIT is off: no request is limited');

  // ── Flags read as on/off ──
  for (const name of ['CODEX_HTTPS', 'CODEX_TRUST_PROXY', 'CODEX_RATE_LIMIT']) {
    const v = env[name]?.trim();
    if (v && !ON.test(v) && !OFF.test(v)) add('warn', 'flag_invalid', `${name}="${v}" is neither 1 nor 0: ${name === 'CODEX_RATE_LIMIT' ? 'limits apply' : 'read as off'}`);
  }

  // ── Orphan files and backups (lib/orphans.ts, lib/backup-core.mjs) ──
  const grace = env.CODEX_ORPHAN_GRACE_HOURS?.trim();
  if (grace && !/^\d{1,5}$/.test(grace)) add('warn', 'orphan_grace_invalid', `CODEX_ORPHAN_GRACE_HOURS="${grace}" is not a whole number of hours: 24 applies`);
  const keep = env.CODEX_BACKUP_KEEP?.trim();
  if (keep && (!/^\d{1,4}$/.test(keep) || Number(keep) < 1)) add('warn', 'backup_keep_invalid', `CODEX_BACKUP_KEEP="${keep}" is not a whole number from 1: 7 applies`);
  if (env.CODEX_DATA_DIR !== undefined && !env.CODEX_DATA_DIR.trim()) add('warn', 'data_dir_empty', 'CODEX_DATA_DIR is empty: the database and the files go straight into the folder the server runs in');

  // ── Database server (src/db/sql-client.ts, docs/postgres.md) ──
  const dbUrl = env.DATABASE_URL?.trim();
  if (env.DATABASE_URL !== undefined && !dbUrl) add('warn', 'database_url_empty', 'DATABASE_URL is empty: the embedded database (PGlite) is used');
  else if (dbUrl && !/^postgres(ql)?:\/\/[^\s]+$/i.test(dbUrl)) add('error', 'database_url_invalid', `DATABASE_URL="${withoutCredentials(dbUrl)}" is no postgres:// or postgresql:// address`);
  const poolMax = env.CODEX_DB_POOL_MAX?.trim();
  if (poolMax && (!/^\d{1,3}$/.test(poolMax) || Number(poolMax) < 2 || Number(poolMax) > 200)) add('warn', 'pool_max_invalid', `CODEX_DB_POOL_MAX="${poolMax}" is not a whole number from 2 to 200: 10 applies`);

  // ── New database and migrations (lib/seed-mode.ts, src/db/index.ts) ──
  if (!seedModeOf(env)) add('error', 'seed_unknown', `CODEX_SEED="${env.CODEX_SEED!.trim().slice(0, 40)}" is neither demo nor minimal: a new database would be left empty and the server would not start`);
  const migBackup = env.CODEX_MIGRATION_BACKUP?.trim();
  if (migBackup && !ON.test(migBackup) && !OFF.test(migBackup)) add('warn', 'flag_invalid', `CODEX_MIGRATION_BACKUP="${migBackup}" is neither 1 nor 0: read as on (a backup before each migration)`);
  else if (migBackup && OFF.test(migBackup)) add('warn', 'migration_backup_off', 'CODEX_MIGRATION_BACKUP is off: the database is migrated without a backup first');

  // ── Technical log (lib/log.ts) and this check ──
  const level = env.CODEX_LOG_LEVEL?.trim().toLowerCase();
  if (level && !(LOG_LEVELS as string[]).includes(level)) add('warn', 'log_level_invalid', `CODEX_LOG_LEVEL="${level}" is not one of ${LOG_LEVELS.join(', ')}: info applies`);
  const format = env.CODEX_LOG_FORMAT?.trim().toLowerCase();
  if (format && format !== 'json' && format !== 'pretty') add('warn', 'log_format_invalid', `CODEX_LOG_FORMAT="${format}" is neither json nor pretty: ${production ? 'json' : 'pretty'} applies`);
  const mode = env.CODEX_CONFIG_CHECK?.trim().toLowerCase();
  if (mode && mode !== 'strict' && mode !== 'warn') add('warn', 'config_check_invalid', `CODEX_CONFIG_CHECK="${mode}" is neither strict nor warn: ${production ? 'strict' : 'warn'} applies`);

  // ── Authentication (O-02) ──
  if (production) add('warn', 'auth_simulated', 'users and roles are still simulated by a cookie (O-02, docs/decisions.md): serve Codex on a trusted network only');

  return out;
}

/** An address as a finding may quote it: no "user:password@", no query string, 80 characters at most. */
function withoutCredentials(address: string): string {
  return address.replace(/^[\s\S]*@/, '***@').replace(/[?#][\s\S]*$/, '?…').slice(0, 80);
}

/** CODEX_CLAMD as lib/antivirus.ts clamdTarget reads it: an absolute socket path, or host[:port]. */
function clamdAddressOk(address: string): boolean {
  if (address.startsWith('/')) return true;
  try {
    const url = new URL(`tcp://${address.replace(/^tcp:\/\//, '')}`);
    return !!url.hostname && !url.pathname.replace(/^\/$/, '') && !url.search && !url.hash && !url.username;
  } catch {
    return false;
  }
}

const within = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The nearest folder of `p` that exists (p itself when it does). */
async function nearestExisting(p: string): Promise<string> {
  for (let dir = p; ; dir = path.dirname(dir)) {
    if (await stat(/*turbopackIgnore: true*/ dir).then(() => true, () => false)) return dir;
    if (path.dirname(dir) === dir) return dir;
  }
}

/**
 * The checks on the file system: the data folder (database and files) must be a folder Codex can read and write, or be
 * creatable; the backups must not go inside the database or the files (lib/backup-core.mjs refuses them there).
 */
export async function checkDirectories(env: Env, cwd: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const dataDir = dataDirOf(env, cwd);
  const existing = await nearestExisting(dataDir);
  const st = await stat(/*turbopackIgnore: true*/ existing).catch(() => null);
  const usable = st?.isDirectory() && (await access(/*turbopackIgnore: true*/ existing, fsc.R_OK | fsc.W_OK | fsc.X_OK).then(() => true, () => false));
  if (!usable) {
    out.push({
      severity: 'error',
      code: 'data_dir_unwritable',
      message: existing === dataDir
        ? `CODEX_DATA_DIR ${dataDir}: not a folder Codex can read and write`
        : `CODEX_DATA_DIR ${dataDir} does not exist and cannot be created: ${existing} is not a folder Codex can write`,
    });
  } else if (existing === dataDir) {
    const files = path.join(dataDir, 'files');
    const fst = await stat(/*turbopackIgnore: true*/ files).catch(() => null);
    if (fst && !(fst.isDirectory() && (await access(/*turbopackIgnore: true*/ files, fsc.R_OK | fsc.W_OK).then(() => true, () => false)))) {
      out.push({ severity: 'error', code: 'data_dir_unwritable', message: `${files}: not a folder Codex can read and write` });
    }
  }
  const backupDir = backupDirOf(dataDir, env);
  for (const inner of [path.join(dataDir, 'pglite'), path.join(dataDir, 'files')]) {
    if (within(backupDir, inner) || within(inner, backupDir)) {
      out.push({ severity: 'warn', code: 'backup_dir_inside', message: `CODEX_BACKUP_DIR ${backupDir} overlaps ${inner}: every backup would be refused` });
      break;
    }
  }
  return out;
}

export class ConfigRefusedError extends Error {}

/**
 * The check src/instrumentation.ts runs when the server starts. A configuration refused ends the process with code 1:
 * a supervisor, and the Mac app ("Le serveur s'est arrêté au démarrage"), see the start failed. The exit waits for the
 * next turn, so that the lines written above reach a pipe first; the error is thrown too, for Next.js to stop there.
 */
export async function checkAtStart(exit: (code: number) => void = (code) => process.exit(code)): Promise<void> {
  try {
    await startupCheck(process.env, { version: await appVersion() });
  } catch (err) {
    if (!(err instanceof ConfigRefusedError)) throw err;
    process.exitCode = 1;
    setTimeout(() => exit(1), 100).unref?.();
    throw err;
  }
}

/**
 * Runs every check, writes each finding to the technical log, then a summary. Throws ConfigRefusedError when an error
 * stops the server (refuses): src/instrumentation.ts lets it end the start.
 */
export async function startupCheck(env: Env = process.env, opts: { cwd?: string; production?: boolean; version?: string | null } = {}): Promise<Finding[]> {
  const cwd = opts.cwd ?? process.cwd();
  const production = opts.production ?? env.NODE_ENV === 'production';
  const findings = [...checkConfig(env, { production }), ...(await checkDirectories(env, cwd))];
  for (const f of findings) write(f.severity, 'config', f.message, { code: f.code });
  const mode = checkMode(env, production);
  const errors = findings.filter((f) => f.severity === 'error');
  const summary = {
    version: opts.version ?? undefined,
    mode: production ? 'production' : 'development',
    check: mode,
    storage: env.CODEX_STORAGE === 'sharepoint' ? 'sharepoint' : 'local',
    dataDir: dataDirOf(env, cwd),
    antivirus: env.CODEX_CLAMD?.trim() ? 'clamd' : 'off',
    errors: errors.length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
  };
  if (errors.length && mode === 'strict') {
    write('error', 'config', 'configuration refused: Codex does not start (correct the variables above, or set CODEX_CONFIG_CHECK=warn to start anyway)', { ...summary, codes: errors.map((e) => e.code) });
    throw new ConfigRefusedError(`Codex configuration refused: ${errors.map((e) => e.code).join(', ')} (see the log above)`);
  }
  write(errors.length ? 'warn' : 'info', 'config', errors.length ? 'configuration checked: errors above, started anyway (CODEX_CONFIG_CHECK=warn)' : 'configuration checked', summary);
  return findings;
}
