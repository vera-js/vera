import type { AnnounceOptions, AnnounceRecord, Politeness, Wanted } from './types.js';

/**
 * **The one cross-copy key** (declared for life, like `vera.uid`): the record lives on the DOCUMENT, never on
 * `globalThis`, so an iframe and a popped-out window each get their own, and two copies of this hook on one page share
 * one region. Two copies that each made a region would speak every announcement twice.
 */
const RECORD = Symbol.for('vera.announce');

/** The settle window `want()` waits before it speaks: a load that finishes inside it says nothing. */
const SETTLE_MS = 150;
/** The write after a clear: a later task, so the same text said twice is heard twice (an unchanged node is not read). */
const WRITE_MS = 50;
/**
 * The first write into a region just created waits longer: a live region written within about a frame of its
 * insertion is not reliably spoken (the screen reader has not registered it yet).
 */
const FIRST_WRITE_MS = 100;

type Holder = Document & { [RECORD]?: AnnounceRecord };

/** This document's record, made on first use. A newer copy's record is read as-is: its fields only ever grow. */
const recordOf = (doc: Document): AnnounceRecord =>
  ((doc as Holder)[RECORD] ??= { v: 1, regions: {}, modals: new WeakMap(), wanted: new Map(), window: 0, pending: new Map() });

/**
 * **The topmost open modal, computed at each write** (never cached, so no listener and no tracking): the open `:modal`
 * that contains the focused element (`showModal()` moves focus into the dialog it opens, on every engine), else the last
 * in tree order, else none. `:modal` matches every open modal, and top-layer order cannot be queried. A focused element
 * in a user's shadow root reports its host, so containment still holds. Limit: with focus fallen to `body` and an
 * earlier-in-the-tree dialog opened last, the tree-order answer can be the lower one.
 */
const topModal = (doc: Document): Element | null => {
  let modals: NodeListOf<Element>;
  try {
    modals = doc.querySelectorAll(':modal');
  } catch {
    /** An engine (or jsdom) without `:modal`: no modal can be found, so the body's region serves. */
    return null;
  }
  if (modals.length === 0) return null;
  const focused = doc.activeElement;
  for (const modal of modals) if (focused !== null && modal.contains(focused)) return modal;
  return modals[modals.length - 1];
};

/** A visually hidden live region: kept in the accessibility tree (never `display: none`, which silences it). */
const makeRegion = (doc: Document, politeness: Politeness): HTMLElement => {
  const region = doc.createElement('div');
  region.setAttribute('aria-live', politeness);
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('data-vera-announce', politeness);
  region.style.cssText =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  return region;
};

/**
 * The region to speak into, and whether it was just made: inside the topmost modal while one is open (everything outside
 * it is inert, and an inert region is not spoken), else on `body`. A region a page removed (an SPA emptying `body`) is
 * made again into the same record, so the document keeps exactly one per place.
 */
const regionFor = (doc: Document, record: AnnounceRecord, politeness: Politeness): [HTMLElement, boolean] => {
  const modal = topModal(doc);
  const parent = modal ?? doc.body;
  let place = record.regions;
  if (modal !== null) {
    place = record.modals.get(modal) ?? {};
    record.modals.set(modal, place);
  }
  const existing = place[politeness];
  if (existing !== undefined && existing.isConnected && existing.parentNode === parent) return [existing, false];
  const region = makeRegion(doc, politeness);
  parent.append(region);
  place[politeness] = region;
  return [region, true];
};

/**
 * **Say `text` once, in `element`'s own document.** The region is cleared now and written a task later from the
 * element's window, so a repeat of the same text is heard. Nothing is said for an element whose document has no window
 * (detached), and nothing is queued in a hidden tab: an announcement nobody is there to hear is stale by their return.
 */
export const announce = (element: Element, text: string, options: AnnounceOptions = {}): void => {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null || doc.body === null || doc.visibilityState === 'hidden') return;
  const politeness: Politeness = options.politeness === 'assertive' ? 'assertive' : 'polite';
  const record = recordOf(doc);
  const [region, fresh] = regionFor(doc, record, politeness);
  region.textContent = '';
  const key = options.key;
  if (key !== undefined) {
    const earlier = record.pending.get(key);
    if (earlier !== undefined) win.clearTimeout(earlier);
  }
  const timer = win.setTimeout(
    () => {
      if (key !== undefined) record.pending.delete(key);
      /** Written where it is spoken now: the modal may have closed meanwhile, or the region been removed. */
      if (doc.visibilityState === 'hidden') return;
      regionFor(doc, record, politeness)[0].textContent = String(text);
    },
    fresh ? FIRST_WRITE_MS : WRITE_MS,
  );
  if (key !== undefined) record.pending.set(key, timer);
};

/**
 * **The settle window's decision, pure**: the labels to say are those some connected element still wants. A label
 * every element has released, or whose elements have all left the document, is dropped.
 */
export const due = (wanted: ReadonlyMap<string, ReadonlySet<Element>>): [string, Element][] => {
  const out: [string, Element][] = [];
  for (const [label, elements] of wanted)
    for (const element of elements)
      if (element.isConnected) {
        out.push([label, element]);
        break;
      }
  return out;
};

/**
 * **Say `label` once after the settle window, if some connected element still wants it then** (a spinner's form: a load
 * that finishes inside the window says nothing). Every copy of this hook on the page shares the window: one copy opens
 * it, a copy that finds it open only adds its label, so two copies wanting "Loading" say it once.
 */
export const want = (element: Element, label: string): Wanted => {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return { release: () => {} };
  const record = recordOf(doc);
  let elements = record.wanted.get(label);
  if (elements === undefined) record.wanted.set(label, (elements = new Set()));
  elements.add(element);
  if (record.window === 0)
    record.window = win.setTimeout(() => {
      record.window = 0;
      const say = due(record.wanted);
      record.wanted.clear();
      for (const [text, by] of say) announce(by, text);
    }, SETTLE_MS);
  return {
    release: () => {
      const set = record.wanted.get(label);
      if (set === undefined) return;
      set.delete(element);
      if (set.size === 0) record.wanted.delete(label);
    },
  };
};
