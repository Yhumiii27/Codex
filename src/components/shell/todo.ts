import type { IconName } from '@/components/ui/Icon';
import type { ActionKind, Todo } from '@/lib/queries';

/** Icon of an item of « À traiter » (home, bell): a decision to take, a revision to write, a date falling due. */
export const TODO_ICON: Record<ActionKind, IconName> = { step: 'check', rejected: 'pen', eco: 'pen', graft: 'pen', draft: 'pen', review: 'info', renew: 'info' };

/**
 * The list the badge and the bell show (AppProvider): `held`, unless `given` was computed later. A client navigation
 * renders the home page again but not the layout, so the page's list may be more recent than the layout's; a later
 * render of the layout (refresh after an action) is more recent still, and a page served from the back/forward cache
 * is not.
 */
export function latestTodo(held: Todo, given: Todo | null): Todo {
  return given && given.at > held.at ? given : held;
}
