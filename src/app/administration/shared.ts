import type { DialogSpec } from '@/components/dialogs/types';
import type { docTypes } from '@/db/schema';

// Helpers shared by the management screens (archivage, administration).

type TypeRow = typeof docTypes.$inferSelect;

/**
 * The 'type' dialog with every setting of a register type. `used`: documents or projects refer to it (lib/queries.ts
 * registryUsage): its code no longer changes and it cannot be deleted.
 */
export function typeSpec(x: TypeRow, used: boolean): DialogSpec {
  return {
    kind: 'type',
    type: {
      code: x.code, labelFr: x.labelFr, labelEn: x.labelEn, family: x.family, origins: x.origins, attachments: x.attachments, subtypes: x.subtypes,
      circuit: x.circuit, confAllowed: x.confAllowed, confDefault: x.confDefault, retentionYears: x.retentionYears, retentionTrigger: x.retentionTrigger,
      retentionDisposition: x.retentionDisposition, retentionBasis: x.retentionBasis, reviewMonths: x.reviewMonths, iso: x.iso,
      clientDeliverable: x.clientDeliverable, active: x.active, used,
    },
  };
}

export function countBy<T>(xs: T[], key: (x: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
