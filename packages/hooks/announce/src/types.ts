/** `aria-live`'s two speaking values: `polite` waits for the user to pause, `assertive` interrupts. */
export type Politeness = 'polite' | 'assertive';

export type AnnounceOptions = {
  /** Default `polite`. `assertive` interrupts the user: for errors that block them, never for progress. */
  politeness?: Politeness;
  /**
   * Announcements sharing a key within one write window collapse to the last one, and a keyed message replaces the
   * key's earlier one in the region (a count that ticks while typing keeps one node).
   */
  key?: string;
};

export type WantOptions = {
  /** Said once when the label ends (a settle window after its last holder is released or gone), if it was said at all. */
  done?: string;
};

/** A registration made by `want()`: `release()` takes it back, and is safe to call more than once. */
export type Wanted = {
  release: () => void;
};

/**
 * **The record every copy of this hook shares, one per document**, under `Symbol.for('vera.announce')` on the document.
 * Declared for life: a field is only ever ADDED (and `v` raised); none is removed or retyped, so every copy reads every
 * version, and two copies on one page keep one region and one settle window between them.
 */
export type AnnounceRecord = {
  /** The shape's version: 2. A newer copy adds fields and raises it; an older copy reads the fields it knows. */
  v: number;
  /** The document's own regions, on `body`, by politeness. Re-created when a page emptied `body`. */
  regions: Partial<Record<Politeness, HTMLElement>>;
  /** A region inside each open modal that has spoken, by politeness: a modal makes everything outside it inert. */
  modals: WeakMap<Element, Partial<Record<Politeness, HTMLElement>>>;
  /** The labels wanted through `want()`, each with the elements that want it. */
  wanted: Map<string, Set<Element>>;
  /** The settle window's timer while one is open, else 0: exactly one copy decides a window. */
  window: number;
  /** The message last written under each key, so a keyed write replaces it and the region holds one node per key. */
  written: Map<string, Element>;
  /**
   * The messages waiting for their region, in call order, by politeness: one timer writes them all, so a message is
   * never spoken before one asked for earlier (a first write waits longer than the next).
   */
  queue: Partial<Record<Politeness, Queued[]>>;
  /** The timer that will write each politeness's queue while one is armed, else 0 or absent. */
  flush: Partial<Record<Politeness, number>>;
  /** v2: the labels said and not yet ended, each one load however many elements hold it. */
  said: Map<string, Said>;
  /** v2: the done text for a label still waiting in `wanted`, the first one given. */
  doneFor: Map<string, string>;
  /** v2: what closes a settle window, the newest copy's: every copy's timer calls it. */
  settle: (record: AnnounceRecord) => void;
};

/**
 * A said label: the elements holding it, its done text, the element it was said from, its grace timer (else 0), and
 * whether an element joined it while none held it, for the next window's close to decide.
 */
export type Said = {
  holders: Set<Element>;
  done: string | undefined;
  by: Element;
  end: number;
  stale: boolean;
};

/** One message waiting in a queue: its text, and its key when it has one. */
export type Queued = {
  text: string;
  key: string | undefined;
};
