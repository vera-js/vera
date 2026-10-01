/**
 * **`@verajs/renderer/slots` — `<slot>` in a light-DOM component.** `wire([renderer, slots])`.
 *
 * A component that renders into its own element (no shadow root) gets the platform's slot assignment for the
 * children the page gave it: each light child goes to the first `<slot>` of its `slot` name (the default slot for
 * text and unnamed elements), a slot with nothing assigned shows its own content (the fallback), and comments are
 * never assigned. The `<slot>` is not an element in the page: its position is a pair of comments, slotted content
 * sits where it was — so `header > h2` matches a slotted `<h2>` as it would under shadow DOM — and the element is kept
 * detached, answering `assignedNodes()`/`assignedElements()` and firing `slotchange`.
 *
 * **Render-driven.** What the page's own templates do to a host's children — a parent re-render adding, removing,
 * moving or replacing them — is distributed as it is written, synchronously. The renderer routes those writes here:
 * every node this module takes into a host's light list carries `$light`, its host's light parent, and a write whose
 * boundary carries it goes through that parent instead of the DOM. Raw DOM edits by other code are not observed.
 *
 * Built on the `'element'` insert (a `<slot>` in a template is claimed when the template is built) and the renderer's
 * off-chain light seam; it imports nothing of the renderer. An app that does not wire it pays one boolean per
 * structural write.
 */
import { RESERVED_ELEMENT_NAMES } from '@verajs/shared-utils';
import { elements } from './elements.js';

/** A slot's assignment name: an element's `slot` attribute, `''` for text; a comment is never slottable. */
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;

type Lit = Node & { $light?: Light; $in?: Binding };

/** One `<slot>` in a host's output: its anchors, the kept element, its parked fallback and what it shows. */
type Binding = {
  slot: HTMLSlotElement;
  name: string;
  start: Comment;
  end: Comment;
  /** The fallback while something is assigned — parked in a fragment, never parentless (its parts keep a parent). */
  parked: DocumentFragment | null;
  shown: number;
  queued: boolean;
};

/**
 * **A host's light parent** — the renderer's stand-in for the host while it writes the host's light children. It
 * keeps the light list in the order the page wrote it, places each slottable node into its slot, and keeps every
 * other node (comments, a light part's markers, an unassigned child) in a holding fragment nothing renders.
 */
