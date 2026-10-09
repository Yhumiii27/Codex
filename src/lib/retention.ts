import type { Disposition, RetentionTrigger } from '@/db/schema';
import { addYears } from './format';

// Retention class of a document: years counted from a trigger event (docs/modele-cible.md §8).

type RetDoc = {
  retentionYears: number | null; retentionTrigger: RetentionTrigger | string; retentionDisposition: Disposition | string;
  createdAt: string; issuedAt: string | null; obsoleteAt: string | null; archivedAt: string | null; expiresAt: string | null;
};

/** Date the trigger event happened, when Codex knows it. */
export function triggerDate(d: RetDoc): string | null {
  switch (d.retentionTrigger) {
    case 'creation': return d.createdAt;
    case 'in_force': return d.issuedAt;
    // Counted per document: from its withdrawal (Vigie), else from its archiving. Replaced revisions keep the
    // document's retention (docs/modele-cible.md §8).
    case 'superseded': return d.obsoleteAt ?? d.archivedAt;
    case 'contract_end':
    case 'expiry': return d.expiresAt;
    case 'fiscal_year_end': {
      const base = d.issuedAt ?? d.createdAt;
      return `${base.slice(0, 4)}-12-31`;
    }
    default: return null; // project end, asset life, departure: not known to Codex yet; permanent: never
  }
}

/** End of retention, or null when it is not (yet) computable or the document is kept permanently. */
export function retainUntil(d: RetDoc): string | null {
  if (d.retentionTrigger === 'permanent' || d.retentionDisposition === 'permanent' || d.retentionYears == null) return null;
  const base = triggerDate(d);
  return base ? addYears(base, d.retentionYears) : null;
}
