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
};

export type DismissController = {
  activate: () => void;
  deactivate: () => void;
};

/** What `useSelect` needs from its host component — functions, so attribute changes stay live. */
export type SelectConfig = {
  /** Multi mode: picking toggles membership and the menu stays open. Default single. */
  multi?: () => boolean;
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
  fallbackTrigger?: Element | undefined;
};