class Light {
  host: Element;
  list: Node[] = [];
  holding: DocumentFragment;
  bindings: Binding[] = [];
  constructor(host: Element) {
    this.host = host;
    this.holding = host.ownerDocument.createDocumentFragment();
  }
  /** Read by the renderer on a resolved parent (namespaces, development's foreign-content check): the host's answers. */
  get nodeType() {
    return 1;
  }
  get namespaceURI() {
    return this.host.namespaceURI;
  }
  get localName() {
    return this.host.localName;
  }
  getAttribute(name: string) {
    return this.host.getAttribute(name);
  }
  get ownerDocument() {
    return this.host.ownerDocument;
  }
  cloneNode(deep?: boolean) {
    return this.host.cloneNode(deep);
  }
  /** The nodes strictly between two boundaries, in light order. */
  $range(start: Node, end: Node | null): Node[] {
    const list = this.list;
    const from = list.indexOf(start) + 1;
    const to = end === null ? list.length : list.indexOf(end);
    return list.slice(from, to < 0 ? list.length : to);
  }
  insertBefore<T extends Node>(node: T, ref: Node | null): T {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.insertBefore(child, ref);
      return node;
    }
    /** As native `insertBefore` detaches from the old parent: out of whichever light list held it first. */
    const was = (node as Lit).$light;
    if (was !== undefined) was.forget(node);
    const list = this.list;
    const at = ref === null ? -1 : list.indexOf(ref);
    if (at < 0) list.push(node);
    else list.splice(at, 0, node);
    (node as Lit).$light = this;
    this.place(node);
    return node;
  }
  appendChild<T extends Node>(node: T): T {
    return this.insertBefore(node, null);
  }
  removeChild<T extends Node>(node: T): T {
    this.forget(node);
    (node as unknown as ChildNode).remove();
    return node;
  }
  /** Out of the list and out of its slot — the node is no longer this host's. */
  forget(node: Node) {
    const list = this.list;
    const at = list.indexOf(node);
    if (at >= 0) list.splice(at, 1);
    (node as Lit).$light = undefined;
    const binding = (node as Lit).$in;
    if (binding !== undefined) {
      (node as Lit).$in = undefined;
      binding.shown--;
      changed(binding);
      if (binding.shown === 0) restoreFallback(binding);
    }
  }
  /** The first slot of a name, in tree order — the one that wins it. */
  active(name: string): Binding | undefined {
    const bindings = this.bindings;
    for (let i = 0; i < bindings.length; i++) if (bindings[i].name === name) return bindings[i];
    return undefined;
  }
  /** Puts one light node where it belongs: its slot, in light order among what that slot shows, or holding. */
  place(node: Node) {
    const name = slotNameOf(node);
    const binding = name === null ? undefined : this.active(name);
    const was = (node as Lit).$in;
    if (was !== undefined && was !== binding) {
      (node as Lit).$in = undefined;
      was.shown--;
      changed(was);
      if (was.shown === 0) restoreFallback(was);
    }
    if (binding === undefined) {
      this.holding.appendChild(node);
      return;
    }
    if (binding.shown === 0 || was !== binding) parkFallback(binding);
    /** Before the next node of this slot in light order, or at the slot's end. */
    const list = this.list;
    let before: Node = binding.end;
    for (let i = list.indexOf(node) + 1; i < list.length; i++)
      if ((list[i] as Lit).$in === binding) {
        before = list[i];
        break;
      }
    binding.end.parentNode!.insertBefore(node, before);
    if (was !== binding) {
      (node as Lit).$in = binding;
      binding.shown++;
      changed(binding);
    }
  }
  /** Re-decides every light node — when a slot arrives or leaves, its name's assignment changes. */
  replaceAll() {
    for (const node of this.list) this.place(node);
  }
  /** A light node's `slot` changed (a binding wrote it): it moves to the slot of its new name, keeping light order. */
  $place(node: Node) {
    if (this.list.includes(node)) this.place(node);
  }
}

/**
 * A kept `<slot>`'s `name` changed (a binding wrote it on the detached element): it is re-sorted under its new name,
 * and every light node is re-decided — both names' assignments can change.
 */
const rename = (slot: HTMLSlotElement & { $binding?: Binding; $host?: Element }) => {
  const binding = slot.$binding;
  if (binding === undefined) return;
  const name = slot.getAttribute('name') ?? '';
  if (name === binding.name) return;
  binding.name = name;
  HOSTS.get(slot.$host!)?.replaceAll();
};

/** The fallback goes to a fragment while anything is assigned (its own parts keep a parent there). */
const parkFallback = (binding: Binding) => {
  if (binding.parked !== null) return;
  const parked = binding.start.ownerDocument!.createDocumentFragment();
  for (let node = binding.start.nextSibling; node !== null && node !== binding.end; ) {
    const next: ChildNode | null = node.nextSibling;
    if ((node as Lit).$in !== binding) parked.appendChild(node);
    node = next;
  }
  binding.parked = parked;
};
const restoreFallback = (binding: Binding) => {
  if (binding.parked === null) return;
  binding.end.parentNode?.insertBefore(binding.parked, binding.end);
  binding.parked = null;
};

/** `slotchange`, as the platform fires it: once per slot per change, after the change, on the kept element. */
const changed = (binding: Binding) => {
  if (binding.queued) return;
  binding.queued = true;
  queueMicrotask(() => {
    binding.queued = false;
    binding.slot.dispatchEvent(new (binding.slot.ownerDocument.defaultView!.Event)('slotchange', { bubbles: true, composed: false }));
  });
};

const HOSTS = new WeakMap<Element, Light>();
/** The registry's off-chain seam: the root range of a container (the output/light line), and the "wired" call. */
let shared: { $s?: boolean; $light?: () => void; $r?: (container: Node) => [Node, Node] | undefined } | null = null;

/**
 * **Capture** — a host's light children, once, at its first slot: every child OUTSIDE its root render's range (the
 * renderer brackets its output; anything before or after is the page's). Each joins the light list, marked, and goes
 * to its slot or to holding.
 */
