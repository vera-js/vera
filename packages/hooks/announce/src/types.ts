/** `aria-live`'s two speaking values: `polite` waits for the user to pause, `assertive` interrupts. */
export type Politeness = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** Default `polite`. `assertive` interrupts the user: for errors that block them, never for progress. */
  politeness?: Politeness;
  /**
   * Announcements sharing a key within one write window collapse to the last one, and a keyed message replaces the
   * key's earlier one in the region (a count that ticks while typing keeps one node).
   */
  key?: string;
}

/** A registration made by `want()`: `release()` takes it back, and is safe to call more than once. */
export interface Wanted {
  release: () => void;
}

/**
 * **The record every copy of this hook shares, one per document**, under `Symbol.for('vera.announce')` on the document.
 * Declared for life: a field is only ever ADDED (and `v` raised); none is removed or retyped, so every copy reads every
 * version, and two copies on one page keep one region and one settle window between them.
 */
export interface AnnounceRecord {
  /** The shape's version: 2 (2 added `written`). A newer copy adds fields and raises it; an older copy reads the fields it knows. */
  v: number;
  /** The document's own regions, on `body`, by politeness. Re-created when a page emptied `body`. */
  regions: Partial<Record<Politeness, HTMLElement>>;
  /** A region inside each open modal that has spoken, by politeness: a modal makes everything outside it inert. */
  modals: WeakMap<Element, Partial<Record<Politeness, HTMLElement>>>;
  /** The labels wanted through `want()`, each with the elements that want it. */
  wanted: Map<string, Set<Element>>;
  /** The settle window's timer while one is open, else 0: exactly one copy decides a window. */
  window: number;
  /** Writes waiting for their window, by key: a later one with the same key replaces the earlier. */
  pending: Map<string, number>;
  /**
   * The message last written under each key, so a keyed write replaces it and the region holds one node per key (v2;
   * absent from a record an older copy made, and added on first use).
   */
  written?: Map<string, Element>;
}
