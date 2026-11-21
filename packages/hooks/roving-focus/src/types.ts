/** The vocabulary of `rovingFocus`. */

/** Which arrows move: `aria-orientation`'s two values, or `'both'` for a group that answers all four (a radio group). */
export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

/** How a group moves, as `nextIndex` reads it: one object, so two booleans can never be passed transposed. */
export type RovingAxis = {
  /** Which arrows move. */
  orientation: RovingOrientation;
  /** Whether the group reads right to left: Left and Right swap, Up and Down never do. */
  rtl: boolean;
  /** Whether moving past an end continues at the other. */
  wrap: boolean;
};

/** What `rovingFocus` needs from its caller: `items` and `orientation` are required. */
export type RovingOptions = {
  /**
   * The group's items, in order. Read on every key and `focusin`, so items added or removed between keys need no
   * observer; `refresh()` is for a composite that changes items while focus is elsewhere.
   */
  items: () => readonly Element[];
  /**
   * Which arrows move. Required: `aria-orientation`'s default differs by role (toolbar, tablist and menubar horizontal;
   * listbox, menu and tree vertical; a radio group answers all four), so any one default is wrong for half the widgets,
   * and the failure is a key that silently does nothing.
   */
  orientation: RovingOrientation;
  /** Whether moving past an end continues at the other. Default `true`. */
  wrap?: boolean;
  /**
   * Whether an item is passed over, read on every key (so an item disabled later is skipped from then on). Default:
   * `:disabled` items are skipped and `aria-disabled` ones stay reachable, as the APG asks.
   */
  skip?: (item: Element) => boolean;
  /** Called after an arrow, Home or End moves focus to `item` (a radio group selects on move; a toolbar does not). */
  onMove?: (item: Element) => void;
};

/** What `rovingFocus` hands back. */
export type RovingFocus = {
  /** Makes `item` the group's one tab stop and focuses it. A skipped item, or one not in `items()`, is a no-op. */
  focus: (item: Element) => void;
  /** Re-reads `items()` and gives every item its tabindex again, so the group keeps exactly one tab stop. */
  refresh: () => void;
  /** Removes both listeners and restores every tabindex the hook changed, absent ones included. Idempotent. */
  release: () => void;
};
