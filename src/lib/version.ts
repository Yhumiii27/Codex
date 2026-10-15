import { readFile } from 'node:fs/promises';
import path from 'node:path';

let cached: Promise<string | null> | undefined;

/**
 * Codex's version: the "version" of package.json, read once from the project folder the server runs in (the health
 * route, the backups' manifest). Null when it cannot be read.
 */
export function appVersion(): Promise<string | null> {
  cached ??= readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'package.json'), 'utf8')
    .then((text) => {
      const v = (JSON.parse(text) as { version?: unknown }).version;
      return typeof v === 'string' ? v : null;
    })
    .catch(() => null);
  return cached;
}
