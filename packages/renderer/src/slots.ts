/**
 * Light-DOM slots — the `'slot'` insert the renderer's seam consults. Wire it beside the renderer
 * and every light-rendered template's `<slot name="…">` distributes the host's own children,
 * exactly as shadow DOM would have:
 *
 * ```js
 * import { renderer } from '@verajs/renderer';
 * import { slots } from '@verajs/renderer/slots';
 * wire([renderer, slots]);
 * ```
 *
 * ```html
 * <my-card><h2 slot="header">Hello</h2>Body text</my-card>
 * ```
 *
 * **Additive entry** (the `keyed`/`spread` family): imports nothing, reaches the renderer only
 * through the wired seam, safe alongside any renderer entry on a CDN page.
 *
 * The semantics contract is the platform's own assignment algorithm: elements go to the slot
 * their `slot` attribute names, text nodes (whitespace included) to the default slot, comments
 * are never slottables (which also keeps the renderer's root marker out of capture), duplicate
 * slot names — first in mount order wins and later ones show fallback, fallback renders only
 * while nothing is assigned and comes back when a slot empties, and capture takes the host's
 * DIRECT children only, so nested components compose.
 *
 * **The one documented divergence from native, and why.** After the first render, the host's
 * top-level childList cannot distinguish a node the USER appended from one the component's own
 * template inserted — both arrive as `addedNodes` with the host as parent (native never has this
 * problem; it has two trees). A heuristic here would eventually capture a component's own
 * markup as slot content, which is the worst possible failure, so the rule is explicit instead:
 * a node ADDED AFTER first render joins the slot system only if it carries a `slot` attribute —
 * and `slot=""` targets the default slot, so nothing is out of reach, it just must be said.
 * (Everything present BEFORE first render keeps full native semantics, attribute-less text
 * included; removals and `slot`-attribute changes of captured nodes are tracked everywhere in
 * the tree by identity, so they have no such restriction.)
 *
 * Every document/window touch derives from the nodes themselves (`ownerDocument`) — the pop-out
 * rule; nothing here reads a global.
 */

/** What the seam holds per taken-over slot; `_$park$` rescues the user's nodes before the
 *  instance's DOM is bulk-discarded on a branch-away, and un-registers the binding. */
type SeamState = { _$park$: () => void };

type Binding = {
  _start: Comment;
  _end: Comment;
  _name: string;
  /** The slot element's own template children — shown while nothing is assigned, held here
   *  (detached, referenced) while displaced, restored when the slot empties. */
  _fallback: Node[];
  _assigned: boolean;
};

type HostState = {
  /** Assignment by slot name ('' is the default slot). Arrays are the live membership. */
  _map: Map<string, Node[]>;
  /** Mounted bindings per name, mount order ≈ tree order; index 0 receives the assignment. */
  _bindings: Map<string, Binding[]>;
  /** Captured nodes that are not currently displayed wait here — out of the document, exactly
   *  like an unassigned light child under native shadow DOM (present, not rendered). */
  _holding: DocumentFragment;
  /** node → its current slot name, for every node ever captured: the identity test that lets
   *  the observer spot USER removals and re-slottings amid the template's own mutations. */
  _names: WeakMap<Node, string>;
  _observer: MutationObserver;
};

const HOSTS = new WeakMap<Element, HostState>();

/** Slottables are elements and text nodes — comments and the rest are never assigned. */
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;

const bucketOf = (state: HostState, name: string): Node[] => {
  let bucket = state._map.get(name);
  if (bucket === undefined) state._map.set(name, (bucket = []));
  return bucket;
};

/** Take one node into the slot system: bucket it, remember it, and physically hold it. */
const take = (state: HostState, node: Node): string | null => {
  const name = slotNameOf(node);
  if (name === null) return null;
  bucketOf(state, name).push(node);
  state._names.set(node, name);
  state._holding.appendChild(node);
  return name;
};

const pull = (state: HostState, node: Node, name: string) => {
  const bucket = state._map.get(name);
  if (bucket === undefined) return;
  const at = bucket.indexOf(node);
  if (at !== -1) bucket.splice(at, 1);
};

/** Discard the observer records our own DOM moves just produced — the callback must only ever
 *  see the USER'S mutations. Synchronous, so nothing of the user's can slip into the drain. */
const drain = (state: HostState) => {
  state._observer.takeRecords();
};

/**
 * Make one binding show what it should: the assignment (when it is the active binding for its
 * name and the bucket has nodes) or its fallback. Current occupants are evacuated first —
 * assigned nodes to holding (they remain captured), fallback nodes to detachment (the
 * `_fallback` array keeps them). A bucket entry the USER spirited away while it was held
 * (removed from holding, or adopted into their own DOM) is purged rather than stolen back.
 */
const fill = (state: HostState, binding: Binding, active: boolean) => {
  const parent = binding._start.parentNode;
  if (parent === null) return; // anchors already discarded mid-teardown — nothing to show
  let node = binding._start.nextSibling;
  while (node !== null && node !== binding._end) {
    const next = node.nextSibling;
    if (binding._assigned) state._holding.appendChild(node);
    else parent.removeChild(node);
    node = next;
  }
  const bucket = active ? bucketOf(state, binding._name) : [];
  let shown = 0;
  for (let i = 0; i < bucket.length; i++) {
    const candidate = bucket[i];
    const home = candidate.parentNode;
    if (home !== state._holding && home !== null && home !== parent) {
      /** The user took this node for themselves while it was unassigned — respect that. */
      bucket.splice(i--, 1);
      state._names.delete(candidate);
      continue;
    }
    parent.insertBefore(candidate, binding._end);
    shown++;
  }
  binding._assigned = shown > 0;
  if (shown === 0) for (const fallback of binding._fallback) parent.insertBefore(fallback, binding._end);
};

