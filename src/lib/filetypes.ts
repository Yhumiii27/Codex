// Stored file types the browser displays without running scripts. The file route serves only these inline
// (src/app/api/documents/[id]/file/route.ts); any other type goes out as a download, as application/octet-stream, so the
// document preview (src/app/documents/[id]/DocClient.tsx) shows only these too. No 'server-only': the preview is a
// client component.

export const INLINE_SAFE: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

export type PreviewKind = 'pdf' | 'image' | 'text';

/**
 * How the preview shows a stored file of this type (already normalised by normalizeMime); null when the file route only
 * hands it out as a download (image/vnd.dwg, image/tiff, image/svg+xml, Office files…): the preview then offers it.
 */
export function previewKind(mime: string | null | undefined): PreviewKind | null {
  if (!mime || !INLINE_SAFE.has(mime)) return null;
  return mime === 'application/pdf' ? 'pdf' : mime === 'text/plain' ? 'text' : 'image';
}
