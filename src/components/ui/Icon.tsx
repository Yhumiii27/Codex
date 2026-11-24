import type { CSSProperties } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  Archive, ArrowLeft, ArrowSquareOut, ArrowUpRight, Bell, BookmarkSimple, Buildings, CaretDown, CaretLeft, CaretRight, Check,
  CheckSquare, DotsThree, DownloadSimple, FileText, Folder, House, Info, Lock, MagnifyingGlass, Minus, Moon, PencilSimple, Plus,
  Question, ShieldCheck, Sun, UploadSimple, X,
} from '@phosphor-icons/react/dist/ssr';

// Phosphor icons (Norma § 7: the charte's icons; server-safe import from @phosphor-icons/react/dist/ssr). Codex's screens
// name an icon by its role; each role maps to one Phosphor glyph, so a screen never imports Phosphor itself.
export const ICONS = {
  doc: FileText,
  home: House,
  folder: Folder,
  search: MagnifyingGlass,
  check: CheckSquare,
  archive: Archive,
  shield: ShieldCheck,
  external: ArrowUpRight,
  openExternal: ArrowSquareOut,
  info: Info,
  bell: Bell,
  plus: Plus,
  upload: UploadSimple,
  download: DownloadSimple,
  close: X,
  back: ArrowLeft,
  more: DotsThree,
  chevronLeft: CaretLeft,
  chevronRight: CaretRight,
  chevronDown: CaretDown,
  tick: Check,
  dash: Minus,
  pen: PencilSimple,
  bookmark: BookmarkSimple,
  lock: Lock,
  help: Question,
  moon: Moon,
  sun: Sun,
  building: Buildings,
} as const satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

/** Stroke width of the former drawings (1.6 by default) → Phosphor weight. */
function weightOf(sw: number): 'light' | 'regular' | 'bold' {
  return sw <= 1.4 ? 'light' : sw >= 2.2 ? 'bold' : 'regular';
}

/** A decorative icon: the meaning is always carried by the text or the aria-label of its button. */
export function Icon({ name, size = 16, sw = 1.6, style, className }: { name: IconName; size?: number; sw?: number; style?: CSSProperties; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph size={size} weight={weightOf(sw)} style={style} className={className} aria-hidden="true" focusable="false" />;
}
