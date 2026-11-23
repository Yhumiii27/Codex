import { NextResponse, type NextRequest } from 'next/server';

// GET /auth/refus?motif=… — why the sign-in did not open Codex. A plain page outside the shell (the shell needs a
// signed-in person), in French and English. Nothing about the person is shown.
const MOTIFS: Record<string, [string, string]> = {
  acces: ['Vous n’avez pas accès à Codex, ou votre accès n’est pas encore activé. Adressez-vous à la DSI.', 'You have no access to Codex, or your access is not activated yet. Contact the IT department.'],
  expiree: ['La connexion a expiré. Recommencez.', 'The sign-in expired. Start again.'],
  jeton: ['La réponse de Clavis n’a pas pu être vérifiée. Recommencez.', 'Clavis’s answer could not be checked. Start again.'],
  clavis: ['Clavis a refusé la connexion.', 'Clavis refused the sign-in.'],
  indisponible: ['La connexion est indisponible pour le moment. Adressez-vous à la DSI.', 'Sign-in is unavailable at the moment. Contact the IT department.'],
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function GET(req: NextRequest) {
  const [fr, en] = MOTIFS[req.nextUrl.searchParams.get('motif') ?? ''] ?? MOTIFS.indisponible;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Codex — connexion</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#1d2433}h1{font-size:20px}p{line-height:1.5}a{color:#2f5bd3}</style></head>
<body><h1>Codex</h1><p>${esc(fr)}</p><p lang="en" style="color:#5b6475">${esc(en)}</p><p><a href="/auth/connexion">Se connecter · Sign in</a></p></body></html>`;
  return new NextResponse(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
