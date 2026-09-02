/**
 * `@verajs/motion/paint` — colour, gradients and shadows.
 *
 * A property module: it carries its own validator and its own write path, so the
 * runtime never learns what a colour is. Nothing here is interpolated. Each
 * authored value gets a slot, the ordinary numeric curve steps between slots,
 * and the value is written as a string — **CSS transitions do the animating**,
 * which is what they are for and what this library already sets up for
 * `inertia`.
 *
 * There is no CSS parser here, deliberately. `CSS.supports(property, value)`
 * asks the engine whether it would accept the declaration, which is both
 * smaller and more correct than anything hand-written — it understands every
 * colour space, every gradient form, and every syntax added after this was
 * written.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { paint } from '@verajs/motion/paint';
 *
 * wireMotion(paint);
 * createMotion().init();
 * ```
 *
 * Take `wireMotion` from `@verajs/motion`. This module exports a descriptor and never
 * registers itself — a module that imported its own copy of the schema would
 * write to a table the runtime never reads, and it would not throw.
 */
import type { PropertyDef, WirableTree } from './modules/schema.js';
import { pageProblem } from '@verajs/motion';

/**
 * What a GUI panel tells an author to import to make these attributes work.
 * One constant, so the specifier is one string in the bundle rather than one
 * per definition. See `PropertyDef.from`.
 */
const FROM = '@verajs/motion/paint';

/**
 * Authored values, and the slot each was given.
 *
 * Bounded by the number of *distinct* values on the page, not by elements or
 * frames: two hundred cards sharing one gradient share one slot.
 */
const values: string[] = [];
const slots = new Map<string, number>();

/** Longer than any real colour, gradient or shadow, and short enough to bound the map. */
const MAX_LENGTH = 400;

/**
 * And a bound on how *many*, which is the half that gets forgotten — recurring
 * mistake 5, in a table that had `MAX_LENGTH` and nothing else.
 *
 * A slot can never be reclaimed: the number is baked into a curve the runtime
 * has already built, and reusing one would repaint whatever still holds it in
 * the wrong colour. So the table only grows, and its input is every distinct
 * value ever *parsed* rather than every value on the page — which is the whole
 * problem, because the GUI this library exists for rewrites the attribute on
 * every drag of a colour picker. A page uses a handful; an editing session
 * mints a slot per intermediate colour, forever.
 *
 * Refusing past the bound costs an author who genuinely has more than a
 * thousand distinct paint values one animation, and says so. The value lands
 * in `rejected` like any other, so a GUI can show it.
 */
const MAX_VALUES = 1024;
/** The retraction for the cap's page problem, held so `forget` can undo it. */
let retractCountProblem: (() => void) | null = null;

const define = (attribute: string, cssProperty: string): PropertyDef => ({
  attribute,
  from: FROM,
  category: 'paint',
  cssProperty,
  defaultUnit: '',
  units: [''],
  initial: 0,
  /**
   * The number on the curve is an index into `values`, and the indices one
   * element uses are not adjacent — the table is shared by every paint
   * property on the page, and deduped, so two elements authored `red -> blue`
   * and `red -> green` take slots 0,1 and 0,2. Interpolating the second one
   * ran 0 -> 2 and floored to 1 across the middle of its range: it painted
   * blue, a colour it never mentions and the other element's.
   */
  discrete: true,

  parse(raw) {
    const value = raw.trim();
    if (value === '' || value.length > MAX_LENGTH) return null;

    /**
     * No `url()` — and none of its cousins. Everything else here is inert, but
     * an image reference is a *request* — and the runtime's origin policy
     * exists precisely so an attribute cannot reach past it. An image belongs
     * in CSS, where the page author already controls it.
     *
     * The cousins are the finding: `image-set("https://…" 1x)` takes bare
     * string URLs, passes `CSS.supports('background', …)`, and **fetches in
     * all three engines** with no `url(` anywhere in the value — measured,
     * `spikes/paint-imageset.mjs`. So the refusal names the whole
     * image-sourcing family, not the one spelling: `image-set()` (and its
     * `-webkit-` alias, caught by substring), `image()`, `cross-fade()`
     * (whose arguments are images), and `element()` (no request, but it
     * paints another element's rendering — not a colour). `paint()` stays
     * allowed: a worklet the page registered is the page's own code.
     * The vocabulary this module documents — colours, gradients, shadows —
     * names none of these, so nothing legitimate is refused.
     */
    if (/url\(|image-set\(|image\(|cross-fade\(|element\(/i.test(value)) return null;

    /** The engine is the parser. Also refuses `red; position: fixed`. */
    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(cssProperty, value)) {
      return null;
    }

    let slot = slots.get(value);
    if (slot === undefined) {
      if (values.length >= MAX_VALUES) {
        /**
         * `pageProblem`, not `console.warn`. This belongs to the page rather
         * than to one element — every later value is refused, not this one —
         * and a console is not a channel: a GUI editor renders
         * `instance.rejected`, which is where `pageProblems()` is folded in.
         * The attribute lands there anyway by returning null, but with only
         * its own name and no reason, so the one sentence that explains the
         * cap was the one thing that never arrived.
         */
        if (!retractCountProblem) {
          retractCountProblem = pageProblem(
            `more than ${MAX_VALUES} distinct paint values on this page; ` +
            'later ones are ignored. A slot cannot be reclaimed, so the table is capped.'
          );
        }
        return null;
      }
      slot = values.length;
      values.push(value);
      slots.set(value, slot);
    }
    return slot;
  },

  apply(node, value) {
    /**
     * `discrete` above is what makes the value land *on* a slot rather than
     * between two; the floor is what stops a fractional one from indexing
     * nothing. Holding at the keyframe until the next is the intent either
     * way — the CSS transition carries the change.
     */
    const picked = values[Math.floor(value)];
    if (picked !== undefined) node.style.setProperty(cssProperty, picked);
  },
});

/** Hand this to `wireMotion`. */
export const paint: WirableTree = [
  define('background', 'background'),
  define('color', 'color'),
  define('border-color', 'border-color'),
  define('shadow', 'box-shadow'),
  define('text-shadow', 'text-shadow'),
  /**
   * Empty the table when no instance is animating the page.
   *
   * A slot can never be reclaimed *while a curve might hold the number* — that
   * is what `discrete` and this whole table are built around — but when no
   * instance is live, no curve exists, so no number is held and the table is
   * safe to empty whole. Core fires this only on the transition to zero live
   * instances, which is the fact this module cannot establish for itself.
   *
   * Without it the bound was a page-lifetime condition rather than an
   * animation-level one: an editor minting a slot per colour-picker frame hit
   * 1,024, and then **every later colour was refused for the life of the
   * page** — `destroy()` and a fresh instance both left it full, so the only
   * recovery was a reload. An editor's ordinary destroy-and-rebuild now
   * recovers on its own.
   *
   * `warnedAboutCount` resets with it, or a page that filled the table once
   * would exhaust it again in silence.
   */
  {
    on: 'forget',
    fn: () => {
      values.length = 0;
      slots.clear();
      /**
       * And retract the cap's page problem, which is now false — a GUI would
       * otherwise render "the table is full" over a table that is empty.
       */
      retractCountProblem?.();
      retractCountProblem = null;
    },
  },
];
