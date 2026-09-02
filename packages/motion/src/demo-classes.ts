/**
 * The demo's class-toggle module — a class switched on and off by scroll
 * position, written the way a page author would write one.
 *
 * The second worked example of "write your own module", and deliberately a
 * *different shape* from `demo-gradient.ts`. That one animates numbers CSS
 * composes into a value: continuous, no side effects, nothing to undo. This
 * one has the two properties that make a module interesting:
 *
 *   - **It is discrete.** A class is on or off; there is no half a class. So
 *     `discrete: true` — the curve holds each keyframe's value across its
 *     segment instead of interpolating, exactly as `paint` does with colour
 *     slots. Whatever the class changes is then smoothed by the page's own CSS
 *     transition, which is where a class-driven effect belongs.
 *   - **It writes something the runtime cannot take back.** Core owns the
 *     inline styles it composes and restores them on teardown; it knows
 *     nothing about a class. A module that touches anything else owes the page
 *     an undo, which is what `release` and `teardown` are for — without them
 *     `destroy()` leaves the class behind on whatever element happened to be
 *     past its keyframe, and the page keeps a state nothing will ever clear.
 *
 * `owns` in the teardown insert is not optional: wiring is page-level while
 * instances are not, so a `destroy()` that ignored it would strip classes off
 * elements a second, still-live instance is driving.
 *
 * Demo-owned, like `demo.ts` — not a library entry and never built. Its own
 * file so `scripts/check-examples.js` can wire it when it validates the demo's
 * markup, the same reason `demo-gradient.ts` has one.
 */
import type { PropertyDef, WirableTree } from './modules/schema.js';

/**
 * What a panel would tell an author to import. A demo module, so it names its
 * own file rather than a package subpath. See `PropertyDef.from`.
 */
const FROM = './demo-classes.js';

/** The class this module toggles. A published module would read it from an attribute. */
const CLASS = 'is-lit';

/**
 * Every element this module has switched on, so teardown can find them again.
 *
 * A `Set` of nodes is a strong reference, which is why `release` matters as
 * much as `teardown`: an element removed from the page while lit would
 * otherwise be held here for the life of the page. `paint` and `sequence` both
 * carry the same pairing for the same reason.
 */
const lit = new Set<Element>();

const forget = (node: Element): void => {
  node.classList.remove(CLASS);
  lit.delete(node);
};

export const classes: WirableTree = [
  {
    attribute: 'lit',
    from: FROM,
    category: 'class',
    /**
     * No `cssProperty`: this property names no CSS at all and writes purely
     * through `apply`, which core supports — the plan keeps any property
     * carrying a `cssProperty` *or* an `apply`.
     */
    defaultUnit: '',
    units: [''],
    initial: 0,
    discrete: true,
    apply(node, value) {
      /**
       * `Math.round`, not a truthiness test: the value arrives from a held
       * curve, so it is already exactly a keyframe value, but rounding is what
       * makes a fractional one (a curve rebuilt across a band edge, an author
       * writing `0.5`) resolve to the nearer state rather than to "on".
       *
       * Core calls this only when the value *changes* — `lastProperties` holds
       * the last one written per property — so a scroll that stays within a
       * segment costs nothing here, and this is not a per-frame classList
       * write.
       */
      if (Math.round(value) >= 1) {
        node.classList.add(CLASS);
        lit.add(node);
      } else {
        forget(node);
      }
    },
  } satisfies PropertyDef,
  { on: 'release', fn: forget },
  { on: 'teardown', fn: (owns) => { for (const node of [...lit]) if (owns(node)) forget(node); } },
];
