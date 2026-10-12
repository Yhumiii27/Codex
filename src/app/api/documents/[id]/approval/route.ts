import { getDb } from '@/db';
import { visaFileName, visaFooter, visaLines, type VisaRecord } from '@/lib/approval';
import { getCtx, type Ctx } from '@/lib/context';
import { audit } from '@/lib/lifecycle';
import { simplePdf } from '@/lib/pdf';
import { approvalRecord } from '@/lib/queries';

// Approval record of a revision (« fiche de visa », point 21 of docs/reste-a-faire.md): GET ?rev=B hands out a PDF,
// {ID}_{letter}_VISA.pdf, extracted from the journal, and journals it. Same answer as the file route for what the user
// may not have: a document they may not read, a revision they do not see (D-14), one never approved.

/** A revision letter: A … Z, AA … (lib/codes.ts). */
const LETTER = /^[A-Z]{1,3}$/;

const notFound = () => new Response('Not found', { status: 404 });

function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

type Found = { ctx: Ctx; docId: string; letter: string; revisionId: number; record: VisaRecord };

async function resolve(req: Request, id: string): Promise<Found | Response> {
  const letter = (new URL(req.url).searchParams.get('rev') ?? '').trim().toUpperCase();
  if (!LETTER.test(letter)) return notFound();
  const ctx = await getCtx();
  const found = await approvalRecord(ctx, safeDecode(id), letter);
  return found ? { ctx, ...found } : notFound();
}

function headers(x: Found, size: number | null): HeadersInit {
  return {
    'Content-Type': 'application/pdf',
    ...(size != null ? { 'Content-Length': String(size) } : {}),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(visaFileName(x.docId, x.letter))}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** Builds the record and journals it on its revision (D-14: its readers are those of the revision). */
export async function GET(req: Request, { params }: RouteContext<'/api/documents/[id]/approval'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return x;
  const { ctx } = x;
  const body = simplePdf(visaLines(ctx.t, ctx.lang, x.record), {
    title: `${ctx.t.visa} ${x.docId} ${ctx.t.rev_short} ${x.letter}`,
    footer: visaFooter(ctx.t, x.docId, x.letter),
  });
  await audit(await getDb(), ctx.user.id, 'visa', x.docId, x.letter, x.revisionId);
  return new Response(new Uint8Array(body), { headers: headers(x, body.length) });
}

/** Same checks and headers as GET, without building nor journaling the record (link checkers, download managers). */
export async function HEAD(req: Request, { params }: RouteContext<'/api/documents/[id]/approval'>) {
  const x = await resolve(req, (await params).id);
  if (x instanceof Response) return new Response(null, { status: x.status });
  return new Response(null, { headers: headers(x, null) });
}
