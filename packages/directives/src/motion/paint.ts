/**
 * Paint — colour, gradients and shadows for the motion object.
 *
 * A vocabulary module: it carries its own validator and its own write path,
 * so the runtime never learns what a colour is. Nothing here is
 * interpolated. Each authored value gets a slot, the ordinary numeric curve
 * steps between slots, and the value is written as a string — **CSS
 * transitions do the animating**, which is what they are for and what this
 * pack already sets up for `inertia`.
 *
 * There is no CSS parser here, deliberately. `CSS.supports(property, value)`
 * asks the engine whether it would accept the declaration, which is both
 * smaller and more correct than anything hand-written.
 *
 * ```js
 * import { wireDirectives } from '@verajs/directives';
 * import { motion, paint } from '@verajs/directives/motion';
 * wireDirectives([motion, paint]);
 * ```
 */
import type { PropertyDef, WirableTree } from './schema.js';
import { pageProblem } from './schema.js';

/** What a GUI panel tells an author to wire to make these keys work. */
const FROM = '@verajs/directives/motion';

/**
 * Authored values, and the slot each was given. Bounded by the number of
 * *distinct* values on the page, not by elements or frames: two hundred
 * cards sharing one gradient share one slot.
 */
const values: string[] = [];
const slots = new Map<string, number>();

/** Longer than any real colour, gradient or shadow, and short enough to bound the map. */
const MAX_LENGTH = 400;

/**
 * And a bound on how *many*, which is the half that gets forgotten. A slot
 * can never be reclaimed while a curve might hold the number — the table
 * only grows, and its input is every distinct value ever *parsed*: the GUI
 * this vocabulary exists for rewrites the value on every drag of a colour
 * picker. Refusing past the bound costs an author who genuinely has more
 * than a thousand distinct paint values one animation, and says so.
 */
const MAX_VALUES = 1024;
let warnedAboutCount = false;

const define = (key: string, cssProperty: string): PropertyDef => ({
  key,
  from: FROM,
  category: 'paint',
  cssProperty,
  defaultUnit: '',
  units: [''],
  initial: 0,
  /**
   * The number on the curve is an index into `values`, and the indices one
   * element uses are not adjacent — the table is shared by every paint key
   * on the page, and deduped. Interpolating between two slots painted a
   * colour the element never mentioned, usually another element's.
   */
  discrete: true,

  parse(raw) {
    const value = raw.trim();
    if (value === '' || value.length > MAX_LENGTH) return null;

    /**
     * No `url()` — and none of its cousins. Everything else here is inert,
     * but an image reference is a *request*. The cousins are the finding:
     * `image-set("https://…" 1x)` takes bare string URLs, passes
     * `CSS.supports('background', …)`, and **fetches in all three engines**
     * with no `url(` anywhere in the value — measured. So the refusal names
     * the whole image-sourcing family: `image-set()` (and its `-webkit-`
     * alias, caught by substring), `image()`, `cross-fade()`, `element()`.
     * `paint()` stays allowed: a worklet the page registered is the page's
     * own code. The vocabulary this module documents — colours, gradients,
     * shadows — names none of these, so nothing legitimate is refused.
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
         * A page-level problem — every LATER value is refused, not this one
         * — landing in the engine's registry where a GUI reads. Append-only
         * there, so the recovery (below) announces itself rather than
         * retracting; both sentences are true at the moment each is said.
         */
        if (!warnedAboutCount) {
          warnedAboutCount = true;
          pageProblem('paint-slots-full',
            `more than ${MAX_VALUES} distinct paint values on this page; ` +
            'later ones are ignored. A slot cannot be reclaimed, so the table is capped.');
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
     * nothing. The CSS transition carries the change.
     */
    const picked = values[Math.floor(value)];
    if (picked !== undefined) node.style.setProperty(cssProperty, picked);
  },
});

/** The vocabulary rows — `wireDirectives([motion, paint])` registers them. */
export const paintRows: WirableTree = [
  define('background', 'background'),
  define('color', 'color'),
  define('border-color', 'border-color'),
  define('shadow', 'box-shadow'),
  define('text-shadow', 'text-shadow'),
  /**
   * Empty the table when nothing on the page is animating. A slot can never
   * be reclaimed *while a curve might hold the number*; with zero live
   * elements no curve exists, so the table is safe to empty whole. The
   * region layer fires this on the transition to zero elements — an editor
   * emptying and refilling the page recovers automatically, which is
   * strictly more often than the old last-instance-destroy semantics.
   */
  {
    on: 'forget',
    fn: () => {
      values.length = 0;
      slots.clear();
      /** Or a page that filled the table once would exhaust it again in silence. */
      if (warnedAboutCount) {
        warnedAboutCount = false;
        pageProblem('paint-slots-recovered', 'the paint table was emptied; earlier cap refusals no longer apply.');
      }
    },
  },
];
