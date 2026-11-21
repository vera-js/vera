/**
 * **`@vera-hooks/roving-focus/internal`: the first-party seam.** The pure move `rovingFocus` makes, for this library's
 * own composites that move a highlight rather than focus (an active-descendant listbox). No stability promise beyond
 * them: it joins the public surface only when an outside consumer needs it, which is an additive change.
 */
export { nextIndex } from './next-index.js';
