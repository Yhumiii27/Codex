import 'server-only';
import { randomBytes } from 'node:crypto';
import { checkConfig } from './config-check';
import { FILES_DIR } from '@/db';
import { activeStore, FileNotFoundError, sha256Of, storeFor, type FileStore, type StoreName } from './storage';

// The storage check (npm run storage:check, scripts/codex-storage-check.mts): tries the active store end to end, as
// stageFile, nameStoredFile, the file route and discardFile use it, with a test file that is removed afterwards:
// upload under a provisional name (`_staging` on SharePoint), naming, whole read, read of a byte range, removal. It needs
// no database and touches no record. Made to try SharePoint on a tenant before it is enabled (O-01 is not decided:
// docs/exploitation.md, « Essayer SharePoint sur un tenant »); it works the same on the local store.
//
// What may stay behind: on SharePoint, the folder `_codex-check` the naming step creates (empty once the test file is
// removed); a test file whose removal failed, named in `leftover`.

export type CheckStepName = 'config' | 'probe' | 'put' | 'rename' | 'read' | 'range' | 'remove';
export type CheckStep = { step: CheckStepName; ok: boolean; ms: number; detail: string };
export type StorageCheck = { store: StoreName; ok: boolean; steps: CheckStep[]; leftover: string[] };

/** Folder, on SharePoint, the test file is named in (a document's folder otherwise). */
export const CHECK_FOLDER = '_codex-check';

/** What each step does, as the command shows it. */
export const STEP_LABELS: Record<CheckStepName, string> = {
  config: 'Configuration',
  probe: 'Accès au stockage',
  put: 'Envoi sous un nom provisoire',
  rename: 'Nommage définitif',
  read: 'Lecture complète',
  range: 'Lecture d’une plage d’octets',
  remove: 'Suppression',
};

/** A reason to look for, from the error a store throws (its HTTP status on SharePoint, its code locally). */
export function hintFor(store: StoreName, step: CheckStepName, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (store === 'local') {
    if (code === 'ENOENT') return `le dossier des fichiers ${FILES_DIR} n'existe pas : le créer, ou démarrer Codex une fois (il le crée), ou régler CODEX_DATA_DIR`;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return `le dossier des fichiers ${FILES_DIR} doit être accessible en lecture et en écriture par l'utilisateur qui lance Codex`;
    if (code === 'ENOSPC') return 'disque plein';
    return message;
  }
  if (/missing CODEX_SP_/.test(message)) return message.replace('SharePoint storage: missing', 'variable manquante :');
  if (/auth failed: (400|401)/.test(message)) return 'Entra ID refuse l\'application : vérifier CODEX_SP_TENANT_ID, CODEX_SP_CLIENT_ID et CODEX_SP_CLIENT_SECRET (secret expiré ou mal copié ?)';
  const status = Number(/: (\d{3})$/.exec(message)?.[1]);
  if (status === 401) return 'Graph refuse le jeton : la permission Sites.Selected a-t-elle reçu le consentement administrateur ?';
  if (status === 403) return 'accès refusé : l\'application doit avoir le rôle « write » sur le site de la bibliothèque (Sites.Selected), pas seulement « read »';
  if (status === 404 && step === 'probe') return 'bibliothèque introuvable : CODEX_SP_DRIVE_ID ne désigne pas une bibliothèque que l\'application peut atteindre';
  if (status === 409) return 'un fichier du même nom existe déjà (un essai précédent arrêté en route ?) : le supprimer de la bibliothèque';
  if (status === 429 || status === 503) return 'Microsoft Graph limite les appels ou n\'est pas disponible : réessayer dans quelques minutes';
  if (status === 507) return 'la bibliothèque n\'a plus de place (quota du site)';
  if (/timeout|aborted|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(`${message} ${(err as { cause?: { code?: string } })?.cause?.code ?? ''}`)) {
    return 'réseau : login.microsoftonline.com et graph.microsoft.com doivent être joignables depuis le serveur (proxy, pare-feu)';
  }
  return message;
}

/**
 * Runs the check on the active store (CODEX_STORAGE). Stops at the first step that fails, then removes what it stored.
 * `bytes`: size of the test file (a size that is not a whole number of kilobytes, as most files).
 */