const capture = (host: Element): Light => {
  let light = HOSTS.get(host);
  if (light !== undefined) return light;
  HOSTS.set(host, (light = new Light(host)));
  const range = shared?.$r?.(host);
  let inside = false;
  for (const child of [...host.childNodes]) {
    if (range !== undefined && child === range[0]) inside = true;
    else if (range !== undefined && child === range[1]) inside = false;
    else if (!inside) {
      light.list.push(child);
      (child as Lit).$light = light;
    }
  }
  /** Out of the host's own children at once — to its slot, or invisibly to holding until one arrives. */
  for (const node of light.list) light.place(node);
  return light;
};

/** Where a binding's start sits in document order relative to another's — tree order decides the winning slot. */
const before = (a: Binding, b: Binding) => (a.start.compareDocumentPosition(b.start) & 4) !== 0;

/**
 * The `<slot>` element's own answers, from the live assignment (a detached native slot would answer nothing). With
 * `flatten`, an unassigned slot answers its fallback's SLOTTABLES as the platform does — never a comment, and a
 * nested slot answers through itself.
 */
const assigned = (binding: Binding, elementsOnly: boolean, flatten = false): Node[] => {
  const light = HOSTS.get(binding.slot.$host!)!;
  const out: Node[] = [];
  for (const node of light.list) if ((node as Lit).$in === binding && (!elementsOnly || node.nodeType === 1)) out.push(node);
  if (out.length > 0 || !flatten) return out;
  for (let node = binding.start.nextSibling; node !== null && node !== binding.end; node = node.nextSibling) {
    const nested = (node as Node & { $slot?: Binding }).$slot;
    if (nested !== undefined) {
      out.push(...assigned(nested, elementsOnly, true));
      node = nested.end;
    } else if (node.nodeType === 1 || (!elementsOnly && node.nodeType === 3)) out.push(node);
  }
  return out;
};

/**
 * **A `<slot>` mounts** (its template's instance has rendered, in place): it becomes a pair of anchors around its
 * fallback, the element is kept detached with the assignment API, and the host's light nodes are re-decided.
 */
const take = (slot: HTMLSlotElement & { $host?: Element; $binding?: Binding }, host: Element): Binding => {
  const light = capture(host);
  const doc = slot.ownerDocument;
  const start = doc.createComment('');
  const end = doc.createComment('');
  const parent = slot.parentNode!;
  parent.insertBefore(start, slot);
  while (slot.firstChild !== null) parent.insertBefore(slot.firstChild, slot);
  parent.insertBefore(end, slot);
  slot.remove();
  const binding: Binding = { slot, name: slot.getAttribute('name') ?? '', start, end, parked: null, shown: 0, queued: false };
  slot.$host = host;
  slot.$binding = binding;
  slot.assignedNodes = (options?: AssignedNodesOptions) => assigned(binding, false, options?.flatten);
  slot.assignedElements = (options?: AssignedNodesOptions) => assigned(binding, true, options?.flatten) as Element[];
  (start as Comment & { $slot?: Binding }).$slot = binding;
  const bindings = light.bindings;
  let at = bindings.length;
  while (at > 0 && before(binding, bindings[at - 1])) at--;
  bindings.splice(at, 0, binding);
  light.replaceAll();
  return binding;
};

/** A `<slot>` leaves (its instance is torn down): what it showed is re-decided — the next slot of its name, or holding. */
const leave = (binding: Binding) => {
  const light = HOSTS.get(binding.slot.$host!)!;
  const bindings = light.bindings;
  const at = bindings.indexOf(binding);
  if (at >= 0) bindings.splice(at, 1);
  for (const node of light.list)
    if ((node as Lit).$in === binding) {
      (node as Lit).$in = undefined;
      light.holding.appendChild(node);
    }
  binding.shown = 0;
  light.replaceAll();
};

declare global {
  interface HTMLSlotElement {
    $host?: Element;
  }
}

/** The element behavior a `<slot>` in a light component's template gets — mounted after its render, unmounted at teardown. */
const slotBehavior = {
  mount: (slot: Element, context: { root: Node | null }) => {
    const root = context.root;
    /** A shadow root distributes natively; only a light host (an element rendered into) is this module's. */
    if (root === null || root.nodeType !== 1) return undefined;
    return take(slot as HTMLSlotElement, root as Element);
  },
  unmount: (binding: Binding) => leave(binding),
};

