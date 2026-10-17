import 'server-only';
import { getDb } from '@/db';
import { openFile } from './full-export';
import { checkIntegrity, type IntegrityResult } from './integrity-core.mjs';
import { logger } from './log';

// Integrity check while the server runs (Administration › Journal d'audit › Intégrité des fichiers): every stored file
// read again and compared with the SHA-256 recorded when it entered Codex (lib/integrity-core.mjs). The same check runs
// server stopped with npm run integrity (scripts/codex-integrity.mjs). Nothing is scheduled.

const log = logger('integrity');

let running = false;

/**
 * Checks every stored file now, journaled by `userId` (action 'integrity_checked'); 'busy' while another check runs in
 * this process. Reads every file: as long as the store takes to hand them all over.
 */
export async function checkFilesNow(userId: string): Promise<IntegrityResult | 'busy'> {
  if (running) return 'busy';
  running = true;
  try {
    const db = await getDb();
    const res = await checkIntegrity({ pg: db.$client, openFile, actor: userId, by: 'app' });
    const level = res.alteredCount || res.missingCount ? 'error' : 'info';
    log[level]('files checked', {
      by: userId, checked: res.checked, bytes: res.bytes, altered: res.alteredCount || undefined, missing: res.missingCount || undefined,
      filled: res.filled || undefined, skipped: res.skipped || undefined,
    });
    return res;
  } finally {
    running = false;
  }
}
