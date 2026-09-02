/**
 * Feature detection. Unsupported means do nothing and leave content readable.
 *
 * Named exports, deliberately — this was a default-exported object bag until 2026-09-01, and an
 * object's property names are outside the minifier's reach: `prefersReducedMotion` shipped
 * verbatim at every call site. Named imports rename freely.
 */
export const supports = (): boolean =>
  /**
   * **The absent-DOM case first**, because this is the function both entry
   * points ask "is there a browser here" — and it threw `document is not
   * defined` answering it, out of `init()` on a server. Every caller treats
   * `false` as "do nothing and leave the content alone", which is exactly the
   * right server-side behaviour; the throw turned an inert instance into a
   * failed render.
   */
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  'querySelector' in document &&
  'addEventListener' in window &&
  'requestAnimationFrame' in window &&
  'closest' in window.Element.prototype;

/** Whether live DOM watching is available; without it, `collect()` is the manual catch-up. */
export const supportsMutationObserver = (): boolean =>
  typeof window !== 'undefined' && 'MutationObserver' in window;

/**
 * A coarse primary pointer — a finger, not a mouse.
 *
 * `(pointer: coarse)` rather than sniffing for touch events. The old
 * `isTouchScreen` used `document.createEvent('TouchEvent')`, which answers
 * "does this browser know what a touch is", not "is the person using one" —
 * a laptop with a touchscreen and a trackpad passes it. This asks about the
 * *primary input device*, which is the question worth asking, and it changes
 * live when an iPad gains a trackpad.
 */
const COARSE_POINTER = '(pointer: coarse)';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The visitor's current reduced-motion preference, sampled once. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(REDUCED_MOTION).matches;

/** Whether the primary pointer is a finger, sampled once. */
export const prefersCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(COARSE_POINTER).matches;

/**
 * Watches either media query, and returns a teardown.
 *
 * One helper for both, because reduced motion and pointer type are the same
 * shape of question — a live preference the visitor can change while the page
 * is open (principle #5).
 */
const watchMedia = (query: string, handler: (matches: boolean) => void): (() => void) => {
  if (typeof window === 'undefined' || !('matchMedia' in window)) return () => {};
  const list = window.matchMedia(query);
  /** Safari only gained addEventListener here in 14; without it, sample-once stands. */
  if (typeof list?.addEventListener !== 'function') return () => {};
  const listener = (event: MediaQueryListEvent) => handler(event.matches);
  list.addEventListener('change', listener);
  return () => list.removeEventListener('change', listener);
};

/** Watches the reduced-motion preference; returns a teardown. */
export const onReducedMotionChange = (handler: (reduced: boolean) => void): (() => void) =>
  watchMedia(REDUCED_MOTION, handler);

/** Watches the pointer-type preference; returns a teardown. */
export const onCoarsePointerChange = (handler: (coarse: boolean) => void): (() => void) =>
  watchMedia(COARSE_POINTER, handler);