/** The slotted nodes a light host shows in its slot of `name` — or a shadow host's, from the platform. */
export const slotted = (host: Element, name = ''): Node[] => {
  const light = HOSTS.get(host);
  if (light !== undefined) {
    const binding = light.active(name);
    return binding === undefined ? [] : assigned(binding, false);
  }
  const slot = [...(host.shadowRoot?.querySelectorAll('slot') ?? [])].find((s) => (s.getAttribute('name') ?? '') === name);
  return slot === undefined ? [] : slot.assignedNodes();
};

/**
 * **`"offset,count"`, on the parent of every slot that received content — position, not just
 * extent.** Neither a `slot` attribute nor adjacency identifies a light child: a component's own
 * elements can carry `slot` too, and bare text carries nothing. So the server states each range, and
 * `data-vm-light` (below) states which range each light child went into, in light order.
 *
 * Position is what makes RECOVERY possible, and recovery is the case that matters: when hydration hits
 * a mismatch it discards the container and clean-renders, and for a light host the user's content is
 * *inside* what gets discarded. From the stated ranges the host knows its light list before the walk
 * starts, so `_$rescue$` returns it to holding before the discard, no walk required.
 */
const SLOTTED_ATTR = 'data-vm-slotted';
/**
 * Unassigned slot content is PRESERVED, not dropped — native leaves an unassigned light child in
 * the DOM (present, unrendered), and a light host has no second tree to hide it in, so the server
 * parks it in an inert `<template>` (exactly what the element is for: parsed, never rendered).
 * Hydration drains it back into holding, so content for a slot that only appears in another state
 * survives the round trip instead of vanishing from the HTML forever.
 */
const UNASSIGNED_MARK = 'data-vm-unassigned';
const LIGHT_ATTR = 'data-vm-light';
/**
 * **The server states the light tree, so the client never reconstructs it.** Distribution moves a
 * host's light children into its slots, which loses two facts the client needs: which nodes are
 * light children at all (a component's own elements can carry `slot` too), and their order ACROSS
 * slots. Both are written down, uniformly:
 *
 * - every slot position that received content marks its RANGE on its parent — `data-vm-slotted`,
 *   `"offset,count"`, space-separated when one parent holds several — named slots as well as the
 *   default, so no slot is found by guessing;
 * - the host carries `data-vm-light`: for each light child in light-tree order, the index of the range
 *   it went into (ranges numbered in document order, the unassigned carrier last), run-length encoded
 *   as `index*count`. `lightOf` reads the two back into the exact list.
 *
 * Positions are written LAST, once nothing else will move: separators (below) and the carrier both
 * shift offsets, and a position computed before them addressed the wrong node.
 */
