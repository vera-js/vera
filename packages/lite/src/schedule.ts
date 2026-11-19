/**
 * **When a small-tier component renders: a write queues it, and one microtask renders every queued component**, however
 * many writes landed first. No scheduler, no priorities, no tracking graph: a declared prop's setter and a signal's setter both end here.
 */
import { patch } from './patch.js';
import type { LiteElement } from './types.js';

/**
 * Module state: the component whose render function is running, so a signal read during it subscribes that component.
 * Module-level because a signal is created anywhere (a module, a setup) and must find the render reading it. An object,
 * not an exported `let`: a hot read of an exported binding is slower (CLAUDE.md).
 */
export const reading: { element: LiteElement | undefined } = { element: undefined };

/**
 * Module state: the components waiting to render, in the order they were queued. ONE microtask renders them all, and a
 * render queued DURING that flush (a parent's commit handing a child new props) joins it, so a parent and its children
 * are drawn before anything that awaited the write runs (the full tier's flush, `@verajs/core`'s, does the same). Module-level because every write,
 * from any component or signal, queues here.
 */
const pending: LiteElement[] = [];

/** Lets go of every signal `element` read: before each render (which reads afresh), and when it is retired. */
export const unlink = (element: LiteElement) => {
  if (element._$l$ !== undefined) for (const readers of element._$l$) readers.delete(element);
  element._$l$ = undefined;
};

/**
 * Renders `element` now: its render function's result, patched into its root (`patch`). Nothing for an
 * element that is not connected, or whose setup returned no render function.
 * - It is no longer queued from the moment it starts, so a write DURING its own render queues it again (and a queued
 *   entry for a render that already happened, on connect, is skipped by the flush).
 * - It subscribes only to what THIS render reads: it leaves every signal the last one read first, so a component never
 *   holds a signal it no longer reads (a long-lived shell reading a churning list's rows would otherwise grow).
 * - `reading` is restored in a `finally`, so a render that throws never leaves later reads subscribing the wrong component.
 */
export const render = (element: LiteElement) => {
  element._$u$ = false;
  const draw = element._$f$;
  if (typeof draw === 'function' && element.isConnected) {
    unlink(element);
    const outer = reading.element;
    reading.element = element;
    let result: unknown;
    try {
      result = draw();
    } finally {
      reading.element = outer;
    }
    /** Kept a CALL, never pasted in (CLAUDE.md, the one-caller rule): as this function's only caller, the minifier would substitute it here as an arrow made and invoked on every render. */
    /*@__NOINLINE__*/ patch(result, element._$r$!);
  }
};

/**
 * Renders every component still queued, walking the queue by index. One that throws is reported as its error escapes:
 * it and everything before it are consumed, and whatever remains is rendered by a fresh flush, so one failure never
 * strands the rest or renders anything twice.
 */
const flush = () => {
  let i = 0;
  try {
    for (; i < pending.length; i++) if (pending[i]!._$u$) render(pending[i]!);
  } finally {
    pending.splice(0, i + 1);
    if (pending.length !== 0) queueMicrotask(flush);
  }
};

/** Queues one render of `element`; a second write before it runs adds nothing. */
export const queue = (element: LiteElement) => {
  if (!element._$u$) {
    element._$u$ = true;
    if (pending.push(element) === 1) queueMicrotask(flush);
  }
};
