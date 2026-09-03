/** The shared vocabulary of the behavior controllers. */

/**
 * An element that went through core's `init()`, which gives it the `_cleanups` release-on-unmount
 * set. The member is part of core's tested structural contract (mangle-exempt), not a private we
 * happen to know about.
 */
export type LifecycleElement = HTMLElement & { _cleanups?: Set<() => void> };

/** One choosable row. `value` is the identity; two options must never share one. */
export type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
  /**
   * One sentence rendered under the label, smaller and dimmer — what picking this does. Inside
   * the option's accessible name on purpose: a listbox has no aria-describedby path, and a
   * description worth showing is worth announcing. (wp-omni's design, ported contract-for-contract.)
   */
  description?: string;
  /**
   * The heading this option sits under. Consecutive options sharing a group render inside one
   * labelled `role="group"` — a real group, never a heading faked as a disabled option, which a
   * screen reader would announce as a selectable choice.
   */
  group?: string;
  /**
   * Decorative content before/after the label — a Vera template (`html\`<svg…>\``) or a plain
   * string rendered as text (an emoji, a dot). DECORATIVE BY CONTRACT: rendered `aria-hidden`,
   * so an icon can never be the only carrier of meaning. Author-supplied markup only — a string
   * from data renders as text, so content can never inject.
   */
  iconBefore?: unknown;
  iconAfter?: unknown;
};

export type DismissController = {
  activate: () => void;
  deactivate: () => void;
};

/** What `useSelect` needs from its host component — functions, so attribute changes stay live. */
export type SelectConfig = {
  /** Multi mode: picking toggles membership and the menu stays open. Default single. */
  multi?: () => boolean;
  /** Disabled: every gesture, key and typeahead no-ops; open() refuses. */
  disabled?: () => boolean;
  /** Creatable: a search string matching no option offers a create row. */
  creatable?: () => boolean;
  /** Remote filtering: `matches()` returns options untouched — the host owns narrowing them. */
  remote?: () => boolean;
  /** Called after every committed change with the new selection. */
  onChange?: (value: SelectOption[]) => void;
  /** Called when the create row is activated, with the searched label. The host decides what a
   *  created option looks like (and whether creation is async) — the controller only navigates. */
  onCreate?: (label: string) => void;
  /** Called on every search edit with the query — the host's seam for remote typeahead. */
  onSearch?: (query: string) => void;
  /**
   * Called before open/close with the intended state; returning false vetoes it — the host's
   * cancelable `beforetoggle` seam. `onToggle` reports the settled state after.
   */
  canToggle?: (next: 'open' | 'closed') => boolean;
  onToggle?: (next: 'open' | 'closed') => void;
};

/**
 * User-supplied ("assigned") nodes the controller must wire imperatively. The host's own template
 * binds its own nodes reactively; only markup the user slotted in arrives here — that split is the
 * controller's one rule (template renders ours, controller syncs theirs). `fallbackTrigger` is the
 * exception: the host's own trigger, handed over so close-with-refocus has somewhere to land when
 * nothing is slotted — the controller never stamps it (the template does).
 */
export type AssignedParts = {
  trigger?: Element | undefined;
  value?: Element | undefined;
  /** A slotted search input — wired with the same input/keydown handlers and combobox ARIA. */
  search?: Element | undefined;
  fallbackTrigger?: Element | undefined;
};
