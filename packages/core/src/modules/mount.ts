import type { ComponentElement, HookRecord } from '../types.js';

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
const run = (hook: HookRecord) => hook.$n(FIRST, true);
const pass = (hooks: Set<HookRecord>) => hooks.forEach(run);

export const firstPasses = (element: ComponentElement) => {
  element._$h$!.forEach(pass);
};
