/**
 * **`anchor(layer, target, options)`: the layer placed on its target while open** (sheets/hook-anchor.md). This file is
 * the MEASURED path, the floor (CSS anchor positioning is not Baseline): fixed positioning at coordinates from
 * `place()`, recomputed in a frame callback while open, when anything that could move the target scrolls or resizes.
 * Nothing runs while closed.
 *
 * - **The first placement is synchronous, inside `open()`**: the component shows the layer, then opens it, so no frame
 *   paints it at (0, 0).
 * - **A containing block is corrected for, not assumed away**: fixed positioning is relative to the viewport unless an
 *   ancestor has a transform, filter or paint containment. So each open places the layer at (0, 0) once, reads where it
 *   really landed and how much it was scaled, and writes every coordinate through that. Rotation and skew are out of
 *   scope.
 * - **Scroll is not composed**: a window listener never hears a scroller inside a shadow root. So while open, it listens
 *   in capture on each ShadowRoot up the target's chain, and on the window, plus `visualViewport` (the keyboard and
 *   pinch zoom shrink it, not the layout viewport).
 * - **Everything comes from the target's own window** (Phase 0 item 5's lesson): its frames, its `ResizeObserver`, its
 *   `visualViewport`.
 */
import { place } from './place.js';
import type { Anchored, AnchorOptions, Rect } from './types.js';

/** The inline properties this hook writes; `release()` restores each to what it found. */
const WRITTEN = ['position', 'left', 'top', 'margin', 'max-height', 'max-width', 'min-width', 'min-height'] as const;

export const anchor = (layer: HTMLElement, target: Element, options: AnchorOptions = {}): Anchored => {
  let active = false;
  let saved: Record<string, [string, string]> | null = null;
  let frame = 0;
  let view: (Window & typeof globalThis) | null = null;
  let roots: EventTarget[] = [];
  let observer: ResizeObserver | null = null;
  /** The containing block's offset and scale, read once per open. */
  let originX = 0;
  let originY = 0;
  let scaleX = 1;
  let scaleY = 1;

  const write = (property: string, value: string) => layer.style.setProperty(property, value);

  const viewport = (win: Window): Rect => {
    const visual = win.visualViewport;
    return visual
      ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
      : { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
  };

  const update = () => {
    frame = 0;
    if (!active || !view) return;
    if (!target.isConnected) return close();
    /** The layer's natural size: our own caps come off before it is measured. */
    for (const property of ['max-height', 'max-width', 'min-width', 'min-height']) layer.style.removeProperty(property);
    const box = layer.getBoundingClientRect();
    const rtl = view.getComputedStyle(target).direction === 'rtl';
    const placed = place(target.getBoundingClientRect(), { width: box.width, height: box.height }, viewport(view), options, rtl);
    write('left', `${(placed.x - originX) / scaleX}px`);
    write('top', `${(placed.y - originY) / scaleY}px`);
    const vertical = placed.side === 'top' || placed.side === 'bottom';
    if (placed.max !== undefined) write(vertical ? 'max-height' : 'max-width', `${placed.max / (vertical ? scaleY : scaleX)}px`);
    if (options.size === 'match') write(vertical ? 'min-width' : 'min-height', `${vertical ? placed.width / scaleX : placed.height / scaleY}px`);
    layer.setAttribute('data-placement', placed.side);
  };

  /** At most one placement per frame, however many scrolls and resizes arrive. */
  const schedule = () => {
    if (!frame && view) frame = view.requestAnimationFrame(update);
  };

  const close = () => {
    if (!active) return;
    active = false;
    if (frame && view) view.cancelAnimationFrame(frame);
    frame = 0;
    for (const root of roots) root.removeEventListener('scroll', schedule, true);
    view?.removeEventListener('resize', schedule);
    view?.visualViewport?.removeEventListener('resize', schedule);
    view?.visualViewport?.removeEventListener('scroll', schedule);
    observer?.disconnect();
    observer = null;
    roots = [];
    view = null;
    restore();
  };

  const restore = () => {
    if (!saved) return;
    for (const property of WRITTEN) {
      const [value, priority] = saved[property]!;
      if (value) layer.style.setProperty(property, value, priority);
      else layer.style.removeProperty(property);
    }
    saved = null;
    layer.removeAttribute('data-placement');
  };

  const open = () => {
    if (active) return;
    view = target.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    if (!view) return;
    active = true;
    saved = {};
    for (const property of WRITTEN) saved[property] = [layer.style.getPropertyValue(property), layer.style.getPropertyPriority(property)];
    /** Measure the containing block: at (0, 0), the layer lands at its origin, at its scale. */
    write('position', 'fixed');
    write('margin', '0');
    write('left', '0px');
    write('top', '0px');
    const origin = layer.getBoundingClientRect();
    originX = origin.left;
    originY = origin.top;
    scaleX = layer.offsetWidth ? origin.width / layer.offsetWidth : 1;
    scaleY = layer.offsetHeight ? origin.height / layer.offsetHeight : 1;
    /** Every root up the target's chain hears its own scrollers; the window hears the document's. */
    roots = [];
    for (let root = target.getRootNode(); root instanceof view.ShadowRoot; root = root.host.getRootNode()) roots.push(root);
    roots.push(view);
    for (const root of roots) root.addEventListener('scroll', schedule, { capture: true, passive: true });
    view.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('scroll', schedule);
    if (view.ResizeObserver) {
      observer = new view.ResizeObserver(schedule);
      observer.observe(target);
      observer.observe(layer);
    }
    update();
  };

  return { open, close, release: close };
};
