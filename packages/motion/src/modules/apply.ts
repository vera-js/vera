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
import type { PropertyDef, Unit } from './schema.js';

export interface AppliedAnimation {
  readonly property: PropertyDef;
  readonly unit: Unit;
}

/**
 * Rounds to a sane precision before it reaches the DOM. Sub-pixel noise past
 * three decimals cannot be rendered, and shorter strings mean less parsing.
 */
const format = (value: number): string => String(Math.round(value * 1000) / 1000);

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

export interface CategoryWrite {
  readonly animations: readonly AppliedAnimation[];
  /** Typed arrays are the normal case — they are pre-allocated per element. */
  readonly values: ArrayLike<number>;
}

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
 * Applies a property that is a plain CSS declaration rather than a function —
 * border radii, and anything else that sets a named property directly.
 */
export const applyProperty = (
  node: HTMLElement,
  property: PropertyDef,
  unit: Unit,
  value: number
): void | string => {
  /** A returned string is a refusal, and the caller records it. */
  if (property.apply) return property.apply(node, value);
  if (!property.cssProperty) return;
  node.style.setProperty(property.cssProperty, `${format(value)}${unit}`);
};


/**
 * Sorts an element's animations into the order the DOM should receive them.
 * Done once at element construction, not per frame.
 */
export const sortForApply = <T extends { readonly property: PropertyDef }>(
  animations: readonly T[]
): T[] => [...animations].sort((a, b) => propertyOrder(a.property) - propertyOrder(b.property));
