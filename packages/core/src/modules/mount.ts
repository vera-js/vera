import type { ComponentElement } from '../types.js';

/**
 * The first pass of every hook a component's setup registered, in priority order — what commits a setup (`settle`).
 * Plain loops: no closure per mount (C3). (`mount()` and `commit`, which closed the legacy window, were removed with it
 * in R2.)
 */
export const firstPasses = (element: ComponentElement) => {
  const all = element._$h$!;
  for (let i = 0; i < all.length; i++) for (const hook of all[i]!) hook({}, true);
};
