import { getCtx } from '@/lib/context';
import { csv, csvResponse } from '@/lib/csv';
import { todayIso } from '@/lib/format';
import { listDocs } from '@/lib/queries';
import { parseSearch, runSearch } from '@/lib/search';

/** CSV of the advanced search results, same query string as /recherche (visible documents only). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  const { t } = ctx;
  const { q, facets } = parseSearch(Object.fromEntries(new URL(req.url).searchParams));
  const { results } = runSearch(await listDocs(ctx), q, facets);
  const rows = [
    ['ID', t.title_label, t.type, t.family, t.origin, t.attachment, t.project_program, t.department, t.rev_in_force, t.rev_working, t.status, t.owner, t.conf, t.modified, t.end_date],
    ...results.map((d) => [
      d.id, d.title, d.typeLabel, d.familyLabel, d.originL, d.attachmentL, d.attachedCode, d.departmentL,
      d.revInForce, d.workingLabel, d.statusLabel, d.owner, d.confL, d.modifiedAt,
      // ISO date when computable; "Conservation permanente" or empty otherwise.
      d.retainUntil ?? (d.untilF === '—' ? '' : d.untilF),
    ]),
  ];
  return csvResponse(csv(rows), `codex-recherche-${todayIso()}.csv`);
}
