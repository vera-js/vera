/**
 * Outbound notifications: the runtime telling the page what it is doing.
 *
 * Everything else in this library takes input — attributes in, styles out.
 * This is the one channel pointing the other way, and it exists because CSS
 * cannot run a page's code. Starting a video when its section arrives, or
 * driving a canvas from scroll position, has no CSS answer.
 *
 * **Two mechanisms, and the split is measured rather than stylistic.** These
 * events fire a handful of times per element per page, so a `CustomEvent` is
 * free here and buys delegation — a page can listen once on `document` instead
 * of holding the instance. Per-frame progress is a *callback* instead
 * (`onProgress`), because at 200 elements a bubbling dispatch measures about
 * **0.18ms/frame** against **0.002ms** for a call — about 6.6x the library's
 * entire frame cost, versus a tenth of it. Dispatch is not free when unlistened
 * either: with no listeners at all it still costs about 0.084ms, three times
 * the whole frame, because the event object is constructed and the propagation
 * path walked regardless.
 *
 * Quoted to two figures on purpose. The exact numbers move with the browser
 * and with how fast the frame loop itself is — they read 0.188 and 4.8x when
 * first taken and 0.179 and 4.6x a while later — and precision that rots is
 * worse than a figure that stays true.
 *
 * The ratio is now measured against the library's own frame **in the same run**
 * by `spikes/event-cost.mjs`. It was not: the denominator came from
 * `perf-audit.mjs`, on a different page, whenever someone last looked, and a
 * ratio of two numbers taken apart is not a measurement of anything.
 */
import { NAMESPACE } from './namespace.js';

/**
 * Names are derived, never written out, so the namespace has one source
 * (principle #5). `data-vm-*` attributes and `vm:*` events stay
 * in step.
 */
export const EVENTS = {
  /** The element is in the update loop: its animation can move from here on. */
  active: `${NAMESPACE}:active`,
  /**
   * The element has left the update loop, after one final pass that settled it
   * on its clamped first or last keyframe.
   *
   * Deliberately **not** `enter`/`leave`. The tracker's margin reaches half a
   * viewport beyond the viewport — further still if keyframes sit outside
   * 0-100% — so an element goes active well before anyone can see it. Naming
   * these for visibility would make them lie, and would silently over-count if
   * anyone hung analytics off them. For "did the reader see this", use an
   * `IntersectionObserver` with the threshold you actually mean.
   */
  idle: `${NAMESPACE}:idle`,
  /** A `run-once` element played through and latched. Fires once, ever. */
  complete: `${NAMESPACE}:complete`,
} as const;

export interface MotionEventDetail {
  /** Timeline position at the moment it fired: 0 entering, 1 fully left. */
  readonly progress: number;
  /**
   * The element the notification is about.
   *
   * Redundant with `event.target` on an ordinary page, and not redundant at
   * all inside a shadow root: a composed event crossing the boundary is
   * **retargeted** to the host, so a listener on `document` sees the host and
   * cannot tell which inner element fired. Measured in Chromium. Carrying the
   * element here means one way to read it that is right in both places, rather
   * than a `composedPath()[0]` incantation the docs would have to teach.
   */
  readonly element: HTMLElement;
}

/**
 * Dispatches one notification.
 *
 * Bubbling, so a page can delegate from `document`; not cancelable, because
 * there is nothing here to prevent. Composed, so a listener outside a shadow
 * root still sees events from elements inside one — the same reasoning that
 * makes the rest of the library shadow-aware.
 *
 * @param node the element the notification is about
 * @param name one of EVENTS — the type enforces it, so a misspelled event
 * cannot be dispatched into a channel nobody listens on
 * @param progress timeline position at the moment it fired
 */
export const emit = (
  node: HTMLElement,
  name: (typeof EVENTS)[keyof typeof EVENTS],
  progress: number
): void => {
  node.dispatchEvent(
    new CustomEvent<MotionEventDetail>(name, {
      bubbles: true,
      composed: true,
      detail: { progress, element: node },
    })
  );
};

/**
 * Types these events for `addEventListener`.
 *
 * Without this a consumer writing
 * `document.addEventListener(EVENTS.active, e => e.detail.element)` gets
 * "Property 'detail' does not exist on type 'Event'" and has to cast — on the
 * library's only outbound channel, which is exactly where a cast is most
 * annoying and most likely to be written wrong.
 *
 * The keys are derived from `NAMESPACE` with a template literal type rather
 * than spelled out, so the one-place-to-change rule survives into the types
 * (principle #5). Purely declarative: no runtime bytes.
 */
type MotionEventMap = {
  [K in `${typeof NAMESPACE}:${'active' | 'idle' | 'complete'}`]: CustomEvent<MotionEventDetail>;
};

declare global {
  /* eslint-disable @typescript-eslint/no-empty-object-type -- declaration merging: an empty
     interface extending MotionEventMap is the one shape TS accepts for augmenting the built-in
     event maps; a type alias cannot merge. */
  interface DocumentEventMap extends MotionEventMap {}
  interface HTMLElementEventMap extends MotionEventMap {}
  interface WindowEventMap extends MotionEventMap {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}

