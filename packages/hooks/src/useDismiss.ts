/**
 * Dismissal — the "click outside or press Escape and it goes away" contract, written once so a
 * select, a menu, a tooltip and a dialog can never drift apart on it.
 *
 * Listeners are installed only while active — an idle widget costs the document nothing — and the
 * element's own subtree is recognized through `composedPath()`, so the check is correct from
 * inside a shadow root, where `event.target` would name the host and a `contains()` test would
 * lie about slotted content.
 *
 * Deactivation is registered into the element's `_cleanups` — the cross-boundary release-on-unmount
 * contract `init()` creates and `tests/core-structural-contracts.test.mjs` holds unmangled — so a
 * component removed while its menu is open never strands a document listener.
 */
import type { DismissController, LifecycleElement } from './types.js';

/**
 * @param element The component the dismissable region belongs to.
 * @param onDismiss Called on an outside pointerdown or on Escape. Escape passes the event so the
 *   caller can distinguish (and, say, refocus its trigger); an outside press passes nothing.
 * @return `activate`/`deactivate` — call them as the region opens and closes. Idempotent both ways.
 */
export const useDismiss = (element: LifecycleElement, onDismiss: (event?: KeyboardEvent) => void): DismissController => {
  let active = false;

  const onPointerDown = (event: Event) => {
    if (!event.composedPath().includes(element)) onDismiss();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    /**
     * The innermost dismissable consumes its Escape — preventDefault and stopPropagation, so a
     * page-level handler (a modal underneath) does not also act on the same keystroke (measured:
     * it did). The platform's own popovers behave this way; so do we.
     */
    event.preventDefault();
    event.stopPropagation();
    onDismiss(event);
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };

  const activate = () => {
    if (active) return;
    active = true;
    /** Capture phase, so a stopPropagation() inside unrelated UI cannot hold the region open. */
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    /**
     * Registered at ACTIVATE, into the element's CURRENT cleanup set - not once at creation.
     * init() replaces _cleanups on every re-init, so a creation-time registration lives in the
     * first connect's set only, and an element moved in the DOM then removed while open leaked
     * both document listeners (measured: a document Escape drove a detached element's controller).
     */
    element._cleanups?.add(deactivate);
  };


  return { activate, deactivate };
};
