import type { DialogSpec } from '@/components/dialogs/types';
import type { Conf } from '@/db/schema';
import type { Lang } from '@/lib/i18n';

// Helpers shared by the management screens (archivage, administration).

type TypeRow = {
  code: string; labelFr: string; labelEn: string; circuit: string[]; confAllowed: Conf[]; confDefault: Conf;
  retentionYears: number | null; retentionTrigger: string; retentionDisposition: string; retentionBasis: string; reviewMonths: number | null; active: boolean;
};

/** The 'type' dialog (circuit, confidentiality, retention, periodic review of a register type). */
export function typeSpec(x: TypeRow, lang: Lang): DialogSpec {
  return {
    kind: 'type',
    type: {
      code: x.code, label: lang === 'fr' ? x.labelFr : x.labelEn, circuit: x.circuit, confAllowed: x.confAllowed, confDefault: x.confDefault,
      retentionYears: x.retentionYears, retentionTrigger: x.retentionTrigger, retentionDisposition: x.retentionDisposition,
      retentionBasis: x.retentionBasis, reviewMonths: x.reviewMonths, active: x.active,
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
