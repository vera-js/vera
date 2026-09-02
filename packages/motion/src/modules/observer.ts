/**
 * Watches for DOM changes that invalidate parsed elements.
 *
 * The old implementation had three problems. It collected `childList`
 * mutations and then discarded them with a `type === 'attributes'` check, so
 * **dynamically added elements never animated** — which matters most inside an
 * editor, where blocks appear and disappear constantly. It walked `parentNode`
 * unguarded, so a detached node spun or threw. And it called `_animate()` with
 * scroll elements, a function expecting trigger-animation configs.
 */
import { ATTRIBUTE_PREFIX } from './schema.js';

export interface ObserverHandlers {
  /** An animated element was added, or one of its own attributes changed. */
  readonly onChanged: (nodes: readonly Element[]) => void;
  /** An animated element left the document. */
  readonly onRemoved: (nodes: readonly Element[]) => void;
  /**
   * Some *other* attribute changed on an animated element — `class`, `id`,
   * `aria-*`. Reported separately because it cannot alter what the element
   * animates, only whether a `data-vera-motion-when` selector still matches it. Handling
   * it as a full re-parse would tear the element down and rebuild it on every
   * class toggle, and take any attached image sequence with it.
   */
  readonly onStateChanged?: (nodes?: readonly Element[]) => void;
}

const SELECTOR = `[${ATTRIBUTE_PREFIX}]`;

const isAnimated = (node: Node): node is Element =>
  node.nodeType === 1 && (node as Element).hasAttribute(ATTRIBUTE_PREFIX);

/** The animated elements in a subtree, including its root. */
const animatedWithin = (node: Node): Element[] => {
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const found = Array.from(element.querySelectorAll(SELECTOR));
  if (element.hasAttribute(ATTRIBUTE_PREFIX)) found.unshift(element);
  return found;
};

/**
 * Watches for DOM changes that invalidate parsed elements.
 *
 * @param handlers what to do about added, removed and changed elements
 * @returns the observer, unstarted — the caller decides which roots to watch
 */
export const createMutationObserver = (handlers: ObserverHandlers): MutationObserver =>
  new MutationObserver((mutations) => {
    const changed = new Set<Element>();
    const removed = new Set<Element>();
    const state = new Set<Element>();
    /** An attribute changed somewhere a `when` selector could be reading. */
    let foreign = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          for (const element of animatedWithin(node)) changed.add(element);
        }
        for (const node of mutation.removedNodes) {
          for (const element of animatedWithin(node)) removed.add(element);
        }
        continue;
      }

      /**
       * Ignore our own writes. The runtime sets style every frame, so watching
       * it would feed the observer its own output.
       */
      /**
       * `isAnimated` asks whether the target still carries the marker — which
       * is exactly false for the mutation that *removes* it. So the one
       * gesture meaning "stop animating this element" was the one the observer
       * could never see, and the element kept animating with its last inline
       * transform. The marker's own mutation is let through regardless, and
       * the runtime then declines to re-adopt an unmarked node.
       */
      const marker = mutation.attributeName === ATTRIBUTE_PREFIX;
      if (mutation.type !== 'attributes' || mutation.attributeName === 'style') continue;

      if (!marker && !isAnimated(mutation.target)) {
        /**
         * Not ours, and not on an animated element — but a
         * `data-vera-motion-when` selector is an ordinary CSS selector and may
         * perfectly well name an ancestor: `.is-open .panel` is how anyone
         * would write "while my section is open". Skipping these outright
         * meant the element itself had to be the one that changed, so the
         * common case — a class toggled on a wrapper, or on `<body>` — never
         * re-evaluated anything.
         *
         * Which element is affected cannot be known from the mutation, so this
         * only records *that* something changed and every state-driven element
         * is re-evaluated. That is a pass over the element list per batch, not
         * per mutation, and it does no work at all for a page with no `when`.
         */
        /**
         * One of ours, on an element that is not itself animated: `stagger` is
         * exactly that, and it is the only attribute designed to live on a
         * parent. Editing it did nothing at all until something else happened
         * to re-parse the group — in the GUI that writes these attributes,
         * changing the step of a cascade simply had no effect.
         */
        if (mutation.attributeName?.startsWith(ATTRIBUTE_PREFIX)) {
          for (const element of animatedWithin(mutation.target)) changed.add(element);
        } else {
          foreign = true;
        }
        continue;
      }

      /** Our own attributes change what it animates; anything else, only whether it should. */
      if (mutation.attributeName?.startsWith(ATTRIBUTE_PREFIX)) {
        changed.add(mutation.target as Element);
      } else {
        state.add(mutation.target as Element);
      }
    }

    /**
     * An element in both sets was **moved**, not removed — a re-parent is a
     * removal and an addition in the same batch. Deciding by set membership
     * alone treated every move as a removal, so an element dragged, sorted or
     * reconciled into a different parent silently stopped animating. In a
     * block editor, which is the primary consumer, reordering does this
     * constantly.
     *
     * `isConnected` is the question actually being asked: is it still in the
     * document? If it is, keep it in `changed` so it is re-adopted against its
     * new position; if it is not, it really has gone.
     */
    for (const element of removed) {
      if (element.isConnected) removed.delete(element);
      else changed.delete(element);
    }

    for (const element of changed) state.delete(element);
    for (const element of removed) state.delete(element);

    if (changed.size) handlers.onChanged([...changed]);
    if (removed.size) handlers.onRemoved([...removed]);
    /** No argument means "re-evaluate every state-driven element". */
    if (foreign) handlers.onStateChanged?.();
    else if (state.size) handlers.onStateChanged?.([...state]);
  });

/**
 * Watches the subtree for structure and for every attribute.
 *
 * **There is deliberately no `attributeFilter`**, and an earlier version of
 * this comment claimed there was. A filter takes exact names, and neither half
 * of what this observer is for can be expressed as one: our own attributes are
 * a large generated set, and `data-vera-motion-when` selectors can key off any
 * attribute at all — `class`, `id`, `aria-expanded`, whatever the author wrote.
 *
 * The cost is a MutationRecord for every attribute change in the subtree.
 * `onStateChanged` exists precisely so that cost stays cheap: a foreign
 * attribute takes the light path — re-evaluate selectors — instead of the
 * re-parse our own attributes trigger.
 */
export const observerOptions = (): MutationObserverInit => ({
  childList: true,
  subtree: true,
  attributes: true,
});
