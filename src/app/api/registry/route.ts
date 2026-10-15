import { createHash } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { getDb, schema as s } from '@/db';
import { CONF_LEVELS, DICT, type TKey } from '@/lib/i18n';
import { limitRequest } from '@/lib/ratelimit';

// Register of document types, read by Keystone (docs/api.md). Read-only and open within the group network until
// real authentication is plugged in; nothing user-specific, so no session is read.

const labels = (key: string) => ({ fr: DICT.fr[key as TKey] ?? key, en: DICT.en[key as TKey] ?? key });

export async function GET(req: Request) {
  const limited = limitRequest(req, 'registry');
  if (limited) return limited;
  const db = await getDb();
  const [families, types, functions] = await Promise.all([
    db.select().from(s.families).orderBy(asc(s.families.sort)),
    db.select().from(s.docTypes).orderBy(asc(s.docTypes.sort), asc(s.docTypes.code)),
    db.select().from(s.functions).orderBy(asc(s.functions.sort)),
  ]);
  const fnBy = new Map(functions.map((f) => [f.key, f]));

  const data = {
    schema: 'codex.registry/1',
    confLevels: CONF_LEVELS.map((key) => ({ key, labels: labels(`conf_${key}`) })),
    families: families.map((f) => ({
      key: f.key,
      labels: { fr: f.labelFr, en: f.labelEn },
      group: f.grp,
      types: types.filter((t) => t.family === f.key).map((t) => t.code),
    })),
    types: types.map((t) => ({
      code: t.code,
      labels: { fr: t.labelFr, en: t.labelEn },
      family: t.family,
      origins: t.origins,
      attachments: t.attachments,
      subtypes: t.subtypes,
      /** Approval steps after the author, in order; empty = approved as soon as approval is requested. */
      circuit: t.circuit.map((key) => {
        const fn = fnBy.get(key);
        return { function: key, labels: fn ? { fr: fn.labelFr, en: fn.labelEn } : { fr: key, en: key }, scope: fn?.scope ?? null };
      }),
      retention: {
        years: t.retentionYears,
        trigger: t.retentionTrigger,
        triggerLabels: labels(`trig_${t.retentionTrigger}`),
        disposition: t.retentionDisposition,
        dispositionLabels: labels(`disp_${t.retentionDisposition}`),
        basis: t.retentionBasis,
      },
      /** Periodic review in months, null without one: the next review date of a document entering into force without one. */
      reviewMonths: t.reviewMonths,
      confAllowed: t.confAllowed,
      confDefault: t.confDefault,
      iso: t.iso,
      clientDeliverable: t.clientDeliverable,
      active: t.active,
      source: t.source,
    })),
  };

  // The ETag covers the register only, so an unchanged register answers 304 whatever the time of the request.
  const etag = `"${createHash('sha1').update(JSON.stringify(data)).digest('base64url')}"`;
  const headers = { ETag: etag, 'Cache-Control': 'public, max-age=60, must-revalidate' };
  const match = req.headers.get('if-none-match');
  if (match && match.split(',').some((x) => x.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  return Response.json({ ...data, generatedAt: new Date().toISOString() }, { headers });
}
