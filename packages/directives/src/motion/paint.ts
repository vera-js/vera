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

/** What a GUI panel tells an author to wire to make these keys work. */
const FROM = '@verajs/directives/motion';

/** Longer than any real colour, gradient or shadow. */
const MAX_LENGTH = 400;

const define = (key: string, cssProperty: string): PropertyDef => ({
  key,
  from: FROM,
  category: 'paint',
  cssProperty,
  defaultUnit: '',
  units: [''],
  initial: 0,

  parseText(raw) {
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

    /**
     * The validated TEXT is the value now (8c). The slot table this returned indices into —
     * with its MAX_VALUES cap, its can-never-reclaim lifetime rule and its two diagnostics —
     * existed because numeric curves could not carry a string. Generated keyframes can:
     * `0% { background: red } 100% { background: blue }`, and the browser blends in its own
     * colour-space rules, which is what an author writing that value meant. Deduplication is
     * the content hash's job, like every other rule.
     */
    return value;
  },
});

/** The vocabulary rows — `wireDirectives([motion, paint])` registers them. The `forget` hook the
 *  slot table needed is gone with the table: text keyframes hold nothing page-wide to reclaim. */
export const paintRows: WirableTree = [
  define('background', 'background'),
  define('color', 'color'),
  define('border-color', 'border-color'),
  define('shadow', 'box-shadow'),
  define('text-shadow', 'text-shadow'),
];
