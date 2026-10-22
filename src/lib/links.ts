import type { LinkKind, LinkRel, LinkSkip } from '@/db/schema';

// Links between documents (point 16 of docs/reste-a-faire.md, docs/modele-cible.md §4): one record per pair, oriented
// for « remplace » (source replaces target), read from either end. Pure rules; the actions check access and rights.

export const LINK_RELS = ['replaced_by', 'replaces', 'see_also'] as const satisfies readonly LinkRel[];

export function isLinkRel(x: unknown): x is LinkRel {
  return typeof x === 'string' && (LINK_RELS as readonly string[]).includes(x);
}

type Stored = { sourceId: string; targetId: string; kind: LinkKind };

/** The record that says `docId` is `rel` the other document: « remplacé par » is a `replaces` link from the other one. */
export function storedLink(docId: string, rel: LinkRel, otherId: string): Stored {
  if (rel === 'replaced_by') return { sourceId: otherId, targetId: docId, kind: 'replaces' };
  return { sourceId: docId, targetId: otherId, kind: rel };
}

/** How `docId`, one end of the link, relates to the other end. */
export function relOf(link: Stored, docId: string): LinkRel {
  if (link.kind === 'see_also') return 'see_also';
  return link.sourceId === docId ? 'replaces' : 'replaced_by';
}

/** The other end of the link, seen from `docId`. */
export function otherEnd(link: Pick<Stored, 'sourceId' | 'targetId'>, docId: string): string {
  return link.sourceId === docId ? link.targetId : link.sourceId;
}

/** The same link read from the other document. */
export function inverseRel(rel: LinkRel): LinkRel {
  return rel === 'replaces' ? 'replaced_by' : rel === 'replaced_by' ? 'replaces' : 'see_also';
}

export type LinkIssue = 'link_self' | 'link_exists' | 'link_not_withdrawn' | 'link_replacer_inactive';

type LinkEnd = { id: string; state: string; obsoleteAt: string | null };

/**
 * Why `doc` cannot be linked to `other` as `rel`, or null. Never to itself, at most one link per pair (`linked`: the
 * two documents already are, in either direction). Only a withdrawn document is replaced: Vigie decides a withdrawal
 * (D-17), never a link; a document in force is replaced through a withdrawal request naming its replacement. Withdrawn
 * means withdrawn by Vigie once (obsoleteAt), archived since or not. The document that replaces it is active, as in a
 * withdrawal request (replacementIssue): an obsolete or archived one replaces nothing.
 */
export function linkIssue(rel: LinkRel, doc: LinkEnd, other: LinkEnd, linked: boolean): LinkIssue | null {
  if (doc.id === other.id) return 'link_self';
  if (linked) return 'link_exists';
  if (rel === 'see_also') return null;
  const [replacer, replaced] = rel === 'replaces' ? [doc, other] : [other, doc];
  if (!replaced.obsoleteAt) return 'link_not_withdrawn';
  return replacer.state === 'active' ? null : 'link_replacer_inactive';
}

export type ReplacementIssue = 'replacement_not_found' | 'link_self' | 'replacement_inactive';

/**
 * Why `replacement` cannot be proposed to replace document `docId` in a withdrawal request, or null. `replacement`:
 * the document as the requester may read it, null when it does not exist or they may not read it (the same answer, so
 * that nothing tells it exists). A document obsolete or archived replaces nothing.
 */
export function replacementIssue(docId: string, replacement: { id: string; state: string } | null): ReplacementIssue | null {
  if (!replacement) return 'replacement_not_found';
  if (replacement.id === docId) return 'link_self';
  return replacement.state === 'active' ? null : 'replacement_inactive';
}

/** What becomes of the replacement proposed with a withdrawal when it applies: linked, already there, or skipped and why. */
export type ReplacementOutcome = 'link' | 'present' | LinkSkip;

/**
 * The replacement proposed with a withdrawal, checked again when Vigie's acceptance applies (lib/lifecycle.ts
 * linkReplacement), possibly long after the request. Already « remplacé par » it: nothing to do. Otherwise it is skipped
 * when the replacement no longer exists or is no longer active (it replaces nothing, as in replacementIssue), when a
 * legal hold on either document freezes their links (a « voir aussi » between them is kept), or when a « remplace »
 * link already runs the other way. Else it is linked, a « voir aussi » between the two giving way to it.
 */
export function replacementOutcome(
  docId: string,
  withdrawn: { legalHold: boolean },
  replacement: { state: string; legalHold: boolean } | null | undefined,
  current: Pick<Stored, 'sourceId' | 'kind'> | null | undefined,
): ReplacementOutcome {
  if (current?.kind === 'replaces' && current.sourceId !== docId) return 'present';
  if (!replacement || replacement.state !== 'active') return 'inactive';
  if (withdrawn.legalHold || replacement.legalHold) return 'hold';
  return current?.kind === 'replaces' ? 'linked' : 'link';
}