const serverDistribute = (host: Element, source: Node[]) => {
  const buckets = new Map<string, Node[]>();
  const light: Node[] = [];
  for (const node of source) {
    const name = slotNameOf(node);
    if (name === null) continue;
    light.push(node);
    let bucket = buckets.get(name);
    if (bucket === undefined) buckets.set(name, (bucket = []));
    bucket.push(node);
    if (node.parentNode !== null) node.parentNode.removeChild(node);
  }
  const filled = new Set<string>();
  /** Every range that received content, in document order — see `data-vm-light`. */
  const ranges: Array<{ parent: Element; first: Node; last: Node; count: number }> = [];
  const rangeOf = new Map<Node, number>();
  /** Collected first: the live list mutates as slots are unwrapped. */
  for (const slot of [...host.querySelectorAll('slot')]) {
    const parent = slot.parentNode;
    if (parent === null) continue; // already unwrapped as another slot's assigned content
    const name = slot.getAttribute('name') ?? '';
    const assigned = !filled.has(name) ? buckets.get(name) : undefined;
    if (assigned !== undefined && assigned.length > 0) {
      filled.add(name);
      for (const node of assigned) {
        parent.insertBefore(node, slot);
        rangeOf.set(node, ranges.length);
      }
      ranges.push({ parent: parent as Element, first: assigned[0], last: assigned[assigned.length - 1], count: assigned.length });
    } else {
      /** Fallback: the slot's own children, unwrapped in place. */
      while (slot.firstChild !== null) parent.insertBefore(slot.firstChild, slot);
    }
    parent.removeChild(slot);
  }
  /**
   * **Separators where two text runs would MERGE**, because serialization is where node identity
   * dies: the client's parser joins adjacent text into one node, and a range then addresses a node
   * spanning a boundary it cannot see. Emitted by the side that knows — one rule for the class.
   */
  const doc = host.ownerDocument!;
  for (const { first, last } of ranges) {
    const ahead = first.previousSibling;
    if (ahead !== null && ahead.nodeType === 3 && first.nodeType === 3) first.parentNode!.insertBefore(doc.createComment(''), first);
    const behind = last.nextSibling;
    if (behind !== null && behind.nodeType === 3 && last.nodeType === 3) last.parentNode!.insertBefore(doc.createComment(''), behind);
  }
  /** Whatever no slot claimed goes into the inert carrier, in light-tree order — the last range. */
  let carrier: Element | null = null;
  for (const node of light)
    if (!rangeOf.has(node)) {
      if (carrier === null) {
        carrier = doc.createElement('template');
        carrier.setAttribute(UNASSIGNED_MARK, '');
      }
      carrier.appendChild(node);
      rangeOf.set(node, ranges.length);
    }
  if (carrier !== null) host.appendChild(carrier);
  /** Positions last — see above. */
  const marks = new Map<Element, string[]>();
  for (const { parent, first, count } of ranges) {
    let offset = 0;
    for (let n = parent.firstChild; n !== null && n !== first; n = n.nextSibling) offset++;
    let list = marks.get(parent);
    if (list === undefined) marks.set(parent, (list = []));
    list.push(`${offset},${count}`);
  }
  for (const [parent, list] of marks) parent.setAttribute(SLOTTED_ATTR, list.join(' '));
  /** The light order, run-length encoded — written on every light host, empty when it has none. */
  const runs: string[] = [];
  for (let k = 0; k < light.length; ) {
    const index = rangeOf.get(light[k])!;
    let n = 1;
    while (k + n < light.length && rangeOf.get(light[k + n]) === index) n++;
    runs.push(n === 1 ? `${index}` : `${index}*${n}`);
    k += n;
  }
  host.setAttribute(LIGHT_ATTR, runs.join(','));
};


/** The server half: `@verajs/ssr` reads it off the `'slot'` chain. */
const serve = { name: '@verajs/renderer/slots', on: 'slot' as const, fn: () => null, priority: 50, _$server$: serverDistribute };

/** Discovery: `<slot>` elements claimed in templates, through `elements`. */
export const slotDiscovery = [
  elements,
  (registry: Map<string, unknown[]>) => {
    shared = registry as unknown as typeof shared;
    shared!.$s = true;
    shared!.$light?.();
    /**
     * Told by the renderer at a container's FIRST render: a CUSTOM element (the compiler's rule — a dash, and not one
     * of the reserved SVG/MathML names) is a slot host, so its existing children are light content, captured now even
     * if its `<slot>` arrives later. A plain container (`#app`) keeps what it had — the render owns only its range.
     */
    (registry as unknown as { $first?: (container: Node) => void }).$first = (container) => {
      const name = (container as Element).localName;
      if (container.nodeType === 1 && name.includes('-') && !RESERVED_ELEMENT_NAMES.has(name)) capture(container as Element);
    };
    /** Told by the renderer when a binding writes `slot` on a light node or `name` on a kept slot. */
    (registry as unknown as { $slotted?: (element: Element, name: string) => void }).$slotted = (element, name) => {
      if (name === 'slot') (element as Lit).$light?.$place(element);
      else if (name === 'name' && element.localName === 'slot') rename(element as HTMLSlotElement);
    };
  },
  { name: '@verajs/renderer/slot-discovery', on: 'element' as const, fn: (el: Element) => (el.localName === 'slot' ? slotBehavior : undefined), priority: 10 },
];

/** `wire([renderer, slots])`. */
export const slots = [slotDiscovery, serve];