export async function checkStorage(opts: { env?: NodeJS.ProcessEnv; bytes?: number } = {}): Promise<StorageCheck> {
  const env = opts.env ?? process.env;
  const name = activeStore();
  const clock = () => performance.now();
  const steps: CheckStep[] = [];
  const out: StorageCheck = { store: name, ok: false, steps, leftover: [] };

  async function step<T>(id: CheckStepName, run: () => Promise<T>, detail: (x: T) => string): Promise<T | undefined> {
    const t0 = clock();
    try {
      const x = await run();
      steps.push({ step: id, ok: true, ms: Math.round(clock() - t0), detail: detail(x) });
      return x;
    } catch (err) {
      steps.push({ step: id, ok: false, ms: Math.round(clock() - t0), detail: hintFor(name, id, err) });
      return undefined;
    }
  }

  const config = checkConfig(env, { production: false }).filter((f) => f.severity === 'error' && /^(storage_|sharepoint_)/.test(f.code));
  steps.push({ step: 'config', ok: !config.length, ms: 0, detail: config.length ? config.map((f) => f.message).join(' ; ') : name === 'sharepoint' ? 'CODEX_STORAGE=sharepoint, variables CODEX_SP_* renseignées' : `stockage local (${FILES_DIR})` });
  if (config.length) return out;

  const st: FileStore = storeFor(name);
  await step('probe', () => st.probe(), () => (name === 'sharepoint' ? 'bibliothèque atteinte' : 'dossier accessible en lecture et en écriture'));
  if (!steps.at(-1)!.ok) return out;

  // A test file of random bytes, after a line that says what it is (seen by whoever finds it left in the library).
  const head = Buffer.from(`Codex : fichier d'essai du stockage (npm run storage:check), à supprimer s'il reste.\n`);
  const size = Math.max(opts.bytes ?? 200_003, head.length + 1);
  const buf = Buffer.concat([head, randomBytes(size - head.length)]);
  const sha = sha256Of(buf);
  const created = new Set<string>();
  try {
    const key = await step('put', async () => {
      const k = await st.put(buf, 'storage-check.bin');
      created.add(k);
      return k;
    }, (k) => `${buf.length} octets${name === 'sharepoint' ? ' dans _staging' : ''} (clé ${k})`);
    if (key === undefined) return out;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const named = await step('rename', async () => {
      const k = await st.rename(key, `_CHECK_${stamp}.bin`, CHECK_FOLDER);
      created.add(k);
      return k;
    }, (k) => (name === 'sharepoint' ? `rangé dans ${CHECK_FOLDER}/_CHECK_${stamp}.bin` : `nommé ${k}`));
    if (named === undefined) return out;
    // The local store keeps the provisional name until it is removed (renameStoredFile does it once the record moved).
    if (named !== key) {
      await st.remove(key).then(() => created.delete(key), () => {});
    }

    const whole = await step('read', async () => {
      const got = await st.get(named);
      if (sha256Of(got) !== sha) throw new Error(`le fichier relu diffère de celui envoyé (${got.length} octets lus sur ${buf.length})`);
      return got.length;
    }, (n) => `${n} octets, empreinte SHA-256 identique`);
    if (whole === undefined) return out;

    const range = { start: 1000, end: Math.min(buf.length - 1, 66_535) };
    const part = await step('range', async () => {
      const src = await st.open(named, buf.length);
      const got = Buffer.from(await new Response(await src.read(range)).arrayBuffer());
      if (!got.equals(buf.subarray(range.start, range.end + 1))) throw new Error(`la plage relue diffère (${got.length} octets reçus pour ${range.end - range.start + 1})`);
      return got.length;
    }, (n) => `octets ${range.start} à ${range.end} (${n}) identiques`);
    if (part === undefined) return out;

    const removed = await step('remove', async () => {
      await st.remove(named);
      created.delete(named);
      try {
        await st.get(named);
      } catch (err) {
        if (err instanceof FileNotFoundError) return true;
        throw err;
      }
      throw new Error('le fichier est encore lisible après sa suppression');
    }, () => (name === 'sharepoint' ? `fichier supprimé (le dossier ${CHECK_FOLDER}, vide, reste)` : 'fichier supprimé'));
    out.ok = removed === true;
    return out;
  } finally {
    // Whatever failed, the test file does not stay behind (unless removing it fails too).
    for (const k of created) {
      try {
        await st.remove(k);
      } catch {
        out.leftover.push(k);
      }
    }
  }
}
