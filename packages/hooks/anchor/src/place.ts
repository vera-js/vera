/**
 * **The placement, as a pure function**: a target's rectangle, the layer's size, the viewport and the options in; the
 * layer's corner, side and caps out. Both of `anchor`'s paths answer to it: the measured path uses it directly, and the
 * CSS path is held to it by the differential suite (sheets/hook-anchor.md).
 *
 * **The flip rule is CSS's** (`position-try-fallbacks`): the preferred side if the layer fits there, else the opposite
 * side if it fits there, else whichever of the two has more room. It never chooses a side it was not offered.
 */
import type { Align, AnchorOptions, Placed, Rect, Side, Size } from './types.js';

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', start: 'end', end: 'start' };

/** The physical direction a logical side faces. */
const physical = (side: Side, rtl: boolean): 'top' | 'bottom' | 'left' | 'right' =>
  side === 'top' || side === 'bottom' ? side : (side === 'start') !== rtl ? 'left' : 'right';

/** The room between the target and the viewport's padded edge on one side, net of the offset. */
const roomOn = (side: Side, target: Rect, viewport: Rect, offset: number, padding: number, rtl: boolean): number => {
  switch (physical(side, rtl)) {
    case 'bottom':
      return viewport.top + viewport.height - padding - (target.top + target.height + offset);
    case 'top':
      return target.top - offset - (viewport.top + padding);
    case 'right':
      return viewport.left + viewport.width - padding - (target.left + target.width + offset);
    default:
      return target.left - offset - (viewport.left + padding);
  }
};

/** Keeps `value` within [low, high]; when the span is too small for the layer, the low edge wins. */
const clamp = (value: number, low: number, high: number) => (high < low ? low : Math.min(Math.max(value, low), high));

export const place = (target: Rect, layer: Size, viewport: Rect, options: AnchorOptions = {}, rtl = false): Placed => {
  const [preferred, alignment = 'center'] = (options.placement ?? 'bottom-start').split('-') as [Side, Align?];
  const offset = options.offset ?? 4;
  const padding = options.padding ?? 8;
  const vertical = preferred === 'top' || preferred === 'bottom';
  /** The layer's extent along the side's axis (its height on top/bottom), and across it. */
  let width = layer.width;
  let height = layer.height;
  if (options.size === 'match') {
    if (vertical) width = Math.max(width, target.width);
    else height = Math.max(height, target.height);
  }
  const along = vertical ? height : width;

  let side = preferred;
  if (options.flip ?? true) {
    const room = roomOn(preferred, target, viewport, offset, padding, rtl);
    const other = OPPOSITE[preferred];
    const otherRoom = roomOn(other, target, viewport, offset, padding, rtl);
    if (room < along && (otherRoom >= along || otherRoom > room)) side = other;
  }
  const room = roomOn(side, target, viewport, offset, padding, rtl);

  let max: number | undefined;
  if (options.squeeze && along > room) {
    max = Math.max(room, 0);
    if (vertical) height = max;
    else width = max;
  }

  const direction = physical(side, rtl);
  let x: number;
  let y: number;
  if (direction === 'top' || direction === 'bottom') {
    y = direction === 'bottom' ? target.top + target.height + offset : target.top - offset - height;
    /** Logical alignment along a horizontal edge: `start` is the left edge in LTR and the right edge in RTL. */
    const toStart = (alignment === 'start') !== rtl;
    x = alignment === 'center' ? target.left + (target.width - width) / 2 : toStart ? target.left : target.left + target.width - width;
    if (options.shift ?? true) x = clamp(x, viewport.left + padding, viewport.left + viewport.width - padding - width);
  } else {
    x = direction === 'right' ? target.left + target.width + offset : target.left - offset - width;
    y = alignment === 'center' ? target.top + (target.height - height) / 2 : alignment === 'start' ? target.top : target.top + target.height - height;
    if (options.shift ?? true) y = clamp(y, viewport.top + padding, viewport.top + viewport.height - padding - height);
  }
  return max === undefined ? { x, y, side, width, height } : { x, y, side, width, height, max };
};
