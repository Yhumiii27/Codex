import 'server-only';
import { getDb } from '@/db';
import { openFile } from './full-export';
import { checkIntegrity, type IntegrityResult } from './integrity-core.mjs';
import { logger } from './log';

// Integrity check while the server runs (Administration › Journal d'audit › Intégrité des fichiers): every stored file
// read again and compared with the SHA-256 recorded when it entered Codex (lib/integrity-core.mjs). The same check runs
// server stopped with npm run integrity (scripts/codex-integrity.mjs). Scheduled only when CODEX_SCHEDULE_INTEGRITY says
// how often (lib/scheduler.ts).

const log = logger('integrity');

// On globalThis: the scheduler (lib/scheduler.ts) runs in the bundle of src/instrumentation.ts, apart from the Server
// Actions; both must see a run in progress.
const busy = ((globalThis as unknown as { __codexBusy?: Set<string> }).__codexBusy ??= new Set<string>());

/**
 * Checks every stored file now, journaled by `userId` (action 'integrity_checked'); 'busy' while another check runs in
 * this process. Reads every file: as long as the store takes to hand them all over.
 */
export async function checkFilesNow(userId: string): Promise<IntegrityResult | 'busy'> {
  if (busy.has('integrity')) return 'busy';
  busy.add('integrity');
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
    busy.delete('integrity');
  }
}
