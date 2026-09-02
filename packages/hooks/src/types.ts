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
  /** Called after every committed change with the new selection. */
  onChange?: (value: SelectOption[]) => void;
};

/**
 * User-supplied ("assigned") nodes the controller must wire imperatively. The host's own template
 * binds its own nodes reactively; only markup the user slotted in arrives here — that split is the
 * controller's one rule (template renders ours, controller syncs theirs).
 */
export type AssignedParts = {
  trigger?: Element | undefined;
  value?: Element | undefined;
};
