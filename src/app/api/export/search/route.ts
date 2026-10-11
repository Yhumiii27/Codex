import { getDb } from '@/db';
import { getCtx } from '@/lib/context';
import { csv, csvHeaders, csvResponse } from '@/lib/csv';
import { todayIso } from '@/lib/format';
import { audit } from '@/lib/lifecycle';
import { listSearchDocs } from '@/lib/queries';
import { parseSearch, runSearch } from '@/lib/search';

const filename = () => `codex-recherche-${todayIso()}.csv`;

/**
 * CSV of the advanced search results, same query string as /recherche (query, facets, period, order; visible documents
 * only, in the order of the screen); journaled with its criteria and size.
 */
export async function GET(req: Request) {
  const ctx = await getCtx();
  const { t } = ctx;
  const search = parseSearch(new URL(req.url).searchParams);
  const { results } = runSearch(await listSearchDocs(ctx), search);
  const rows = [
    ['ID', t.title_label, t.type, t.family, t.origin, t.attachment, t.project_program, t.department, t.site_label, t.rev_in_force, t.rev_working, t.status,
      t.owner, t.conf, t.keywords, t.modified, t.issued_at, t.effective_at, t.review_due_at, t.expires_at, t.end_date],
    ...results.map((d) => [
      d.id, d.title, d.typeLabel, d.familyLabel, d.originL, d.attachmentL, d.attachedCode, d.departmentL, d.site ? d.siteL : '',
      d.revInForce, d.workingLabel, d.statusLabel, d.owner, d.confL, d.keywords.join(', '), d.modifiedAt,
      d.issuedAt, d.effectiveAt, d.reviewDueAt, d.expiresAt,
      // ISO date when computable; "Conservation permanente" or empty otherwise.
      d.retainUntil ?? (d.untilF === '—' ? '' : d.untilF),
    ]),
  ];
  const { q, facets, period, sort } = search;
  await audit(await getDb(), ctx.user.id, 'export', { kind: 'export', id: 'search' }, '', null, {
    export: { q: q.slice(0, 500), facets, ...(period ? { period } : {}), ...(sort ? { sort } : {}), rows: results.length },
  });
  return csvResponse(csv(rows), filename());
}

/** Headers only, without running the search nor journaling an export (link checkers, download managers). */
export async function HEAD() {
  return new Response(null, { headers: csvHeaders(filename()) });
}
