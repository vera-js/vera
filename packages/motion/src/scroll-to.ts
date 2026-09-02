/**
 * `@verajs/motion/scroll-to` — smooth scrolling to in-page anchors.
 *
 * A separate entry point in the same package. This is imperative navigation
 * triggered by a click, not continuous rendering driven by scroll position, and
 * the two share no state — so importing one should not drag in the other.
 *
 * Built as its own self-contained artifact, roughly a third the weight of the
 * animation runtime. A page that wants smooth anchor scrolling and no scroll
 * animation — a very common case — pays only for this.
 *
 * No figures here on purpose. `npm run build` prints them and enforces the
 * budget; a number copied into a docblock rots unread.
 *
 * The helpers both entries use (easings, a few dom readers, feature detection,
 * the frame-aligned scroll listener) are bundled into each rather than hoisted
 * into a shared chunk. That was measured, and the shared chunk lost on almost
 * every axis: an extra request on every page, to share bytes gzip was already
 * absorbing.
 */
export { createScrollTo } from './modules/createScrollTo.js';
export type { ScrollToOptions, ScrollToInstance, ScrollToProblem } from './modules/createScrollTo.js';
