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
 * **Wire it at the app entry, before anything renders.** This module marks a template as the
 * renderer builds it, once per TEMPLATE, and templates are cached per call site for the life of the
 * page — so a component that rendered before the wiring keeps a slotless template forever. That is the same contract every
 * insert carries; the alternative (re-checking the registry per instance) would put a lookup on
 * the hot path of every app, slots or not.
 *
 * The semantics contract is the platform's own assignment algorithm: elements go to the slot
 * their `slot` attribute names, text nodes (whitespace included) to the default slot, comments
 * are never slottables (which also keeps the renderer's root marker out of capture), duplicate
 * slot names — first in mount order wins and later ones show fallback, fallback renders only
 * while nothing is assigned and comes back when a slot empties, and capture takes the host's
 * DIRECT children only, so nested components compose.
 *
 * **Post-render additions are NATIVE, and the mechanism is ownership, not position.** The host's
 * childList holds both the user's content and the component's output, and the old rules told them
 * apart by where a node sat — which made bare text unreachable at the tail and a late insertion
 * join its slot out of order. Now everything the renderer emits at a captured host's top level is
 * stamped — the renderer reports every insert to `$o` below, which stamps (a non-enumerable `_$own$` property: the HOST for its own output — an insert
 * straight into the container being rendered, or by its root part — and the placing part's start
 * marker for content from an outer template). An unstamped top-level addition is therefore knowably the
 * user's: captured with full native semantics, text included, no `slot` attribute required
 * (`slot=""`/`slot="name"` still route). Ordering reads the same fact — placed content extends
 * its part's own group; an unstamped node before the boundary takes its document position ahead
 * of content distributed away, and past it, appends. **Re-slotting keeps that answer**: a node
 * whose `slot` attribute changes has not moved in the light tree, so it rejoins by a rank taken
 * when it was first captured rather than by arrival — otherwise an item toggled into a "pinned"
 * slot jumped to the end of the pinned list instead of holding its place.
 *
 * **What remains is reach, not order** — the earlier note here said hand-edits among several
 * `${…}` parts' content ordered "approximately", which measurement does not support: every
 * position a user can actually reach orders exactly as the platform does, and every order light
 * produces is one a shadow root also produces. What light has FEWER of is positions. A distributed
 * child is no longer a direct child of the host, so `host.insertBefore(node, thatChild)` throws
 * `NotFoundError` where a shadow host accepts it, and positions among an already-distributed
 * group cannot be named at the host's top level at all. `child.before(node)` / `child.after(node)`
 * go through the node's current parent and work identically in both modes; that is what the README
 * teaches, and `tests/renderer-slots.test.mjs` pins both the throw and the answer. And one parity note: whitespace appended to a
 * light host now suppresses the default fallback, because it does exactly that in a shadow root
 * (measured). `tests/slots-transition-parity.test.mjs` holds the matrix.
 *
 * **A `<slot>` cannot sit inside table markup**, in either mode: the parser's table insertion mode
 * rejects the element and foster-parents it out, so the slot lands before the `<table>` and takes
 * its distributed content with it. Measured against a shadow root given the same markup — it does
 * the same thing, so the modes agree and this is the platform's rule rather than this module's.
 * Ordinary bindings are fine (`<tbody>${rows}</tbody>` renders correctly) because the renderer's
 * anchor is a COMMENT, which table parsing permits where it rejects elements.
 *
 * **Pop-out rule.** Every *document* touch derives from the node itself (`ownerDocument`), so a
 * component rendered into a second window creates its nodes in that window's document.
 *
 * The one global read is `MutationObserver`, deliberately: an observer is not bound to the realm
 * of the nodes it watches, so deriving the constructor from `ownerDocument.defaultView` would buy
 * nothing and cost bytes on every capture. **Measured, not assumed** — `tests/browser/
 * slots-realm.test.js` renders a host in a second same-origin document and asserts that live
 * additions, `slot` changes and removals all reach their slots, on Chromium, Firefox and WebKit.
 * Behavior the platform decides is not settled under jsdom.
 */

/** What the seam holds per taken-over slot; `_$park$` rescues the user's nodes before the
 *  instance's DOM is bulk-discarded on a branch-away, and un-registers the binding. */
import type { InstanceHook } from './types.js';

type SeamState = { _$park$: () => void };

type Binding = {
  _start: Comment;
  _end: Comment;
  /** Read from `_slot` at mount and kept in step with it, so `<slot name=${…}>` works. */
  _name: string;
  /**
   * **The displaced region, parked in a fragment — empty whenever the region is on screen.**
   *
   * It began as an array of the slot's template children, detached one by one. That is a snapshot,
   * and the region it stands for is not static: a slot NESTED in this fallback keeps distributing
   * while displaced, so the array recorded a state that had moved on. Two failures came out of it,
   * one of them content loss — see `fill`.
   *
   * A fragment is the same idea without the snapshot. Displacing appends the region into it and
   * restoring inserts it back in one call, so anything that happened inside while it was away
   * comes back too, in place, with no list to keep in step. It also keeps every anchor PARENTED
   * while displaced, which is what lets a nested binding go on working instead of tripping `fill`'s
   * discarded-anchors guard.
   */
  _fallback: DocumentFragment;
  _assigned: boolean;
  /**
   * **The `<slot>` element itself, kept out of the document but alive as the component's API
   * object.** It is already what the template's own bindings attached to — `@slotchange`, `&ref`,
   * `name=${…}` all commit onto this element — so keeping it costs nothing and makes those
   * bindings mean what they mean in a shadow root: events dispatch on it, `&ref` hands it over,
   * and `assignedNodes()`/`assignedElements()` answer from the live assignment.
   */
  _slot?: Element;
  /** What this binding last SHOWED, so `slotchange` fires on change like the platform's does and
   *  not on every fill. */
  _shown: Node[];
  _queued: boolean;
};

type HostState = {
  /** The host this state belongs to — `flushPending` hands it to the record handler. */
  _host: Element;
  /** True while `flushPending` is processing, so the fills it causes do not recurse into it. */
  _flushing: boolean;
  /** Assignment by slot name ('' is the default slot). Arrays are the live membership. */
  _map: Map<string, Node[]>;
  /**
   * Every mounted binding, in MOUNT order — which is tree order, so the first one carrying a name
   * is the one that receives it, exactly as the platform picks the first matching slot.
   *
   * A flat list rather than a map keyed by name, because a slot's name is not fixed:
   * `<slot name=${section}>` can change between renders, and a keyed map would have to be re-keyed
   * on every such change. Finding the active one is then a scan, which is fine because bindings per
   * host are a handful — a rich component has three or four.
   *
   * **Measured rather than assumed**, since a scan invites the question: against the map-keyed
   * version, at 10, 50 and even an absurd 200 slots on one host, mount was within noise, and live
   * mutations and `slotted()` reads are FLAT in the number of slots (re-verified 2026-09-05:
   * re-slot cost moves ~3% from 10 to 200 slots; reads sub-microsecond throughout).
   *
   * Mount is mildly superlinear and it belongs to the DOM work, not to this — a sentence that has
   * now been checked the hard way. Re-measured under jsdom after the fragment/rank work, mount
   * looked QUADRATIC (400/100 ratio ~14) and three times its old absolute, which reads as an
   * algorithmic regression in this file. Chromium, same probe, same build: 0.8/1.8/3.2/7.6 ms at
   * 50/100/200/400 slots — ratio 4.2, mildly superlinear, fifty times faster than jsdom at the top
   * end. The scare was jsdom-as-oracle, the exact mistake this project's rules exist to prevent,
   * aimed for once at this very comment. Benchmark this module on an engine or not at all.
   */
  _bindings: Binding[];
  /** Captured nodes that are not currently displayed wait here — out of the document, exactly
   *  like an unassigned light child under native shadow DOM (present, not rendered). */
  _holding: DocumentFragment;
  /**
   * Every `_fallback` park fragment on this host, so `fill` can tell one of OUR resting places
   * from a tree the user has taken a node into.
   *
   * A set rather than a check against the binding being filled, because the two need not be the
   * same binding: a node placed by a slot nested in another slot's fallback rests in the OUTER
   * binding's fragment, and at three levels of nesting it rests in one belonging to neither. The
   * per-binding comparison happens to be right at depth two and silently wrong below it, which is
   * the kind of correct-looking check this file has been bitten by before.
   */
  _parks: WeakSet<Node>;
  /** node → its current slot name, for every node ever captured: the identity test that lets
   *  the observer spot USER removals and re-slottings amid the template's own mutations. */
  _names: WeakMap<Node, string>;
  /** Each kept `<slot>` element back to its binding, so a `name` change is recognized. */
  _ghosts: WeakMap<Element, Binding>;
  /**
   * **The host's light children as they would be if nothing were distributed** — the spec's list of
   * slottables, plus the comment anchors writers position against. Distribution MOVES nodes, so the
   * DOM stops saying which came first; this list is where that order lives. Every change is applied
   * to it with the neighbors its writer used (`place`), and each slot's content is simply this list
   * filtered by name (`rebuild`), so order is never inferred afterwards. It replaced six mechanisms
   * that each recovered a piece of it: ranks, front/back counters, landmark comments, ownership
   * stamps grouping placed content, a merge around the run on screen, and a document-order sort.
   */
  _light: Node[];
  /** The host window's `Event` — see `signal` for why it cannot be taken from the slot. */
  _event: typeof Event;
  _observer: MutationObserver;
  /**
   * **The boundary between the host's LIGHT REGION and the component's own render.** One comment,
   * appended at capture time — after the children are lifted, before the component's first render
   * appends its output — so everything that ever sits before it at the host's top level is host
   * content, and everything after is the component's. Two things stand on it:
   *
   * 1. The observer captures a top-level addition BEFORE the sentinel with full native semantics —
   *    no `slot` attribute required, text included. The attribute rule was written for USER
   *    mutations, whose ambiguity is real only at the host's tail; it was also catching the
   *    RENDERER's own re-renders of `<host>${…}</host>`, whose new nodes always land in the light
   *    region, and stranding them invisibly (measured: every `→ null → back` transition, every
   *    template swap, every list refill in a light host showed FALLBACK or stale content forever,
   *    while shadow passed all of them). That divergence is since gone entirely — ownership
   *    stamps replaced the region heuristic, and post-render additions are native.
   * 2. `_$home$` hands it to the renderer, so a text part that upgrades AFTER its text node was
   *    captured plants its markers here — in the host — instead of chasing the node into the
   *    slot, where the next fill swept markers and all into the holding fragment and the part
   *    spent the rest of the page rendering into detached space.
   */
  _sentinel: Comment;
};

const HOSTS = new WeakMap<Element, HostState>();
/** The host mark's shared descriptor — non-enumerable, for the same invisibility the stamps get. */
const HOSTED: PropertyDescriptor = { value: true, enumerable: false, configurable: true };

/**
 * What the observer watches, wherever it watches. Hoisted because captured nodes rest in more than
 * one place and every one of them needs the SAME watch — see the `observe` calls in `capture` and
 * the park fragment in `takeOverSlot`.
 */
const WATCHING = { childList: true, subtree: true, attributes: true, attributeFilter: ['slot'] };

/**
 * Slottables are elements and text nodes — comments and the rest are never assigned (`null`).
 *
 * **A deliberate twin of `slotNameOf` in `@verajs/ssr`'s `vera/nodes.js`**, which must spell the
 * same rule: independent packages, ssr does not import this one at runtime, so the rule is copied
 * rather than shared. A deliberate duplication is a fix's second address — change one and the
 * other needs the same change. `tests/ssr-slot-assignment-parity.test.mjs` fails if they diverge.
 *
 * `null` here means "not slottable", and callers must decide what that implies for THEM: the read
 * path filters those nodes out of `assignedNodes()`, while `serverDistribute` skips them, which
 * leaves them where they are on the client and drops them on a server that has already re-rendered
 * the host. Two different consequences from one answer — see `serverDistribute`.
 */
/**
 * **A slot region that belongs to ANOTHER host is one slottable — the spec's forwarding.** When a
 * component's template puts a `<slot>` inside another light component, that slot is the inner
 * component's light child, assigned by the slot element's OWN `slot` attribute, and it shows
 * whatever the outer slot shows (the spec's "flattened" slottables). Here the outer slot is a region
 * between two anchors, so its start anchor stands for the whole unit: named by its kept `<slot>`,
 * moved as one range (`move`), and what happens INSIDE it is the outer host's business (`inUnit`).
 */
const UNITS = new WeakMap<Node, Binding>();
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;
/**
 * A node's name as a slottable OF THIS HOST: the platform's rule, plus the start anchor of a slot that
 * belongs to another host — a forwarded slot. A host's own slots are regions of it, never slottables,
 * which is why this asks which host is asking and `slotNameOf` stays the platform's answer.
 */
const nameIn = (state: HostState, node: Node): string | null => {
  const unit = UNITS.get(node);
  if (unit === undefined || state._bindings.includes(unit)) return slotNameOf(node);
  return unit._slot?.getAttribute('slot') ?? '';
};
/** Moves a slottable — a forwarded slot as its whole anchor-to-anchor range. */
const move = (node: Node, parent: Node, before: Node | null) => {
  const unit = UNITS.get(node);
  if (unit === undefined) {
    parent.insertBefore(node, before);
    return;
  }
  const stop = unit._end.nextSibling;
  for (let at: Node | null = node; at !== null && at !== stop; ) {
    const next: Node | null = at.nextSibling;
    parent.insertBefore(at, before);
    at = next;
  }
};
/** Each binding's end anchor, and each binding's host — for `enclosing` and routing. */
const ENDS = new WeakMap<Node, Binding>();
const BINDING_HOST = new WeakMap<Binding, HostState>();
/** The host whose logical list holds a node — so a removal reaches it wherever the node was. */
const OWNER = new WeakMap<Node, HostState>();
/**
 * **The innermost slot range enclosing the gap after `prev`** — walked back through its siblings,
 * stepping over any range that closes before it. Anchors share a parent, so a gap at the start of a
 * parent is enclosed by none there.
 */
const enclosing = (prev: Node | null): Binding | undefined => {
  for (let at = prev; at !== null; at = at.previousSibling) {
    const closed = ENDS.get(at);
    if (closed !== undefined) {
      at = closed._start;
      continue;
    }
    const open = UNITS.get(at);
    if (open !== undefined) return open;
  }
  return undefined;
};

const bucketOf = (state: HostState, name: string): Node[] => {
  let bucket = state._map.get(name);
  if (bucket === undefined) state._map.set(name, (bucket = []));
  return bucket;
};

/** Take one node into the slot system: bucket it, remember it, and physically hold it. */
/**
 * **Takes a slottable into its host's care**: its name recorded, and lifted into holding unless it
 * already sits where its slot shows content. WHERE it belongs is not decided here — that is its
 * position in `_light`, set by whoever put it there (`place`).
 */
const take = (state: HostState, node: Node): string | null => {
  const name = nameIn(state, node);
  if (name === null) return null;
  state._names.set(node, name);
  const binding = activeFor(state, name);
  if (!(binding !== undefined && node.parentNode === binding._start.parentNode)) move(node, state._holding, null);
  return name;
};

/**
 * **Puts `node` into the logical list where its writer put it.** At the host's top level, a node that
 * became its FIRST child is first and one that became its LAST is last — what the writer asked for,
 * whatever else now sits there. Otherwise before `next` when the list has it (the reference an
 * `insertBefore` names), else after `prev`, else at the end. A node already in the list is MOVED: a
 * writer re-inserting a node is a reorder, whoever the writer is.
 */
const place = (state: HostState, node: Node, prev: Node | null, next: Node | null, top: boolean) => {
  const light = state._light;
  OWNER.set(node, state);
  /** Where the writer's references put it; `undefined` when neither is a light child. */
  let at: number | undefined;
  if (top && prev === null) at = 0;
  else if (top && next === null) at = light.length;
  else {
    const before = next === null ? -1 : light.indexOf(next);
    const after = prev === null ? -1 : light.indexOf(prev);
    if (before !== -1) at = before;
    else if (after !== -1) at = after + 1;
  }
  const from = light.indexOf(node);
  /** A known node whose neighbors are not light children — a whole slot range moved — keeps its place. */
  if (at === undefined) {
    if (from !== -1) return;
    at = light.length;
  }
  if (from !== -1) {
    light.splice(from, 1);
    if (at > from) at--;
  }
  light.splice(at, 0, node);
};

/** Drops a node from the host's care — the list, and its name. Returns the name it had. */
const forget = (state: HostState, node: Node): string | undefined => {
  const at = state._light.indexOf(node);
  if (at !== -1) state._light.splice(at, 1);
  if (OWNER.get(node) === state) OWNER.delete(node);
  const name = state._names.get(node);
  state._names.delete(node);
  return name;
};

/** A slot's content: the logical list filtered by name — in light-tree order by construction. */
const rebuild = (state: HostState, name: string) => {
  state._map.set(name, state._light.filter((node) => state._names.get(node) === name));
};

/**
 * Discard the records the module's own DOM moves just produced. Wholesale discard is CORRECT here
 * for exactly one reason, and `flushPending` is that reason: every mutating operation flushes the
 * user's queued records BEFORE it moves anything, so by the time this runs the queue holds only
 * our own. (The first fix for the run-17 storms re-fed the taken records through the handler
 * instead — and our holding-fragment churn then flowed through arms never designed for it,
 * breaking real re-fallback. Process-then-move is the design that holds: user records are
 * processed while the queue is provably pure-user, ours are discarded while it is provably
 * pure-ours.)
 */
/**
 * **One observer for the page, and every change credited to whoever made it — ownership by
 * AUTHORSHIP.** A change inside host H is H's own when H's own render made it, and the user's (a
 * slottable change) when anyone else did: the user, or an OUTER render placing content into H. The
 * renderer brackets every render (`_$b$`/`_$e$` below), and slots brackets its own moves
 * (`flushPending` before, `drain` after), so the observer's queue is split at each boundary and each
 * batch carries its author. That replaces inferring ownership node by node — the stamps every
 * insertion path had to cooperate with, which three audit rounds showed cannot be made complete.
 *
 * One observer rather than one per host: a record belongs to the nearest host above its target (or
 * to the host whose holding, fallback or slot element it is), so nested hosts sort themselves out,
 * and the per-host observers' WebKit memory growth under churn goes with them.
 */
let shared: MutationObserver | undefined;
const observer = (): MutationObserver =>
  (shared ??= new MutationObserver((records) => dispatch(records, null)));
/** Fragments and kept `<slot>` elements that live outside their host's tree, back to its state. */
const OUTSIDE = new WeakMap<Node, HostState>();
/** The render roots whose renders are in progress, innermost last — whoever is writing right now. */
const authors: (Node | null)[] = [];
/** How deep dispatch is nested — a host's processing can move nodes into a host nested in it. */
let depth = 0;
/**
 * One change, routed to the host it belongs to: a node ADDED (with the neighbors its writer used,
 * and whether it landed at the host's top level), a node REMOVED, or an ATTRIBUTE changed.
 */
type Change = { _kind: 0 | 1 | 2; _node: Node; _prev: Node | null; _next: Node | null; _top: boolean };
const ADDED = 0;
const REMOVED = 1;
const ATTRIBUTE = 2;

/**
 * **Routes each change to the host it belongs to, and hands every host the ones it did not author.**
 * A change belongs to the host whose slot range CONTAINS it, not to the nearest host above it: a
 * forwarded slot's content sits physically inside the inner component, and is the outer one's. So a
 * removed node goes to the host whose list holds it; an added node to the host whose range encloses
 * where it landed (a host's top level is that host); an attribute to its node's owner, or to the
 * host of a kept `<slot>` being renamed. What is enclosed by nothing is some component's own markup.
 */
const dispatch = (records: MutationRecord[], author: Node | null) => {
  if (records.length === 0) return;
  const byHost = new Map<HostState, Change[]>();
  const route = (state: HostState | undefined, change: Change) => {
    if (state === undefined) return;
    /** A host's own writes are skipped — except its kept `<slot>`'s rename, which it must act on. */
    if (state._host === author && !(change._kind === ATTRIBUTE && state._ghosts.has(change._node as Element))) return;
    let list = byHost.get(state);
    if (list === undefined) byHost.set(state, (list = []));
    list.push(change);
  };
  for (const record of records) {
    const target = record.target;
    const prev = record.previousSibling;
    const next = record.nextSibling;
    if (record.type === 'attributes') {
      route(OUTSIDE.get(target) ?? OWNER.get(target), { _kind: ATTRIBUTE, _node: target, _prev: null, _next: null, _top: false });
      continue;
    }
    const top = HOSTS.get(target as Element);
    const at = top ?? OUTSIDE.get(target) ?? BINDING_HOST.get(enclosing(prev)!);
    for (const node of record.removedNodes)
      route(OWNER.get(node) ?? at, { _kind: REMOVED, _node: node, _prev: prev, _next: next, _top: false });
    for (const node of record.addedNodes)
      route(at, { _kind: ADDED, _node: node, _prev: prev, _next: next, _top: top !== undefined });
  }
  if (byHost.size === 0) return;
  depth++;
  try {
    for (const [state, list] of byHost) {
      processRecords(state._host, state, list);
      /** Processing MOVES nodes (fills, fallbacks): this host's own writes, credited to it. */
      drain(state);
    }
  } finally {
    depth--;
  }
};/**
 * **Credits what is queued to the host whose moves made it** — called right after slots' own moves.
 * Inside that host they are its own and skipped, exactly as a discard would; but a host NESTED in
 * one of its slot regions receives them as foreign, like content any outer writer places there. That
 * is slot forwarding: an outer slot's content, placed inside an inner component, becomes the inner
 * component's light children. Hosts nest finitely, so the chain ends.
 */
const drain = (state: HostState) => {
  if (shared !== undefined) dispatch(shared.takeRecords(), state._host);
};

/**
 * Process the USER's queued records before the module mutates anything — the run-17 fix.
 *
 * Observer delivery is asynchronous, so a user mutation made earlier in the same task (an append,
 * a `slot` rename, a removal) is still queued when a mount, fill or park starts moving nodes.
 * The old code drained that queue wholesale afterwards, under a comment claiming nothing of the
 * user's could be in it — wrong direction of time: seven deterministic storm divergences, one
 * root cause. At operation ENTRY the queue holds only user records (every previous operation
 * ended by draining its own), so processing here is exactly the observer callback running early.
 * Re-entrant-safe: processing refills, refills fill, and the inner fill's flush must not recurse.
 */
const flushPending = (_state?: HostState) => {
  if (depth > 0 || shared === undefined) return;
  dispatch(shared.takeRecords(), authors.length === 0 ? null : authors[authors.length - 1]);
};

/**
 * **The renderer's bracket.** At a render's start, what is queued was written by whoever was writing
 * before it (the user, or the render this one is nested in); at its end, by this render. Attached to
 * the seam below, so the renderer reaches it across the bundle boundary.
 */
const beginRender = (root: Node | null) => {
  flushPending();
  authors.push(root);
};
const endRender = () => {
  flushPending();
  authors.pop();
};

/** The binding that OWNS a name — the first in tree order, as the platform picks the first
 *  matching slot and leaves any duplicate showing its fallback. */
const activeFor = (state: HostState, name: string): Binding | undefined => {
  const bindings = state._bindings;
  for (let i = 0; i < bindings.length; i++) if (bindings[i]._name === name) return bindings[i];
  return undefined;
};

const NOTHING: Node[] = [];

/**
 * **`slotchange`, on the element the author bound it to.** Queued rather than dispatched inline:
 * the platform fires it at the microtask checkpoint, and firing synchronously from inside a render
 * would re-enter rendering from a handler. The queue also means the very first dispatch lands
 * after the slot's own `AttrPart`s have attached their listeners, whatever order mounting took.
 *
 * `Event` comes from the HOST's realm, not the module's — a component rendered into a popped-out
 * window must dispatch an event that window's code recognizes, or a handler's `instanceof` is
 * false and, measured, a strict DOM refuses the foreign object outright.
 *
 * **From the host, and deliberately not from the slot**, which is the trap: a `<template>`'s
 * content belongs to an inert document that has no browsing context, so the slot element's
 * `ownerDocument.defaultView` is `null` — every clone of it, in every realm. The host is a live
 * element in the real document and is the only one of the two that knows which window this is.
 *
 * (`queueMicrotask` is not realm-bound; the job queue is shared.)
 */
const signal = (state: HostState, binding: Binding) => {
  const slot = binding._slot;
  if (slot === undefined || binding._queued) return;
  binding._queued = true;
  queueMicrotask(() => {
    binding._queued = false;
    slot.dispatchEvent(new state._event('slotchange', { bubbles: true, composed: false }));
  });
};

const same = (a: Node[], b: Node[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Make one binding show what it should: the assignment (when it is the active binding for its
 * name and the bucket has nodes) or its fallback. Current occupants are evacuated first —
 * assigned nodes to holding (they remain captured), an unassigned region into `_fallback`, which
 * is a fragment rather than a list precisely because that region goes on living while it is away.
 * A bucket entry the USER spirited away while it was held (removed from holding, or adopted into
 * their own DOM) is purged rather than stolen back.
 *
 * **What the fragment fixes, stated because it cost real content.** Detaching the region node by
 * node left every anchor inside it parentless, so a binding nested in this fallback hit the guard
 * at the top of this function and returned without placing anything. A child the user added for
 * that inner slot while the outer one was assigned therefore went into its bucket and nowhere
 * else — and when the outer slot later fell back, the old list restored the inner slot's ORIGINAL
 * fallback over the top. The user's node was detached, invisible, and unrecoverable, while the
 * inner slot's own `assignedNodes()` still named it. In a shadow root the same sequence simply
 * shows the node, because there the inner slot never leaves the tree.
 *
 * Parked in a fragment, the anchors keep a parent, the inner binding places into the fragment as
 * it always would, and restoring carries the result back. One call, no list, no re-fill pass.
 */
const fill = (state: HostState, binding: Binding) => {
  /** The user's queued mutations first — see `flushPending`. Re-entrant fills skip via the flag. */
  flushPending(state);
  const parent = binding._start.parentNode;
  if (parent === null) return; // anchors already discarded mid-teardown — nothing to show
  /** Everything on screen goes back to where it waits; what the slot shows is then placed afresh. */
  let node = binding._start.nextSibling;
  while (node !== null && node !== binding._end) {
    const next = node.nextSibling;
    if (binding._assigned) state._holding.appendChild(node);
    else binding._fallback.appendChild(node);
    node = next;
  }
  const bucket = activeFor(state, binding._name) === binding ? bucketOf(state, binding._name) : NOTHING;
  const shown: Node[] = [];
  for (let i = 0; i < bucket.length; i++) {
    const candidate = bucket[i];
    const home = candidate.parentNode;
    if (
      home !== state._holding &&
      home !== null &&
      home !== parent &&
      !state._parks.has(home) &&
      !inAnyRun(state, candidate)
    ) {
      /**
       * The user took this node for themselves while it was unassigned — respect that.
       *
       * `_parks` is the exception and it is not decoration: a node distributed by a slot nested in
       * a displaced fallback rests in that fallback's park fragment, which is a home of OURS. Read
       * as a user adoption it was purged from the bucket instead of being placed, so re-slotting
       * such a node to an outer slot dropped it — visible content, gone, in a sequence a shadow
       * root handles without comment.
       *
       * `!inAnyRun` is the run-27 completion of that same idea: a node RESLOTTED from one slot to
       * another has its bucket moved by the attribute arm but is still PHYSICALLY in its old
       * slot's run when this fill for the NEW slot runs — its parent is that other run's region,
       * which is a location WE control, not a user adoption. Without this the reslot's own fill
       * purged the node it was about to place, and the node vanished (run-27 adopted-seam storm
       * node-loss: concurrent DOM churn shifted delivery so the new-slot fill ran before the node
       * was physically relocated). Another run is the last of our regions the guard did not name.
       */
      bucket.splice(i--, 1);
      forget(state, candidate);
      continue;
    }
    move(candidate, parent, binding._end);
    shown.push(candidate);
  }
  binding._assigned = shown.length > 0;
  if (shown.length === 0) parent.insertBefore(binding._fallback, binding._end);
  if (!same(binding._shown, shown)) {
    binding._shown = shown;
    signal(state, binding);
  }
};

/**
 * **Assigns a name afresh across every slot carrying it** — the spec's "assign slottables for a
 * tree", for one name. The first of them in tree order takes the content and the rest show their
 * fallback, so the others are filled first: the winner then takes what they released. Any change to
 * which slots carry a name (a slot mounted, parked or renamed) goes through here, which is what
 * lets an earlier slot that returns take its content back.
 */
const refill = (state: HostState, name: string) => {
  const active = activeFor(state, name);
  for (const binding of state._bindings) if (binding._name === name && binding !== active) fill(state, binding);
  if (active !== undefined) fill(state, active);
};

/**
 * Register one binding for `name` and hand back its park closure — the single source for both the
 * client seam and hydration's adopt, which previously spelled the same registration and the same
 * park body twice (the house's most-repeated defect class). Park rescues assigned user nodes into
 * holding before the instance's DOM is bulk-discarded, unregisters, and promotes the next
 * duplicate slot to the assignment — native's next-in-tree-order.
 */
const bind = (state: HostState, binding: Binding): SeamState => {
  UNITS.set(binding._start, binding);
  ENDS.set(binding._end, binding);
  BINDING_HOST.set(binding, state);
  /**
   * In TREE order, not mount order: the first slot in the tree takes a name. A slot that mounts later
   * but sits earlier — the one a re-render brings back — goes ahead of those after it. A binding
   * whose anchors are not in the host's tree (displaced in a fallback) keeps mount order.
   */
  const bindings = state._bindings;
  let at = bindings.length;
  for (let i = 0; i < bindings.length; i++) {
    const position = binding._start.compareDocumentPosition(bindings[i]._start);
    // eslint-disable-next-line no-bitwise -- FOLLOWING and not DISCONNECTED, the platform's flags
    if ((position & 4) !== 0 && (position & 1) === 0) {
      at = i;
      break;
    }
  }
  bindings.splice(at, 0, binding);
  const slot = binding._slot;
  if (slot !== undefined) {
    state._ghosts.set(slot, binding);
    OUTSIDE.set(slot, state);
    expose(state, binding);
    /** A `name` that is a binding can change between renders, and the element it changes on is
     *  not in the host's subtree — so it is watched directly. */
    state._observer.observe(slot, { attributes: true, attributeFilter: ['name'] });
    if (__DEV__) warnInert(slot);
  }
  return {
    _$park$: () => {
      /** A rename or removal queued in this same task decides WHAT gets parked — process it first. */
      flushPending(state);
      if (binding._assigned) {
        let node = binding._start.nextSibling;
        while (node !== null && node !== binding._end) {
          const next = node.nextSibling;
          state._holding.appendChild(node);
          node = next;
        }
      }
      const wasActive = activeFor(state, binding._name) === binding;
      const at = state._bindings.indexOf(binding);
      if (at !== -1) state._bindings.splice(at, 1);
      /** Whoever is now first for that name inherits the assignment — native's next in tree order. */
      if (wasActive) refill(state, binding._name);
      drain(state);
    },
  };
};

/**
 * Answer `assignedNodes()`/`assignedElements()` from the live assignment, so a handler written for
 * a shadow slot — `event.target.assignedElements()`, or the same through `&ref` — reads the same
 * thing here. A detached element's own implementations return nothing, which is what made the
 * ordinary way of reading a slot come back empty in light mode.
 *
 * `flatten` means what it means on the platform for a slot with nothing assigned: the fallback
 * **that is actually on screen right now**. Both halves of that sentence were wrong.
 *
 * It answered from `_fallback`, which is the restore list — a snapshot of the slot's template
 * children, taken once. That is the right list to re-insert from and the wrong list to report,
 * because the region it stands for is live: a NESTED slot inside fallback content redistributes
 * as its own assignment changes, and a binding inside fallback content re-renders. Reported from
 * the snapshot, a nested slot's flatten kept naming a node the user had already removed from the
 * document, forever.
 *
 * So read from wherever the fallback IS. Rendered, that is the region between the anchors, and
 * reading it there is live by construction rather than by maintenance — nothing has to remember to
 * update it — which also makes the recursion the platform specifies fall out for free, since an
 * inner slot's distributed content is physically in that region. Displaced, there is no region to
 * walk: `fill` detaches the old fallback node by node, anchors included, so `_start` has no parent
 * and the restore list is the only record of it. That is the one honest discriminator here and it
 * needs no new state — a slot nested in another slot's fallback is exactly the case that reaches
 * it, and the platform still answers for such a slot because in a shadow tree it never left.
 *
 * The filter is the second half: the platform's word is *slottables*, so `slotNameOf` — the same
 * predicate that decides assignment everywhere else in this file — is what says which nodes count.
 * Without it the walk hands back a user's own `<!-- -->` written into fallback content, and this
 * module's own markers around a nested slot's content: an implementation detail escaping through
 * a documented API. One predicate closes both.
 */
const expose = (state: HostState, binding: Binding) => {
  const slot = binding._slot as HTMLSlotElement;
  const read = (flatten?: boolean): Node[] => {
    const bucket = activeFor(state, binding._name) === binding ? (state._map.get(binding._name) ?? NOTHING) : NOTHING;
    if (bucket.length > 0) return [...bucket];
    if (flatten !== true) return [];
    const shown: Node[] = [];
    for (let n = binding._start.nextSibling; n !== null && n !== binding._end; n = n.nextSibling) shown.push(n);
    return shown.filter((node) => slotNameOf(node) !== null);
  };
  slot.assignedNodes = (options?: { flatten?: boolean }) => read(options?.flatten) as Node[];
  slot.assignedElements = (options?: { flatten?: boolean }) =>
    read(options?.flatten).filter((node) => node.nodeType === 1) as Element[];
};

/**
 * **What a `<slot>` cannot carry in a light component, said out loud.** A light host has no second
 * tree, so the slot element is not rendered and never can be: `class`, `style`, `id` and the rest
 * have nowhere to apply, whether they were written statically or bound. In a shadow root they do
 * apply — a `<slot>` is a real element there — so this is the one asymmetry left, and silence
 * about it is what made it expensive to find.
 *
 * `name` is excluded because it is the slot's meaning, and events and `&ref` never appear as
 * attributes at all, so they do not trip this.
 */
const warnInert = (slot: Element) => {
  const inert: string[] = [];
  for (const attribute of slot.attributes) if (attribute.name !== 'name') inert.push(attribute.name);
  if (inert.length === 0) return;
  const label = slot.getAttribute('name');
  const key = `${label ?? ''}|${inert.join(',')}`;
  if (warnedInert.has(key)) return;
  warnedInert.add(key);
  console.warn(
    `[vera] <slot${label === null ? '' : ` name="${label}"`}> carries ${inert.map((n) => `\`${n}\``).join(', ')}, ` +
      `which does nothing in a light-DOM component: the slot element is not rendered, so there is ` +
      `nothing for it to apply to. In a shadow root it would apply. Put it on a real element around ` +
      `the slot instead. (\`name\`, \`@event\` bindings and \`&ref\` all work here.)`
  );
};
/** `@__PURE__`: `warnInert` is `__DEV__`-only, so without it production keeps a bare `new Set`
 *  whose binding it just dropped — the orphan-allocation trap this file documents for slot state. */
const warnedInert = /* @__PURE__ */ new Set<string>();

/**
 * The user's mutations, batched. Additions join only with an explicit `slot` attribute (the
 * documented rule above); removals and re-slottings of CAPTURED nodes are recognized anywhere by
 * identity. Template-caused records match nothing here: its nodes were never captured, and our
 * own moves were drained before they could arrive.
 */
/**
 * Is this node currently sitting inside one of OUR runs — between some binding's anchors, in the
 * host or in a not-yet-inserted instance fragment alike? The user-took removal arm needs it: a
 * mount's `fill` moves a captured node into the instance's DETACHED fragment before the fragment
 * enters the host, so at drain time the node is in neither the host nor the holding — exactly the
 * signature the arm reads as "the user took it". Position between anchors is the fact that holds
 * in both worlds, and it is the same test the nested-addition arm already trusts.
 */
const inAnyRun = (state: HostState, node: Node): boolean => {
  for (const binding of state._bindings) {
    const parent = binding._start.parentNode;
    if (parent === null || parent !== node.parentNode) continue;
    // eslint-disable-next-line no-bitwise -- DOCUMENT_POSITION_FOLLOWING, as in the nested-add arm
    if ((binding._start.compareDocumentPosition(node) & 4) !== 0 && (node.compareDocumentPosition(binding._end) & 4) !== 0)
      return true;
  }
  return false;
};

const processRecords = (host: Element, state: HostState, changes: Change[]) => {
  const touched = new Set<string>();
  const moved: Binding[] = [];
  for (const change of changes) {
    const node = change._node;
    if (change._kind === ATTRIBUTE) {
      /** A kept `<slot>` renamed (`name=${…}`): it now takes, and shows, the other name. */
      const ghost = state._ghosts.get(node as Element);
      if (ghost !== undefined) {
        const next = (node as Element).getAttribute('name') ?? '';
        if (next !== ghost._name) {
          touched.add(ghost._name);
          ghost._name = next;
          touched.add(next);
          moved.push(ghost);
        }
        continue;
      }
      /** A slottable re-slotted: same place in the light tree, another slot's content. */
      const previous = state._names.get(node);
      if (previous !== undefined) {
        const next = slotNameOf(node)!;
        if (next !== previous) {
          state._names.set(node, next);
          touched.add(previous);
          touched.add(next);
        }
      }
      continue;
    }
    const home = node.parentNode;
    /** Where the node is NOW decides — changes are processed after the fact, so a node added and then
     *  removed again in one batch was never there, and must not be taken back from nowhere. */
    const present = host.contains(node) || home === state._holding || (home !== null && state._parks.has(home));
    if (change._kind === ADDED) {
      if (!present) continue;
      place(state, node, change._prev, change._next, change._top);
      const name = state._names.get(node) ?? take(state, node);
      if (name !== null) touched.add(name);
      continue;
    }
    /**
     * Gone from the host — not merely moved within it (a writer re-inserting a node is handled by its
     * addition), and not resting in one of OUR places (holding, a displaced fallback).
     */
    if (present) continue;
    const name = forget(state, node);
    if (name !== undefined) touched.add(name);
  }
  for (const name of touched) {
    rebuild(state, name);
    refill(state, name);
  }
  for (const binding of moved) fill(state, binding);
};


/** Capture the host's children — once, at the first slot the seam hands us for it. */
const capture = (host: Element, skipChildren = false, boundary?: Comment): HostState => {
  let state = HOSTS.get(host);
  if (state !== undefined) return state;
  const doc = host.ownerDocument!;
  const created: HostState = (state = {
    _host: host,
    _flushing: false,
    _map: new Map(),
    _bindings: [],
    _holding: doc.createDocumentFragment(),
    _parks: new WeakSet(),
    _light: [],
    _names: new WeakMap(),
    _ghosts: new WeakMap(),
    _event: ((doc.defaultView as { Event?: typeof Event } | null)?.Event ?? Event) as typeof Event,
    _observer: observer(),
    /**
     * **The renderer's own root marker, when it has one** — it already delimits where the render's
     * output begins, which is exactly this boundary, so a sentinel of our own was a second comment
     * saying the same thing one position to the left. Only the paths that reach `capture` WITHOUT
     * one (hydration adopts per slot, and its render's marker is not in hand there) still mint it.
     */
    _sentinel: boundary ?? doc.createComment(''),
  });
  HOSTS.set(host, created);
  OUTSIDE.set(created._holding, created);
  /**
   * The host is MARKED as captured, on itself — this is what the renderer's stamp gate reads in
   * `_insert`/`$c`: one own-property read instead of a seam call, and it cannot go stale in the
   * dangerous direction (a part committing into a not-yet-captured host reads undefined, stamps
   * nothing, and that content is exactly what the initial walk below lifts). Symmetric with the
   * node stamps: ownership facts live on the objects they describe.
   */
  Object.defineProperty(host, '_$hosted$', HOSTED);
  /** Ours to place only if ours to make; the renderer's is already in the document. */
  if (boundary === undefined) host.appendChild(created._sentinel);
  /**
   * A server render parks content no slot claimed in an inert `<template>` — recover it into
   * holding (captured, unrendered, ready if its slot ever mounts) and drop the carrier, so the
   * round trip matches CSR exactly. Done before the children walk so the carrier is never itself
   * mistaken for slot content.
   */
  for (const child of [...host.children])
    if (child.localName === 'template' && child.hasAttribute(UNASSIGNED_MARK)) {
      const held = (child as HTMLTemplateElement).content;
      for (const node of [...held.childNodes]) {
        created._light.push(node);
        OWNER.set(node, created);
        take(created, node);
      }
      host.removeChild(child);
    }
  /** Hydration already has the children distributed and registers them itself; a fresh CSR
   *  capture lifts them from the host — comments stay where they are, but join the list as the
   *  anchors later writers position against. */
  if (!skipChildren)
    for (const node of [...host.childNodes]) {
      /** The render's own anchors are the host's, not light children — only foreign nodes join. */
      if (node === created._sentinel || node === boundary) continue;
      created._light.push(node);
      OWNER.set(node, created);
      take(created, node);
    }
  for (const name of new Set(created._light.map((node) => created._names.get(node)))) if (name !== undefined) rebuild(created, name);
  created._observer.observe(host, WATCHING);
  /**
   * HOLDING IS WATCHED TOO. Unassigned nodes wait in a detached fragment, which is not in the
   * host's subtree — so re-slotting one (`slot="a"` → `"b"`) went unseen and the node never moved
   * to its new slot, while native re-assigns a light child whether or not it is currently
   * assigned (measured: displayed nodes re-slotted, held ones silently did not).
   */
  created._observer.observe(created._holding, WATCHING);
  return created;
};

/** The seam function — called by the renderer once per `<slot>` per instance (see the seam). */
const takeOverSlot = (slot: Element, root: Node, name: string): SeamState | null => {
  /** Every entry that moves nodes flushes first: `drain` discards what is queued, which is only ours
   *  once everyone else's has been handed on. */
  flushPending();
  /**
   * The SERVER declines the client path entirely: SSR renders once and distributes through
   * `_$server$` (markerless, no observer, no anchors). If this ran under the shim it would insert
   * anchors and capture into a fragment, fighting the server pass. `__veraSsrShimmed` is the flag
   * SSR sets when it installs the DOM.
   */
  if ((globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed) return null;
  /** Only an element host is ours: a shadow root keeps native slotting, and a fragment or
   *  document container is not a light component. Duck-typed — realm-safe for pop-outs. */
  if (root.nodeType !== 1) return null;
  const host = root as Element;
  /**
   * **A `<slot>` nested inside ANOTHER slot's fallback has already been detached by the time we
   * reach it.** Slots mount in document order, and taking over the outer one lifts its fallback
   * children out of the tree and into `_fallback` — the inner slot among them. Reaching for
   * `parentNode.insertBefore` then threw a TypeError straight out of `renderInto`, taking the whole
   * render with it.
   *
   * Declining leaves it a literal `<slot>` inside that fallback: inert, showing its own fallback
   * children if the outer slot ever falls back. That is a documented divergence from the platform,
   * where an inner slot DOES participate while the outer one shows its fallback — supporting that
   * means taking slots over at the moment a fallback is inserted, which is a feature rather than
   * this fix. What matters here is that markup the platform accepts cannot crash the renderer.
   */
  if (slot.parentNode === null) return null;
  const nestedStates: SeamState[] = [];
  /**
   * **Children are never lifted here.** The renderer captures a host at its FIRST client render, so a
   * host first met at a takeover was not rendered that way: it was HYDRATED (with no `<slot>` then —
   * one that adopted a slot is captured by `_$adopt$`), or rendered before this module was wired.
   * Either way its children are the component's own output, and lifting them put that output inside
   * its own slot — the renderer then inserted a node into its own descendant and threw
   * `HierarchyRequestError`, leaving the host empty. Content the server could not place still
   * comes back from its `<template data-vm-unassigned>`, which capture recovers regardless.
   */
  const state = capture(host, /* skipChildren */ true);
  const doc = slot.ownerDocument!;
  const parent = slot.parentNode;
  const start = doc.createComment('');
  const end = doc.createComment('');
  parent.insertBefore(start, slot);
  parent.insertBefore(end, slot);
  /**
   * **Slots inside this one's FALLBACK are taken over first, while they still have a parent.**
   *
   * The renderer hands slots over in document order, so the outer one arrives first — and the first
   * thing it used to do was detach its fallback children, taking any nested slot out of the tree
   * with them. By the time that inner slot's turn came it had no parent to anchor into: it threw
   * until a guard declined it, and declining left it a literal `<slot>` that showed its own
   * fallback instead of what it was assigned, whenever the outer one later fell back. Measured
   * against a shadow root, which re-slots it: three arrangements, three different wrong answers,
   * one of them showing nothing at all.
   *
   * Doing it here rather than reordering the renderer's mount keeps binding order in TREE order,
   * which is what decides duplicate names. Deepest first, so a slot nested two levels down is live
   * before the one containing it captures it. The renderer still visits these afterwards and the
   * parentless guard declines them, so nothing is taken over twice.
   */
  const nested = [...slot.querySelectorAll('slot')].reverse();
  for (const inner of nested) {
    const innerState = takeOverSlot(inner, root, inner.getAttribute('name') ?? '');
    if (innerState !== null) nestedStates.push(innerState);
  }
  const fallback = doc.createDocumentFragment();
  state._parks.add(fallback);
  OUTSIDE.set(fallback, state);
  /**
   * **And a park is watched too, for exactly the reason holding is.** A displaced fallback is a
   * second detached place captured nodes rest in: a slot nested here goes on distributing while the
   * outer slot is assigned, so its content sits in this fragment, outside the host's subtree. Left
   * unwatched, re-slotting one of those nodes (`slot="i"` → `""`) was invisible and it never moved
   * — the same defect `_holding` already carries a comment about, one level further out.
   */
  state._observer.observe(fallback, WATCHING);
  while (slot.firstChild !== null) fallback.appendChild(slot.firstChild);
  /** Out of the document, but KEPT — it is the component's handle on this slot. */
  parent.removeChild(slot);
  const binding: Binding = {
    _start: start,
    _end: end,
    _name: name,
    _fallback: fallback,
    _assigned: false,
    _slot: slot,
    _shown: [],
    _queued: false,
  };
  const seam = bind(state, binding);
  /** Through the name's reassignment, not a fill of this slot alone: if it sits ahead of a slot
   *  already showing that name's content, it takes it (see `refill`). */
  refill(state, binding._name);
  drain(state);
  /** Parking this slot has to park the ones living in its fallback, or a branch-away would strand
   *  their bindings while their nodes go with the discarded DOM. */
  if (nestedStates.length > 0) {
    const own = seam._$park$;
    const inner = nestedStates;
    seam._$park$ = () => {
      for (const state of inner) state._$park$();
      own();
    };
  }
  return seam;
};


/**
 * What the user slotted, by name — the component-internal accessor that answers identically in
 * both modes. Shadow: the native assignment. Light: the capture map, in document order (a fresh
 * array; membership is live, so ask again after mutations). `''`/omitted is the default slot.
 */
export const slotted = (host: Element, name = ''): Node[] => {
  const state = HOSTS.get(host);
  if (state !== undefined) return [...(state._map.get(name) ?? NOTHING)];
  /**
   * **`_root` before `shadowRoot`, because a CLOSED root is not reachable through `shadowRoot`** —
   * it is null there, and reading only that made this return `[]` for a closed component: a silent
   * wrong answer from an accessor documented as answering in either mode. Core keeps the root it
   * attached, in both modes, and exempts `_root` from property mangling precisely so other bundles
   * can read it; `@verajs/styles` already does, for this same reason.
   *
   * Written as a QUOTED access because this bundle mangles `_[a-z]` properties and core's does not
   * mangle this one — `keep_quoted` is what keeps the two spellings the same name in production.
   */
  const root = (host as unknown as Record<string, ShadowRoot | null | undefined>)['_root'] ?? host.shadowRoot;
  if (root != null) {
    /**
     * Matched by READING each slot's name, never by interpolating one into a selector: a name
     * carrying a quote made `slot[name="…"]` an invalid selector and threw a DOMException out of
     * a public accessor, and `slot:not([name])` missed `<slot name="">` — which the platform
     * counts as the default slot (measured against native `assignedNodes`). One rule,
     * `(getAttribute('name') ?? '') === name`, is the platform's own and covers both.
     */
    for (const slot of root.querySelectorAll('slot'))
      if (((slot as HTMLSlotElement).getAttribute('name') ?? '') === name)
        return (slot as HTMLSlotElement).assignedNodes();
  }
  return [];
};

/**
 * SERVER distribution — a self-contained, observer-free, anchor-free pass for SSR. The client
 * path (capture + anchors + a live observer) is meaningless on a server that renders once and
 * flattens templates through its own serializer, so `@verajs/ssr` calls THIS instead, reached
 * off the insert as `_$server$` (like `_$capture$`) so ssr needs no import of this module.
 *
 * Input: the host after its template rendered — `source` are the user's original children
 * (snapshotted before the template ran), and the host also contains the rendered template with
 * literal `<slot>` elements. Output: markerless distributed light DOM — each `<slot>` UNWRAPPED
 * to its assigned nodes (or its own fallback children), the source consumed, and one attribute
 * (`data-vm-slotted="offset,count"`) when the DEFAULT slot received content, which is all
 * hydration needs to tell assigned-from-fallback there.
 */
/**
 * **`"offset,count"`, on the default slot's PARENT — position, not just extent.** A named slot's
 * content self-identifies (the user's nodes carry their own `slot="x"`); the default slot's does
 * not, because bare text is common there and cannot carry an attribute, so the server states it.
 *
 * The count alone is enough to ADOPT — the adoption walk arrives already standing at the right
 * place. It is not enough to RECOVER, and recovery is the case that matters: when hydration hits
 * a mismatch it discards the container and clean-renders, and for a light host the user's slotted
 * content is *inside* what gets discarded. Marked with only a count on the host, content whose
 * slot the walk never reached could not be found again and was destroyed — silently, under a
 * warning that promised the page was still correct. With the position stated, `_$rescue$` lifts
 * the user's nodes back out before the discard, no walk required, and the clean render
 * redistributes them exactly as it would on a first client render.
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
const serverDistribute = (host: Element, source: Node[]) => {
  const buckets = new Map<string, Node[]>();
  for (const node of source) {
    const name = slotNameOf(node);
    if (name === null) continue;
    let bucket = buckets.get(name);
    if (bucket === undefined) buckets.set(name, (bucket = []));
    bucket.push(node);
    if (node.parentNode !== null) node.parentNode.removeChild(node);
  }
  const filled = new Set<string>();
  /** Parents carrying a mark, with the user's first and last node — see the separator pass. */
  const marked: Array<{ parent: Element; first: Node; last: Node; count: number }> = [];
  /** Collect first (the live list mutates as slots are unwrapped). Any nesting order is fine —
   *  a slot is replaced by its content, and a slot inside assigned content was itself resolved. */
  const slotEls: Element[] = [...host.querySelectorAll('slot')];
  for (const slot of slotEls) {
    const parent = slot.parentNode;
    if (parent === null) continue; // already unwrapped as another slot's assigned content
    const name = slot.getAttribute('name') ?? '';
    const assigned = !filled.has(name) ? buckets.get(name) : undefined;
    if (assigned !== undefined && assigned.length > 0) {
      filled.add(name);
      for (const node of assigned) parent.insertBefore(node, slot);
      /** The DEFAULT slot's content is unmarkable in the body (it may be bare text), so its
       *  PARENT states where it is and how much of it there is. Named slots self-delimit by
       *  their own `slot` attribute and need nothing. Offset is stable: slots are unwrapped in
       *  document order, so everything before this one is already final. */
      /** The mark is written after the separator pass — see it for why position is computed once,
       *  at the end, rather than here where the nodes are still moving. */
      if (name === '')
        marked.push({
          parent: parent as Element,
          first: assigned[0],
          last: assigned[assigned.length - 1],
          count: assigned.length,
        });
    } else {
      /** Fallback: the slot's own children, unwrapped in place. */
      let child = slot.firstChild;
      while (child !== null) {
        const next = child.nextSibling;
        parent.insertBefore(child, slot);
        child = next;
      }
    }
    parent.removeChild(slot);
  }
  /** Whatever no slot claimed goes into the inert carrier, in its original order per name. */
  /**
   * **Separators where two text runs would MERGE, because serialization is where node identity
   * dies.** The `offset,count` mark counts nodes as they are HERE; the client's parser joins
   * adjacent text into one node, and the mark then addresses a node spanning a boundary it cannot
   * see. Both edges of the user's content are at risk and each corrupts a different reader:
   *
   * - the TRAILING edge breaks adoption's count — measured, `<main><slot>fb</slot> TAIL</main>`
   *   served "BODY TAIL" and hydrated to "BODY TAIL TAIL", the static text adopted twice.
   * - the LEADING edge breaks the offset, which only `rescue` reads — so a hydration bail would
   *   slice the wrong range and keep the component's markup instead of the user's.
   *
   * Run AFTER the slot loop, because until every slot is unwrapped the neighbor of a boundary is
   * still a `<slot>` element and the merge is not yet visible. Emitted by the side that KNOWS: the
   * alternative was to have hydration infer the boundary from the canonical template, which works
   * for the shape in front of you and needs a new case for each thing that can follow a slot
   * (static text, another default slot's fallback, a named slot's fallback, and whether that named
   * slot receives content at all) — one rule here removes the class instead of handling members of
   * it. React emits the same 7 bytes for the same reason.
   */
  for (const { first, last } of marked) {
    const doc = host.ownerDocument!;
    const ahead = first.previousSibling;
    if (ahead !== null && ahead.nodeType === 3 && first.nodeType === 3)
      first.parentNode!.insertBefore(doc.createComment(''), first);
    const behind = last.nextSibling;
    if (behind !== null && behind.nodeType === 3 && last.nodeType === 3)
      last.parentNode!.insertBefore(doc.createComment(''), behind);
  }

  let carrier: Element | null = null;
  for (const [name, bucket] of buckets) {
    if (filled.has(name) || bucket.length === 0) continue;
    if (carrier === null) {
      carrier = host.ownerDocument!.createElement('template');
      carrier.setAttribute(UNASSIGNED_MARK, '');
    }
    for (const node of bucket) carrier.appendChild(node);
  }
  if (carrier !== null) host.appendChild(carrier);

  /**
   * **The mark is written LAST, because it records a POSITION and position is only true once
   * nothing else will move.** Computing it in the slot loop and then inserting separators put the
   * two out of step by exactly one node: the recorded offset addressed the separator rather than
   * the content, and the rescue — the only reader of the offset — kept nothing, so a hydration
   * bail showed the component's own fallback with the user's content gone. Every hydration test
   * still passed, because adoption reads only the count.
   *
   * Writing it here rather than merely after the separators is the difference between a fix and a
   * rule: the carrier append above, and anything added below it later, cannot silently reintroduce
   * the same defect. One place computes position, and it is downstream of every pass that moves a
   * node — which is a property of the ORDER, not of remembering to check.
   */
  for (const { parent, first, count } of marked) {
    let offset = 0;
    for (let n = parent.firstChild; n !== null && n !== first; n = n.nextSibling) offset++;
    parent.setAttribute(SLOTTED_ATTR, `${offset},${count}`);
  }
};


/**
 * Capture a light host's children at its FIRST render, before any slot has necessarily mounted —
 * so content destined for a slot that only appears later (a conditional `<slot>` behind a branch)
 * is held invisibly meanwhile, exactly as native shadow DOM leaves an unassigned light child
 * unrendered. Idempotent (capture is once per host); the renderer calls it once per host lifetime.
 */
(takeOverSlot as { _$capture$?: (host: Element, boundary?: Comment) => void })._$capture$ = (
  host,
  boundary,
) => {
  if ((globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed) return;
  flushPending();
  capture(host, false, boundary);
  drain(HOSTS.get(host)!);
};
/**
 * **A part's content in a light host: the stretch of the host's logical list between its markers.**
 * Distribution MOVES a host's children, so a part rendering them keeps its markers in the host while
 * its content lives elsewhere — and what a nested part inserted later lives elsewhere too. The list
 * keeps all of it in light-tree order wherever it physically sits, so this is how the renderer clears
 * or parks such a part: exactly what native would find between the markers, nested parts included.
 * `undefined` when the markers are not in one host's list — the renderer then uses its own record.
 */
(takeOverSlot as { _$span$?: (start: Node, end: Node) => Node[] | undefined })._$span$ = (start, end) => {
  const state = OWNER.get(start);
  if (state === undefined || OWNER.get(end) !== state) return undefined;
  const light = state._light;
  const from = light.indexOf(start);
  const to = light.indexOf(end);
  return from === -1 || to < from ? undefined : light.slice(from + 1, to);
};
/** The server hook — SSR calls this (never the client capture/anchor path). */
(takeOverSlot as { _$server$?: (host: Element, source: Node[]) => void })._$server$ = serverDistribute;

/**
 * HYDRATION adopt — wrap already-distributed server nodes as a live binding IN PLACE, so a
 * server-rendered slot component becomes fully interactive with zero node churn: the user's nodes
 * keep their identity (focus, input values), and the capture map + observer come alive for
 * re-renders and mutations. Called by the hydrate entry once per `<slot>` it reconciles.
 *
 * `assigned` are the user's nodes already sitting at the slot position (null/empty ⇒ the slot
 * showed its fallback, which is `fallback` — those nodes are already in place too). `parent` and
 * `before` bound where anchors go. Returns the binding's park state, exactly like `takeOverSlot`.
 */
const adoptSlot = (
  host: Element,
  name: string,
  assigned: Node[] | null,
  fallback: Node[],
  parent: Node,
  before: Node | null,
  /** The hydrator's per-instance `<slot>` — a shallow clone of the canonical one, carrying this
   *  instance's committed bindings. Appended, so a slots build paired with an older hydrate build
   *  degrades to no element rather than breaking. */
  slot?: Element,
): SeamState => {
  flushPending();
  const state = capture(host, /* skipChildren */ true);
  const doc = host.ownerDocument!;
  const start = doc.createComment('');
  const end = doc.createComment('');
  /** Anchors bracket whatever is shown (assigned nodes, or the fallback the server rendered). */
  const firstShown = (assigned && assigned.length > 0 ? assigned[0] : fallback[0]) ?? before;
  parent.insertBefore(start, firstShown ?? before);
  parent.insertBefore(end, before);
  const isAssigned = assigned !== null && assigned.length > 0;
  /**
   * `_fallback` holds the DISPLACED region and is empty while the region is on screen, so which
   * branch this is decides where these nodes belong. Assigned: the server never rendered the
   * fallback and these are clones off the canonical template, displaced from the start — they go
   * into the fragment. Unassigned: the server DID render them and they are live in the page
   * between the anchors, so they stay exactly where they are and the fragment starts empty.
   * Moving them would delete server output from the document.
   */
  const held = doc.createDocumentFragment();
  state._parks.add(held);
  OUTSIDE.set(held, state);
  state._observer.observe(held, WATCHING);
  if (isAssigned) for (const node of fallback) held.appendChild(node);
  if (isAssigned)
    for (const node of assigned!) {
      /**
       * Into the logical list in visit order: the adoption walk visits slots in document order and
       * the server preserved within-name order, so this reproduces the light tree as it can be known.
       */
      state._light.push(node);
      OWNER.set(node, state);
      state._names.set(node, name);
    }
  if (isAssigned) rebuild(state, name);
  const binding: Binding = {
    _start: start,
    _end: end,
    _name: name,
    _fallback: held,
    _assigned: isAssigned,
    _slot: slot,
    _shown: [],
    _queued: false,
  };
  const seam = bind(state, binding);
  /** The server already put the assignment in place, so nothing is filled here — but a slot that
   *  HAS an assignment has just been flattened, and the platform fires `slotchange` for that. A
   *  hydrated component therefore hears the same first event a client-rendered one does. */
  if (isAssigned) {
    binding._shown = assigned!.slice();
    signal(state, binding);
  }
  drain(state);
  return seam;
};
(takeOverSlot as { _$adopt$?: typeof adoptSlot })._$adopt$ = adoptSlot;

/**
 * HYDRATION rescue — **the user's content must survive a mismatch.** When adoption fails, the
 * hydrator discards the container's server markup and clean-renders it; for a light host the
 * user's slotted nodes are *inside* that markup, so the discard destroyed them and the slots
 * showed fallback, under a warning promising the page was still correct. It was not: content was
 * gone from the page for good.
 *
 * This un-distributes instead: it lifts the user's nodes back out, using exactly the two things
 * the server states about them — a named node carries its own `slot`, and the default slot's
 * parent carries `data-vm-slotted="offset,count"` — and returns them for the caller to re-attach
 * as the host's children. From there nothing is special-cased: the clean render captures them the
 * way it captures any first client render.
 *
 * **Never descends into another component.** A nested host's children are its own source, which
 * it will capture (or rescue) itself when it renders; taking them here would hand one component's
 * content to another. A custom element is therefore collected as a node and never entered.
 *
 * One documented edge: a component whose FALLBACK content carries a `slot` attribute
 * (`<slot name="a"><i slot="a">…</i></slot>`) has that fallback rescued as if the user wrote it.
 * The attribute is meaningless on fallback in native shadow DOM too — it only means anything on a
 * host's children — so the markup was already saying something it does not mean.
 */
const rescue = (host: Element): Node[] | null => {
  flushPending();
  const rescued: Node[] = [];
  const collect = (parent: Element) => {
    const mark = parent.getAttribute(SLOTTED_ATTR);
    let from = -1;
    let until = -1;
    if (mark !== null) {
      const comma = mark.indexOf(',');
      from = Number(mark.slice(0, comma));
      until = from + Number(mark.slice(comma + 1));
    }
    let index = 0;
    for (let child = parent.firstChild; child !== null; child = child.nextSibling, index++) {
      if (index >= from && index < until) {
        rescued.push(child);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      /**
       * The inert carrier holds what no slot claimed — user content too, and its nodes live in
       * `content`, not `childNodes`.
       *
       * **The tag is checked, not just the attribute.** This walks the SERVER's subtree, which is
       * full of the user's own markup, and `data-vm-unassigned` on anything that is not a
       * `<template>` reached `.content` on an element that has none: a TypeError thrown out of
       * `renderInto`, so the mismatch never finished falling back and the page was left with no
       * client render at all. Reserved attribute or not, a user's markup cannot be allowed to do
       * that — and `capture` was already checking both.
       */
      if (element.localName === 'template' && element.hasAttribute(UNASSIGNED_MARK)) {
        const held = (element as HTMLTemplateElement).content;
        for (let node = held.firstChild; node !== null; node = node.nextSibling) rescued.push(node);
        continue;
      }
      if (element.hasAttribute('slot')) rescued.push(element);
      else if (element.localName.indexOf('-') === -1) collect(element);
    }
  };
  collect(host);
  for (const node of rescued) node.parentNode?.removeChild(node);
  return rescued.length > 0 ? rescued : null;
};
(takeOverSlot as { _$rescue$?: typeof rescue })._$rescue$ = rescue;

/** Development only: the renderer checks that it and this module come from one version. */
(takeOverSlot as { _$b$?: typeof beginRender })._$b$ = beginRender;
(takeOverSlot as { _$e$?: typeof endRender })._$e$ = endRender;
if (__DEV__) (takeOverSlot as { $v?: string }).$v = __VERSION__;

/**
 * **Slot discovery — finding the `<slot>`s for whatever slot strategy is wired.** Two pieces: a
 * `'template'` hook that marks a template holding a `<slot>` with an instance hook (see
 * `InstanceHook` in the renderer), and a connector that keeps the registry, so the instance hook
 * hands each `<slot>` to the strategy registered on `'slot'` — this module's, or anyone's.
 *
 * Its own export so a custom strategy is one line from working: `wire([renderer, slotDiscovery,
 * myStrategy])`. `slots` includes it. Before 2026-09-24 the renderer did this itself, for every
 * app, slots or not.
 */
let registered: Map<string, unknown[]> | null = null;
type Strategy = (slot: Element, root: Node, name: string) => SeamState | null | undefined;

/**
 * Each instance of a marked template: find its `<slot>`s now (`$c`), hand them over after its first
 * update (`$m`), park them at teardown (`$q`). Found BEFORE the update because the update and the
 * takeovers both mutate the fragment (a takeover lifts its `<slot>` out and drops in anchors), so
 * they are collected first and acted on after; and like a render, the walk does not reach into a
 * nested `<template>`'s content. Handed over AFTER, because a `<slot>`'s own bindings are part of
 * its meaning: `<slot name=${…}>` has no name until its binding commits.
 *
 * **Positions, not a query per instance.** Every instance of a template starts as a clone of the
 * same markup, so the first instance's walk records where the `<slot>`s are and every later one
 * steps straight to them. A `querySelectorAll` per instance cost WebKit 3–4% on slotted creation
 * (2026-09-26); the walk to known positions measured level on all three engines.
 *
 * A null root is hydration's adoption path, which adopts slots itself.
 */
/**
 * One walker for every template — ELEMENT|TEXT, the order the positions are counted in. Made at the
 * first slotted instance, never at import: `@verajs/ssr` imports this module in Node, where
 * there is no `document` (`tests/node-import-safety.test.mjs`); each slotted instance pays one check.
 */
let slotWalker: TreeWalker | undefined;
/** Development only: the discovery-without-a-strategy warning, once. */
let strategyNamed = false;
const discoverFor = (): InstanceHook => {
  let positions: number[] | undefined;
  return {
    $c: (fragment, root) => {
      if (root === null) return undefined;
      const walker = (slotWalker ??= document.createTreeWalker(document, 5));
      walker.currentNode = fragment;
      const found: Element[] = [];
      let at = -1;
      let node: Node | null;
      /** The first instance walks it all and learns; every later one stops at the last `<slot>`. */
      if (positions === undefined) {
        positions = [];
        while ((node = walker.nextNode()) !== null) {
          at++;
          if ((node as Element).localName === 'slot') {
            positions.push(at);
            found.push(node as Element);
          }
        }
      } else {
        for (let k = 0; k < positions.length; ) {
          node = walker.nextNode();
          if (++at === positions[k]) found[k++] = node as Element;
        }
      }
      return found.length === 0 ? undefined : found;
    },
    $m: (found, root) => {
      const strategy = registered?.get('slot')?.[0] as Strategy | undefined;
      if (strategy === undefined) {
        /** Development only: discovery with nothing to hand its `<slot>`s to is otherwise silent. */
        if (__DEV__ && !strategyNamed) {
          strategyNamed = true;
          console.warn(
            "[vera] slots: `slotDiscovery` is wired but no 'slot' strategy is — every `<slot>` it finds " +
              'shows its fallback. Wire `slots` from @verajs/renderer/slots, or a strategy beside `slotDiscovery`.'
          );
        }
        return undefined;
      }
      const slots = found as Element[];
      let taken: SeamState[] | undefined;
      for (let i = 0; i < slots.length; i++) {
        const state = strategy(slots[i], root!, slots[i].getAttribute('name') ?? '');
        if (state != null) (taken ??= []).push(state);
      }
      return taken;
    },
    $q: (taken) => {
      for (const state of taken as SeamState[]) state._$park$?.();
    },
  };
};

/**
 * The `'template'` hook: mark a template that holds a `<slot>`. Read off the template's strings,
 * case-insensitively because the parser lowercases tag names. A `<slot` inside an attribute value
 * or a comment marks a template with no slot, which costs its first instance one walk that finds nothing; a real
 * `<slot>` element always has the text, so none is missed. A template `@verajs/renderer/namespaces`
 * builds for another namespace goes through the same hook and is marked too.
 */
const SLOT_TAG = /<slot[\s/>]/i;
const markTemplate = (built: object, result: { strings: TemplateStringsArray }) => {
  if (!SLOT_TAG.test(result.strings.join(''))) return;
  const template = built as { _$inst$?: InstanceHook };
  /**
   * **A template carries ONE instance hook, and a consumer that finds one wraps it** — the rule
   * `InstanceHook` states. This module keeps it at no cost by going FIRST: `slotDiscovery` runs at
   * priority 10, below the default 50, so it never finds one, and a module wired at the default wraps
   * this module's. Wrapping here as well was measured at 76–102 B of every slotted app, for a second
   * consumer that does not exist. One wired even earlier is overwritten, and development says so.
   */
  if (__DEV__ && template._$inst$ !== undefined)
    console.warn(
      "[vera] slots: a 'template' hook set an instance hook before `slotDiscovery` (priority 10) and is " +
        'replaced. Wire it at a later priority and wrap the hook it finds, as `InstanceHook` describes.'
    );
  template._$inst$ = discoverFor();
};

export const slotDiscovery = [
  (registry: Map<string, unknown[]>) => {
    registered = registry;
  },
  { name: '@verajs/renderer/slot-discovery', on: 'template' as const, fn: markTemplate, priority: 10 },
];

/**
 * The module — `wire([renderer, slots])` and light-DOM slots exist: discovery, plus this strategy
 * on the `'slot'` insert point.
 *
 * `fn` needs no cast: `'slot'` is a declared insert point, so this is checked against `SlotInsert`
 * rather than asserted past the type system. It used to be `as never`, which is what a missing
 * insert type looks like from the inside — and from the OUTSIDE it looked like
 * `wire([renderer, slots])` failing to compile for every TypeScript consumer.
 */
export const slots = [
  slotDiscovery,
  { name: '@verajs/renderer/slots', on: 'slot' as const, fn: takeOverSlot, priority: 50 },
];
