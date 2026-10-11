import type { ComponentElement } from '../types.js';

/**
 * The first pass of every hook a component's setup registered, in priority order — what commits a setup (`init`'s
 * `commit`). Two shared functions: no closure per mount (C3), and compact bytecode — a nested `for…of` over a Set
 * compiled to about 3x the bytecode, which Chrome's first render interprets for every component (R2.5).
 */
/**
 * ONE empty signal for every first pass — shared and read-only by contract, exactly as a write's signal is (see `Signal`);
 * NOT frozen, so a mistaken write behaves the same on a first pass as on any later one (vera-5a).
 */
const FIRST = {};
/** A plain loop over the one list, reading its length live: a hook a first pass registers on this owner runs too. */
export const firstPasses = (element: ComponentElement) => {
  const hooks = element._$h$;
  if (hooks !== undefined) for (let i = 0; i < hooks.length; i++) hooks[i]!.$n(FIRST, true);
};
