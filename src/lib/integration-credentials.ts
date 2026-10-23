// The variables that hold the credentials of the integration endpoints (lib/server-auth.ts), apart from it so that the
// configuration check (lib/config-check.ts) reads them as the endpoints do, without loading the database.

export type Endpoint = 'import' | 'documents' | 'vigie' | 'registry';

export const ENDPOINTS: Record<Endpoint, { token: string; secret: string | null; route: string }> = {
  import: { token: 'CODEX_IMPORT_TOKEN', secret: 'CODEX_IMPORT_SECRET', route: 'POST /api/import' },
  documents: { token: 'CODEX_DOCUMENTS_TOKEN', secret: 'CODEX_DOCUMENTS_SECRET', route: 'POST /api/documents' },
  vigie: { token: 'VIGIE_WEBHOOK_TOKEN', secret: 'VIGIE_WEBHOOK_SECRET', route: 'POST /api/integrations/vigie' },
  registry: { token: 'CODEX_REGISTRY_TOKEN', secret: null, route: 'GET /api/registry' },
};

type Env = Readonly<Record<string, string | undefined>>;

/** The values of a variable and of its _NEXT, trimmed, empty ones left out. */
export function valuesOf(name: string, env: Env = process.env): string[] {
  return [...new Set([env[name], env[`${name}_NEXT`]].map((v) => v?.trim() ?? '').filter(Boolean))];
}

/** The tokens and secrets an endpoint accepts. */
export function credentialsOf(endpoint: Endpoint, env: Env = process.env): { tokens: string[]; secrets: string[] } {
  const e = ENDPOINTS[endpoint];
  return { tokens: valuesOf(e.token, env), secrets: e.secret ? valuesOf(e.secret, env) : [] };
}

export const DEFAULT_WINDOW_S = 300;

/** CODEX_SIGNATURE_WINDOW_S: seconds a signed request stays valid either way of its timestamp, 30 to 3600, 300 by default. */
export function signatureWindow(env: Env = process.env): number {
  const raw = env.CODEX_SIGNATURE_WINDOW_S?.trim();
  const n = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  return n >= 30 && n <= 3600 ? n : DEFAULT_WINDOW_S;
}
