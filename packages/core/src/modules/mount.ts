import type { ComponentElement, HookCallback } from '../types.js';

/**
 * The first pass of every hook a component's setup registered, in priority order — what commits a setup (`init`'s
 * `commit`). Two shared functions: no closure per mount (C3), and compact bytecode — a nested `for…of` over a Set
 * compiled to about 3x the bytecode, which Chrome's first render interprets for every component (R2.5).
 */
const run = (hook: HookCallback) => hook({}, true);
const pass = (hooks: Set<HookCallback>) => hooks.forEach(run);

export const firstPasses = (element: ComponentElement) => {
  element._$h$!.forEach(pass);
};
