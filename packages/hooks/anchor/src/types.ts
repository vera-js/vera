/** The vocabulary of `anchor`: placements, the options, and the pure placement's inputs and answer. */

/** The side of the target the layer sits on; `start` and `end` are logical (they swap in right-to-left). */
export type Side = 'top' | 'bottom' | 'start' | 'end';

/** Where along that side the layer lines up. */
export type Align = 'start' | 'center' | 'end';

/** A placement: a side alone (centered) or a side and an alignment, as CSS's `position-area` names them. */
export type Placement = Side | `${Side}-${'start' | 'end'}`;

/** A rectangle in viewport coordinates (CSS pixels), as `getBoundingClientRect()` answers. */
export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** What the layer needs: its natural size. */
export type Size = {
  width: number;
  height: number;
};

/** How the layer is placed. Every member has a default. */
export type AnchorOptions = {
  /** The side and alignment to prefer; default `'bottom-start'`. */
  placement?: Placement;
  /** CSS pixels between the target and the layer; default 4. */
  offset?: number;
  /** Take the opposite side when the preferred one lacks room; default true. */
  flip?: boolean;
  /** Slide along the side to stay inside the viewport; default true. */
  shift?: boolean;
  /** CSS pixels kept clear of the viewport's edges; default 8. */
  padding?: number;
  /** `'match'`: the layer is at least as wide (or tall, on a start/end side) as the target; default `'none'`. */
  size?: 'match' | 'none';
  /** Cap the layer's block size to the room on the chosen side, so it scrolls inside; default false. */
  squeeze?: boolean;
};

/** Where the layer goes: its top-left corner, the side it took, and the caps it needs. */
export type Placed = {
  x: number;
  y: number;
  side: Side;
  /** The layer's size after `size` and `squeeze`. */
  width: number;
  height: number;
  /** Set when `squeeze` capped the layer: the most it may measure along the side's axis. */
  max?: number;
};

/** The controller `anchor()` hands back. */
export type Anchored = {
  /** Starts placing: call it right after the layer is shown. */
  open: () => void;
  /** Stops placing and removes what it wrote, leaving the layer where the page's CSS puts it. */
  close: () => void;
  /** Closes for good: every style and attribute it touched is back as it was. */
  release: () => void;
};
