import { DialogButton } from '@/components/ui/client';

/**
 * "Nouveau département" / "Nouveau site" in Administration › Organisation: opens the 'org' dialog
 * (provisional values until the organisation chart is provided).
 */
export function AddValue({ what, label, primary }: { what: 'department' | 'site'; label: string; primary?: boolean }) {
  return (
    <DialogButton spec={{ kind: 'org', what }} className={primary ? 'btn btn-primary' : 'btn btn-secondary'} icon="plus" iconSw={1.8}>
      {label}
    </DialogButton>
  );
}