const refill = (state: HostState, name: string) => {
  const binding = state._bindings.get(name)?.[0];
  if (binding !== undefined) fill(state, binding, true);
};

/**
 * The user's mutations, batched. Additions join only with an explicit `slot` attribute (the
 * documented rule above); removals and re-slottings of CAPTURED nodes are recognized anywhere by
 * identity. Template-caused records match nothing here: its nodes were never captured, and our
 * own moves were drained before they could arrive.
 */
const onMutations = (host: Element, records: MutationRecord[]) => {
  const state = HOSTS.get(host)!;
  const touched = new Set<string>();
  for (const record of records) {
    if (record.type === 'attributes') {
      const node = record.target;
      const previous = state._names.get(node);
      if (previous !== undefined) {
        const next = slotNameOf(node)!;
        if (next !== previous) {
          pull(state, node, previous);
          bucketOf(state, next).push(node);
          state._names.set(node, next);
          touched.add(previous);
          touched.add(next);
        }
      }
      continue;
    }
    for (const node of record.addedNodes) {
      if (
        node.parentNode === host &&
        node.nodeType === 1 &&
        (node as Element).hasAttribute('slot') &&
        !state._names.has(node)
      ) {
        touched.add(take(state, node)!);
      }
    }
    for (const node of record.removedNodes) {
      const name = state._names.get(node);
      /** Our evacuations were drained; an undrained removal of a captured node is the user's —
       *  unless it LANDED somewhere in the same batch (a move, which addedNodes/attributes
       *  handling covers) — `parentNode === null` is "truly gone". */
      if (name !== undefined && node.parentNode === null) {
        pull(state, node, name);
        state._names.delete(node);
        touched.add(name);
      }
    }
  }
  for (const name of touched) refill(state, name);
  drain(state);
};

/** Capture the host's children — once, at the first slot the seam hands us for it. */
const capture = (host: Element): HostState => {
  let state = HOSTS.get(host);
  if (state !== undefined) return state;
  const doc = host.ownerDocument!;
  const created: HostState = (state = {
    _map: new Map(),
    _bindings: new Map(),
    _holding: doc.createDocumentFragment(),
    _names: new WeakMap(),
    _observer: new MutationObserver((records) => onMutations(host, records)),
  });
  HOSTS.set(host, created);
  for (const node of [...host.childNodes]) take(created, node);
  created._observer.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['slot'],
  });
  return created;
};

/** The seam function — called by the renderer once per `<slot>` per instance (see the seam). */
const takeOverSlot = (slot: Element, root: Node, name: string): SeamState | null => {
  /** Only an element host is ours: a shadow root keeps native slotting, and a fragment or
   *  document container is not a light component. Duck-typed — realm-safe for pop-outs. */
  if (root.nodeType !== 1) return null;
  const host = root as Element;
  const state = capture(host);
  const doc = slot.ownerDocument!;
  const parent = slot.parentNode!;
  const start = doc.createComment('');
  const end = doc.createComment('');
  parent.insertBefore(start, slot);
  parent.insertBefore(end, slot);
  const fallback = [...slot.childNodes];
  for (const node of fallback) slot.removeChild(node);
  parent.removeChild(slot);
  const binding: Binding = { _start: start, _end: end, _name: name, _fallback: fallback, _assigned: false };
  let siblings = state._bindings.get(name);
  if (siblings === undefined) state._bindings.set(name, (siblings = []));
  siblings.push(binding);
  fill(state, binding, siblings[0] === binding);
  drain(state);
  return {
    _$park$: () => {
      /** Rescue assigned user nodes before the instance's DOM is bulk-discarded; if a duplicate
       *  slot was waiting behind this one, it inherits the assignment — native's next-in-tree. */
      if (binding._assigned) {
        let node = binding._start.nextSibling;
        while (node !== null && node !== binding._end) {
          const next = node.nextSibling;
          state._holding.appendChild(node);
          node = next;
        }
      }
      const list = state._bindings.get(binding._name)!;
      const at = list.indexOf(binding);
      if (at !== -1) list.splice(at, 1);
      if (at === 0 && list.length > 0) fill(state, list[0], true);
      drain(state);
    },
  };
};

/**
 * What the user slotted, by name — the component-internal accessor that answers identically in
 * both modes. Shadow: the native assignment. Light: the capture map (a fresh array; membership
 * is live, so ask again after mutations). `''`/omitted is the default slot.
 */
export const slotted = (host: Element, name = ''): Node[] => {
  const state = HOSTS.get(host);
  if (state !== undefined) return [...(state._map.get(name) ?? [])];
  const root = host.shadowRoot;
  if (root !== null) {
    const slot = root.querySelector<HTMLSlotElement>(name === '' ? 'slot:not([name])' : `slot[name="${name}"]`);
    if (slot !== null) return slot.assignedNodes();
  }
  return [];
};

/**
 * Capture a light host's children at its FIRST render, before any slot has necessarily mounted —
 * so content destined for a slot that only appears later (a conditional `<slot>` behind a branch)
 * is held invisibly meanwhile, exactly as native shadow DOM leaves an unassigned light child
 * unrendered. Idempotent (capture is once per host); the renderer calls it once per host lifetime.
 */
(takeOverSlot as { _$capture$?: (host: Element) => void })._$capture$ = (host) => {
  capture(host);
  drain(HOSTS.get(host)!);
};

/** The insert descriptor — `wire([renderer, slots])` and light-DOM slots exist. */
export const slots = {
  name: '@verajs/renderer/slots',
  on: 'slot' as const,
  fn: takeOverSlot as never,
  priority: 50,
};
