import type { Attachment } from '@/db/schema';

// Pure rules of document IDs and revision letters (docs/modele-cible.md §3-4), shared by the app and the seed.

export const TEMPLATE_TYPE = 'FRM';
export const TEMPLATE_CONTEXT = 'QMS';

export type IdInput = { typeCode: string; attachment: Attachment; projectCode?: string | null; programCode?: string | null; department: string };

/** CONTEXTE segment: project code, research programme, QMS for templates, otherwise the owning department. */
export function contextOf(d: IdInput): string {
  if (d.attachment === 'project' && d.projectCode) return d.projectCode;
  if (d.attachment === 'research' && d.programCode) return d.programCode;
  if (d.typeCode === TEMPLATE_TYPE) return TEMPLATE_CONTEXT;
  return d.department;
}

/** Sequence width: 3 digits within a project, programme or the template space, 4 within a department. */
export function seqWidth(d: IdInput): number {
  return (d.attachment === 'project' && d.projectCode) || (d.attachment === 'research' && d.programCode) || d.typeCode === TEMPLATE_TYPE ? 3 : 4;
}

export function formatId(d: IdInput, seq: number): string {
  return `${d.typeCode}-${contextOf(d)}-${String(seq).padStart(seqWidth(d), '0')}`;
}

/**
 * True when the ID was built for the document's current type and context: TYPE-CONTEXTE- followed by the sequence
 * number alone. Matching the prefix only would take a project ID (PRO-FIN-012-001, project FIN-012) for an ID of the
 * FIN department. The width is not checked: formatId lets a number outgrow it.
 */
export function idMatches(id: string, d: IdInput): boolean {
  const prefix = `${d.typeCode}-${contextOf(d)}-`;
  return id.startsWith(prefix) && /^[0-9]+$/.test(id.slice(prefix.length));
}

/** A, B … Z, AA, AB … */
export function nextLetter(letter: string | null | undefined): string {
  if (!letter) return 'A';
  const chars = letter.split('');
  let i = chars.length - 1;
  while (i >= 0 && chars[i] === 'Z') { chars[i] = 'A'; i--; }
  if (i < 0) return `A${chars.join('')}`;
  chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
  return chars.join('');
}

/** Letters from A up to and including `last`. */
export function lettersUpTo(last: string): string[] {
  const out: string[] = [];
  for (let l = 'A'; ; l = nextLetter(l)) {
    out.push(l);
    if (l === last || out.length > 200) return out;
  }
}

/** Approved, in force or superseded: the revision's last working version is the revision itself ("B"). */
export function isFinalStatus(status: string): boolean {
  return status === 'approved' || status === 'in_force' || status === 'superseded';
}

/** "A.2" while drafting or under review (or once cancelled), "A" once approved. */
export function revLabel(letter: string, status: string, n?: number | null): string {
  return isFinalStatus(status) ? letter : `${letter}.${n ?? 0}`;
}
