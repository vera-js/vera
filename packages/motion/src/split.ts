/**
 * `@verajs/motion/split` — animate a line, word or character at a time.
 *
 * A module that rewrites the DOM rather than adding a property. It runs at the
 * `prepare` insert point, before the runtime collects anything, so the pieces
 * it creates are found by the ordinary scan and nothing downstream knows they
 * were not written by hand.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { split } from '@verajs/motion/split';
 *
 * wireMotion(split);
 * createMotion().init();
 * ```
 *
 * Being wired rather than fetched on demand makes it **synchronous**, which
 * removes a whole class of problem the on-demand version had: a chunk landing
 * after `disable()`, a chunk landing after `destroy()`, an element split twice
 * because two paths raced. There is no in-flight window any more.
 *
 * Take `wireMotion` from `@verajs/motion` — this module exports a descriptor
 * and never registers itself.
 */
import { createSplit, CONTAINER_SETTINGS } from './modules/split.js';
import { ATTRIBUTE_PREFIX } from './modules/namespace.js';
import { reject } from '@verajs/motion';
import type { Insert, SettingDef, Wirable } from './modules/schema.js';

/**
 * What a GUI panel tells an author to import to make these attributes work.
 * One constant, so the specifier is one string in the bundle rather than one
 * per definition. See `PropertyDef.from`.
 */
const FROM = '@verajs/motion/split';

const SPLIT_ATTRIBUTE = `${ATTRIBUTE_PREFIX}-split`;
const MODES = ['chars', 'words', 'lines'] as const;

/** Live splits, keyed by the element that was split, so each can be put back. */
/**
 * What is split, and **which mode it was split with**.
 *
 * The mode is held because `prepare` skipped any node already in this map, so
 * changing `data-vera-motion-split` from `words` to `chars` did nothing at
 * all — the pieces stayed words and nothing was reported. That is the GUI-editor
 * GUI's own action: it writes these attributes, and an author switching the
 * mode saw no change. The same shape as the recorded `stagger` bug,
 * where editing the step of a cascade had no effect until something else
 * happened to re-parse.
 */
const live = new Map<Element, { mode: string; split: { destroy(): void } }>();

/**
 * Whether a split container is carrying animation attributes again. The split moves them all
 * onto the pieces, so a clean steady state has none — any present now were put there *after*
 * the split, by hand or by an editor, and until 2026-09-01 they matched the same-mode skip
 * and were accepted in silence: reached no piece, did nothing, said nothing. Mode and
 * attributes are the two inputs a split is built from; both trigger the redo now.
 */
const editedSinceSplit = (node: Element): boolean =>
  node
    .getAttributeNames()
    .some((name) => name.startsWith(`${ATTRIBUTE_PREFIX}-`) && !CONTAINER_SETTINGS.has(name));

const restore = (node: Element): void => {
  live.get(node)?.split.destroy();
  live.delete(node);
};

/** Hand this to `wireMotion`. */
export const split: readonly Wirable[] = [
  /**
   * The setting is declared by the module that implements it. Without this the
   * runtime would report `data-vera-motion-split` as an unknown attribute on
   * every element that used it — correctly, since nothing would know it.
   */
  /**
   * The pieces inherit the element's animation attributes and the element
   * keeps `stagger`, so a cascade needs nothing new.
   */
  { attribute: 'split', from: FROM, type: 'string', allowed: [...MODES] } as SettingDef,

  {
    on: 'prepare',
    fn: (root, enabled) => {
      /** Nothing to gain from splitting text that will not animate. */
      if (!enabled) return;
      for (const node of root.querySelectorAll(`[${SPLIT_ATTRIBUTE}]`)) {
        const mode = node.getAttribute(SPLIT_ATTRIBUTE);
        /**
         * A mode this module does not know is a typo, and it was skipped in
         * silence. The schema refuses it for a *marked* container, because
         * `split` is registered with an `allowed` list — but a container's
         * bare marker is optional, and the ordinary spelling has none, so
         * nothing parsed it and nothing said anything. `split="word"` left the
         * paragraph whole with no reason given anywhere.
         */
        if (
          mode !== null && mode !== '' && !(MODES as readonly string[]).includes(mode) &&
          /**
           * Only where core will not have said it already. `split` is
           * registered with an `allowed` list, so a *marked* container has its
           * value refused by the schema — measured, for a marked container
           * both with and without other attributes. Refusing again there put
           * one mistake in `rejected` twice, in two wordings, which is what a
           * GUI renders side by side. The gap this covers is exactly the
           * unmarked container: the bare marker is optional and the ordinary
           * spelling has none, so nothing parses the attribute and nothing
           * would say anything at all.
           */
          !node.hasAttribute(ATTRIBUTE_PREFIX)
        ) {
          reject(node, `${SPLIT_ATTRIBUTE}="${mode}" is not one of ${MODES.join(', ')}.`);
        }
        if (!mode || !(MODES as readonly string[]).includes(mode)) continue;
        const already = live.get(node);
        if (already) {
          /**
           * Same mode **and no new attributes on the container** — nothing to do. A different
           * mode, or an animation attribute the author has put on the container since the
           * split, means undo and redo. The author's fresh values are captured first and
           * re-applied after the restore, because `destroy()` puts the *old* attributes back
           * and an edit must not be overwritten by the value it replaced.
           */
          if (already.mode === mode && !editedSinceSplit(node)) continue;
          const fresh = node
            .getAttributeNames()
            .filter((name) => name.startsWith(`${ATTRIBUTE_PREFIX}-`) && !CONTAINER_SETTINGS.has(name))
            .map((name) => [name, node.getAttribute(name) ?? ''] as const);
          restore(node);
          for (const [name, value] of fresh) node.setAttribute(name, value);
        }
        /**
         * Nothing for the pieces to inherit.
         *
         * A split copies the element's animation attributes onto every piece —
         * that is the whole mechanism, and the reference says so. With none to
         * copy it produced spans that animate nothing, hid every one of them
         * behind `aria-hidden`, and moved the text onto the container as an
         * `aria-label`: an accessibility restructure bought with nothing at
         * all, in silence.
         *
         * This module's own `prepare` already declines to split when nothing
         * will animate — `if (!enabled) return`, on the grounds that
         * "`aria-hidden` spans for an animation that will not run are pure
         * cost". Per element that reasoning was never applied, and per element
         * is where an author makes the mistake.
         *
         * A string test rather than a schema one, because that is exactly how
         * `createSplit` decides what to copy: any `data-vera-motion-*` other
         * than `split` and `stagger`. Asking the schema here would need a
         * runtime import of it, which is the thing every module avoids.
         */
        if (!node.getAttributeNames().some(
          (name) => name.startsWith(`${ATTRIBUTE_PREFIX}-`) && !CONTAINER_SETTINGS.has(name)
        )) {
          reject(node, `${SPLIT_ATTRIBUTE} has nothing to animate — the pieces inherit this ` +
            'element\'s animation attributes and it has none, so splitting it only hides its text ' +
            'from assistive technology.');
          continue;
        }
        const made = createSplit(node as HTMLElement, mode as (typeof MODES)[number]);
        if (made) live.set(node, { mode, split: made });
      }
    },
  } as Insert,

  { on: 'release', fn: restore } as Insert,

  {
    on: 'teardown',
    fn: (owns) => {
      for (const node of [...live.keys()]) if (owns(node)) restore(node);
    },
  } as Insert,
];
