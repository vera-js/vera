/**
 * Writes computed animation values to the DOM.
 *
 * Replaces setAnimationState.js's per-property regex surgery. That version read
 * `element.node.style.transform`, built a `new RegExp` per property per frame,
 * replaced one function inside the string, and wrote it back — N reads, N regex
 * allocations and N writes per element per frame, with the function order
 * decided by whatever order the attributes happened to be parsed in.
 *
 * Here the whole string is composed from the element's animations in schema
 * order and written once per category: no regex, no allocation beyond the
 * string itself, and a deterministic result (principle #4).
 */
import { propertyOrder } from './schema.js';
import type { PropertyDef, Unit } from './types.js';


/**
 * The slice of an animation this file needs in order to write it: which property, and the unit
 * its numbers carry. Deliberately narrower than `ElementMotion` — composing a string never wants
 * the keyframes — and structural rather than nominal, which is what lets the runtime, the
 * generator and the server pass hand their own richer element shapes to the same composer
 * without converting anything.
 */
type AppliedAnimation = {
  readonly property: PropertyDef;
  readonly unit: Unit;
};

/**
 * Rounds to a sane precision before it reaches the DOM. Sub-pixel noise past
 * three decimals cannot be rendered, and shorter strings mean less parsing.
 */
/** Exported for generation: the SAME rounding must name identical animations identically, or the
 *  content hash splits on formatting noise two writers never intended to differ on. */
export const format = (value: number): string => String(Math.round(value * 1000) / 1000);

/**
 * Composes a CSS function list — `translateY(10px) rotate(45deg)` — from every
 * animation of one category, in schema order.
 */
const composeFunctions = (
  animations: readonly AppliedAnimation[],
  values: ArrayLike<number>,
  prefix: string
): string => {
  let out = prefix;

  for (let i = 0; i < animations.length; i++) {
    const { property, unit } = animations[i]!;
    if (!property.cssFunction) continue;
    if (out !== '') out += ' ';
    out += `${property.cssFunction}(${format(values[i]!)}${unit})`;
  }

  return out;
};

/**
 * One category's worth of a frame: the animations, and the numbers evaluated for them.
 *
 * The two arrays are **positionally paired** — `values[i]` belongs to `animations[i]`, and
 * neither is keyed by property — which is why they travel as one object rather than as two
 * arguments a caller could get out of step. The values are the element's pre-allocated buffer,
 * so composing a frame allocates nothing beyond the string it returns.
 */
type CategoryWrite = {
  readonly animations: readonly AppliedAnimation[];
  /** Typed arrays are the normal case — they are pre-allocated per element. */
  readonly values: ArrayLike<number>;
};

/**
 * Composes the `transform` string for a whole category.
 *
 * Returns rather than writes, so the caller can compare against what it last
 * wrote and skip the write when nothing changed. **94% of writes are skipped**,
 * measured by `spikes/perf-audit.mjs`, which prints the ratio on every run — an
 * element sitting clamped outside its range produces the same string every
 * frame, and rounding to three decimals makes small movements produce it too
 * (principle #4: cheap guards over redundant work).
 *
 * This used to cite 81%, from a one-off measurement on the demo whose harness
 * was never kept. Both figures were true of the page each was taken on, but
 * only one of them can be checked, and an unreproducible number is a number
 * nobody can defend.
 *
 * @param prefix leading transform functions the element needs regardless —
 * `perspective(…)` for 3D properties, `translateZ(0px)` for the compositor hint
 */
export const composeTransform = (write: CategoryWrite, prefix = ''): string =>
  composeFunctions(write.animations, write.values, prefix);

/** Composes the `filter` string for a whole category. */
export const composeFilter = (write: CategoryWrite): string =>
  composeFunctions(write.animations, write.values, '');




/**
 * Sorts an element's animations into the order the DOM should receive them.
 * Done once at element construction, not per frame.
 */
export const sortForApply = <T extends { readonly property: PropertyDef }>(
  animations: readonly T[]
): T[] => [...animations].sort((a, b) => propertyOrder(a.property) - propertyOrder(b.property));
