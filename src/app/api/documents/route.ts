import { createHash } from 'node:crypto';
import { importDocument, json } from '@/lib/importer';
import { readDocumentRequest, refused } from '@/lib/import-request';
import { currentRequest, logger, withRequestLog } from '@/lib/log';
import { limitRequest } from '@/lib/ratelimit';
import { bearerOf, checkBearer } from '@/lib/server-auth';

// Deposit API for the other applications of the group (docs/api.md, « POST /api/documents »; Arche's request CX-03 in
// REQUESTS.md): one new document per call, created as draft A.1 with its file, to be approved by a circuit as any other
// draft. Bearer token CODEX_DOCUMENTS_TOKEN and/or HMAC signature with CODEX_DOCUMENTS_SECRET (lib/server-auth.ts); the
// body and the simulation (?dryRun=1) as for the import (lib/import-request.ts). Idempotent by `sourceRef`: the same
// reference sent again answers the document it made (200), and creates nothing.
// Cursus files the records of its personnel file here with its own token (CODEX_CURSUS_TOKEN, request « lot 16 »,
// lib/records.ts): in force at once, without circuit, its SHA-256 always given; it reads and destroys them through
// /api/documents/{id}/file and /api/documents/{id}/destroy.

const SHA256 = /^[0-9a-f]{64}$/;

async function handlePost(req: Request) {
  // Cursus is told by its own token; any other caller is checked against the documents endpoint's credentials.
  const endpoint = bearerOf(req, 'cursus') ? 'cursus' : 'documents';
  const denied = checkBearer(req, endpoint);
  if (denied) return denied;
  // Counted once the token is checked: a client without it cannot spend the budget of the one holding it.
  const limited = limitRequest(req, endpoint);
  if (limited) return limited;
  const read = await readDocumentRequest(req, endpoint);
  if (read instanceof Response) return read;
  const { meta, file, dryRun } = read;

  // The SHA-256 the application computed of its file, when it gives one: checked before anything is stored, so that the
  // document Codex keeps is the one it signed or sealed (a gate file G1, G2, G3 in Arche).
  const given = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>).sha256 : undefined;
  // A record of Cursus always comes with the SHA-256 of its file: Cursus checks it again when it reads the file back.
  if (given == null && endpoint === 'cursus') return json({ error: 'validation', issues: [{ field: 'sha256', code: 'required', message: 'Empreinte SHA-256 obligatoire pour un enregistrement.' }], warnings: [] }, 400);
  if (given != null) {
    const sha = typeof given === 'string' ? given.trim().toLowerCase() : '';
    if (!SHA256.test(sha)) return json({ error: 'validation', issues: [{ field: 'sha256', code: 'invalid_value', message: 'Empreinte SHA-256 attendue : 64 caractères hexadécimaux.' }], warnings: [] }, 400);
    if (!file) return json({ error: 'validation', issues: [{ field: 'sha256', code: 'file_required', message: 'Empreinte donnée sans fichier.' }], warnings: [] }, 400);
    const actual = createHash('sha256').update(file.buf).digest('hex');
    if (actual !== sha) return json({ error: 'sha256_mismatch', expected: sha, actual }, 422);
  }

  try {
    const res = await importDocument(meta, file, { dryRun, mode: 'deposit', app: endpoint === 'cursus' ? 'cursus' : null });
    switch (res.kind) {
      case 'invalid':
        return json({ error: 'validation', issues: res.issues, warnings: res.warnings }, 400);
      case 'duplicate': {
        // The same deposit sent again (a lost answer, a retry): the document it made, nothing written.
        const href = `/documents/${encodeURIComponent(res.id)}`;
        return json({ id: res.id, href, replayed: true }, 200, { Location: href });
      }
      case 'ref_reused':
        return json({ error: 'source_ref_reused', id: res.id }, 409);
      case 'destroyed':
        // The record this reference made was destroyed by its application: never filed again under it.
        return json({ error: 'destroyed', id: res.id }, 410);
      case 'conflict':
        // Never for a deposit: a source reference (application:reference) is never a Codex ID.
        return json({ error: 'source_ref_reused', id: res.id }, 409);
      case 'file_rejected':
        return refused(res.rejection);
      case 'dry_run':
        return json({ dryRun: true, id: res.id, warnings: res.warnings }, 200);
      case 'created': {
        const href = `/documents/${encodeURIComponent(res.id)}`;
        return json({ id: res.id, revision: res.revision, version: res.version, status: res.revStatus, file: res.file, ...(res.legalHold ? { legalHold: true } : {}), href, warnings: res.warnings }, 201, { Location: href });
      }
    }
  } catch (err) {
    logger('deposit').error('deposit failed', { err });
    return json({ error: 'internal', requestId: currentRequest()?.requestId }, 500);
  }
}

export const POST = withRequestLog('/api/documents', handlePost);
