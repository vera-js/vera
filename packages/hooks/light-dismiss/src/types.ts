/** The vocabulary of `lightDismiss`. */

/**
 * An element that went through core's `init()`, whose `_$c$` release-on-unmount set its removal
 * drains. The set exists once anything registers a cleanup (core creates it lazily), so a cleanup
 * is added through `??=`. The member is part of core's tested structural contract (mangle-exempt),
 * not a private we happen to know about.
 */
export interface LifecycleElement extends HTMLElement {
  _$c$?: Set<() => void>;
}

/**
 * What `lightDismiss` hands back — the switch a widget flips as its dismissable region opens and
 * closes. Nothing is listening until `activate`, so an idle menu costs the document nothing.
 *
 * **Both calls are idempotent and both are cheap, so call them on every open and every close**
 * rather than tracking whether they are needed: activating twice installs one set of listeners,
 * and deactivating when idle returns immediately. `activate` also re-registers `deactivate` into
 * the element's current `_$c$` set each time, which is what keeps an element that was moved
 * in the DOM (and so re-`init()`ed) from stranding document listeners when it is finally removed.
 *
 * There is no `isActive`: the state belongs to the widget that decided to open, and a second copy
 * of it here is a copy that can disagree.
 */
export type DismissController = {
  activate: () => void;
  deactivate: () => void;
};
