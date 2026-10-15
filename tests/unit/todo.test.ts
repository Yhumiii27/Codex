import { describe, expect, it } from 'vitest';
import { latestTodo } from '@/components/shell/todo';
import type { MyAction, Todo } from '@/lib/queries';

// « À traiter » (G19): the home's list, the sidebar badge and the bell come from one source and show the same items.
// A client navigation renders the home page again but not the layout: the shell keeps the most recent list.

const item = (key: string): MyAction => ({ key, kind: 'step', docId: key, docTitle: key, detail: key, note: null, href: '/', due: null });
const list = (at: number, n: number): Todo => ({ at, items: Array.from({ length: n }, (_, i) => item(`k${i}`)) });

describe('latestTodo (badge and bell follow the most recent list)', () => {
  it('the list the home page computed after the layout wins, until the layout is rendered again', () => {
    const layout = list(1, 5);
    const page = list(2, 6);
    expect(latestTodo(layout, null)).toBe(layout);
    expect(latestTodo(layout, page).items).toHaveLength(6);
    // An action refreshes the layout: its list is the most recent.
    expect(latestTodo(list(3, 4), page).items).toHaveLength(4);
  });

  it('a page served again from the back/forward cache does not bring an older list back', () => {
    const layout = list(3, 4);
    expect(latestTodo(layout, list(2, 6))).toBe(layout);
  });

  it('within one render the layout and the page share the same list and time: the layout’s is kept', () => {
    const layout = list(2, 6);
    expect(latestTodo(layout, { ...layout })).toBe(layout);
  });
});
