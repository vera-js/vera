/**
 * Dismissal — the "click outside or press Escape and it goes away" contract, written once so a
 * select, a menu, a tooltip and a dialog can never drift apart on it.
 *
 * Escape rides the platform's CloseWatcher where it exists — the UA stacks close requests and
 * arbitrates innermost-first, exactly as native <dialog>, and the same request arrives from
 * gestures a keydown listener never sees (Android back, screen-reader dismiss). Engines without
 * it (and jsdom) fall back to a consuming capture-phase keydown listener.
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

/** The platform's stacked close-request primitive, feature-detected once. Typed locally: it is
 *  newer than the lib.dom this repo pins. */
type CloseWatcherLike = { onclose: (() => void) | null; destroy: () => void };
const CLOSE_WATCHER = (globalThis as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;

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
     * FALLBACK PATH (no CloseWatcher — older engines, jsdom): Escape is consumed — preventDefault
     * and stopPropagation — so a page-level handler (a modal underneath) does not also act on the
     * keystroke (measured: it did). The known cost, recorded rather than overclaimed: this is an
     * outermost-capture consume, not innermost arbitration — a coexisting foreign auto popover
     * loses its Escape to us here. Engines with CloseWatcher take the branch below instead, where
     * the UA stacks close requests and arbitrates innermost-first.
     */
    event.preventDefault();
    event.stopPropagation();
    onDismiss(event);
  };

  /**
   * CLOSE-WATCHER PATH: the UA owns Escape arbitration (innermost-first, exactly like native
   * <dialog>), and the same close request also arrives from platform gestures a keydown listener
   * never sees — Android back, VoiceOver's dismiss (two-finger scrub). Two deliberate semantic
   * shifts from the fallback: the Escape KEYDOWN still propagates to the page (the platform
   * contract — dialogs behave identically), and a SYNTHETIC Escape no longer dismisses, because
   * CloseWatcher ignores untrusted events — which is why the browser suite drives this with real
   * keys (sendKeys) and jsdom exercises the fallback.
   */
  let watcher: CloseWatcherLike | null = null;

  const deactivate = () => {
    if (!active) return;
    active = false;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    watcher?.destroy();
    watcher = null;
  };

  const activate = () => {
    if (active) return;
    active = true;
    /** Capture phase, so a stopPropagation() inside unrelated UI cannot hold the region open. */
    document.addEventListener('pointerdown', onPointerDown, true);
    if (CLOSE_WATCHER) {
      watcher = new CLOSE_WATCHER();
      /** The close request carries no KeyboardEvent; a shaped one keeps the callback's contract
       *  (an event means "keyboard-like dismissal, refocus the trigger"). */
      watcher.onclose = () => onDismiss(new KeyboardEvent('keydown', { key: 'Escape' }));
    } else {
      document.addEventListener('keydown', onKeyDown, true);
    }
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
