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
 * **Wire it at the app entry, before anything renders.** The renderer resolves this seam once per
 * TEMPLATE, and templates are cached per call site for the life of the page — so a component that
 * rendered before the wiring keeps a slotless template forever. That is the same contract every
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
 * join its slot out of order. Now the renderer stamps everything it emits at a captured host's
 * top level (a non-enumerable `_$own$` property: `true` for a root part's own output — the
 * structural `_end === null` test, so async commits are covered — and the placing part for
 * content from an outer template). An unstamped top-level addition is therefore knowably the
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
 * Behaviour the platform decides is not settled under jsdom.
 */

/** What the seam holds per taken-over slot; `_$park$` rescues the user's nodes before the
 *  instance's DOM is bulk-discarded on a branch-away, and un-registers the binding. */
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
  /** Each kept `<slot>` element back to its binding, so a `name` change is recognised. */
  _ghosts: WeakMap<Element, Binding>;
  /**
   * **Light-tree order, remembered — because distributing a node destroys it.**
   *
   * Native `assignedNodes()` answers in flat-tree order, which for a light child is simply its
   * position among the host's children. A shadow host keeps every child where it was, so that
   * position is always readable. Here the children are MOVED — into a slot's region, or out to
   * the holding fragment when nothing claims them — and once two captured nodes live in different
   * places, nothing in the DOM says which came first.
   *
   * That is invisible while a node stays in one bucket, because the bucket was built in order. It
   * surfaces when a node CHANGES slot: it joins a bucket that may already hold nodes which come
   * after it in the light tree, and the only honest answer is a position the DOM no longer knows.
   * Appending was the old answer and it read as arrival order — an item toggled into a "pinned"
   * slot jumped to the end of the pinned list instead of holding its place.
   *
   * A rank per node is the whole mechanism: assigned once, when the node is first captured, and
   * never touched again — because re-slotting does not move a node in the LIGHT tree, which is the
   * tree this orders. Ranks are compared, never trusted as indices, so gaps from removals are
   * harmless.
   */
  _rank: WeakMap<Node, number>;
  _next: number;
  /** Ranks below every existing one, for a node inserted into the light region ahead of content
   *  already distributed away — see `take`. Counts down; the two never meet in any real host. */
  _min: number;
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
/** Every captured node → its host's sentinel, for `_$home$`. Entries die with their nodes. */
const HOMES = new WeakMap<Node, Comment>();
/**
 * **The light tree's surviving skeleton, indexed.** Distribution moves the CONTENT out of the
 * host, but the part markers never move — so a comment's neighbours at capture time are exactly
 * the positional record a late hand-edit needs. Each comment in the initial walk maps to the
 * member captured immediately after it; placement walks forward from an inserted node to the
 * first recorded comment whose member is still in the right bucket, and goes before that member.
 * A WeakMap and a walk over LIVE nodes only, so a torn-down part's markers take their entries
 * with them and staleness needs no bookkeeping. (Verified before building: a part keeps the SAME
 * marker nodes across template-identity rebuilds, emptying included, so landmarks cannot churn.)
 */
const LANDMARKS = new WeakMap<Node, Node>();

/**
 * What the observer watches, wherever it watches. Hoisted because captured nodes rest in more than
 * one place and every one of them needs the SAME watch — see the `observe` calls in `capture` and
 * the park fragment in `takeOverSlot`.
 */
const WATCHING = { childList: true, subtree: true, attributes: true, attributeFilter: ['slot'] };

/** Slottables are elements and text nodes — comments and the rest are never assigned. */
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;

const bucketOf = (state: HostState, name: string): Node[] => {
  let bucket = state._map.get(name);
  if (bucket === undefined) state._map.set(name, (bucket = []));
  return bucket;
};

/** Take one node into the slot system: bucket it, remember it, and physically hold it. */
/** `ordered`: the caller vouches the node arrives in its final relative order (the initial
 *  capture walk and the server-park recovery — both iterate host order), so placement is a plain
 *  append: O(1), and immune to the fact that earlier-taken siblings are already in holding and
 *  can no longer be position-compared. */
const take = (state: HostState, node: Node, ordered = false, atTail = false): string | null => {
  const name = slotNameOf(node);
  if (name === null) return null;
  const bucket = bucketOf(state, name);
  const binding = activeFor(state, name);
  /**
   * **A node captured where it already belongs stays there.** Whoever put it inside the run put it
   * in a POSITION, and evacuating it to the holding fragment throws that away — it comes back at
   * the end, because the fragment has no idea where it was. A keyed list inserting a row into a
   * light host's children is the case: the row is created under the host, moved among its
   * neighbours, and captured in the same batch, and the position is the only thing that says where
   * it goes.
   *
   * Everything else — a node the user appended, one arriving from the holding fragment — is held
   * as before, and `fill` places it.
   */
  const settled = binding !== undefined && node.parentNode === binding._start.parentNode;
  /**
   * **Where a captured node goes in the bucket — one branch per way of knowing.**
   *
   * SETTLED (already inside its slot's run): document order — whoever moved it there meant that
   * position; a keyed mid-insert lands here. PLACED (stamped with the part that put it in the
   * host): after that part's last member, so a grown row extends its own list and two parts'
   * content in one host cannot interleave; no member yet means append, where a first row belongs.
   * UNSTAMPED (a human's): its position speaks — before the boundary it precedes everything
   * distributed away (document order among nodes still beside it); at or past the boundary it
   * was appended, and appends. The last-member fast path keeps the initial capture walk O(1) per
   * node — each child follows the one before it — instead of O(n²) over a big light list.
   */
  const own = (node as { _$own$?: unknown })._$own$;
  let at = bucket.length;
  /**
   * Set when this node sits in the light region ahead of everything already distributed — the rule
   * the unstamped branch below states in words. It is tracked separately from `at` because `at` is
   * a position in ONE bucket, and a node can land at the end of its own bucket while still
   * preceding every node in every other one. That is exactly the case a prepend into an empty
   * bucket makes: `at` is 0 and means nothing, and ranking from bucket neighbours put the node
   * last when it belonged first.
   */
  let front = false;
  if (ordered) {
    /* the caller's order is the order — fall through to the splice */
  } else if (settled) {
    for (let i = 0; i < bucket.length; i++)
      // eslint-disable-next-line no-bitwise -- DOCUMENT_POSITION_FOLLOWING, the platform's own flag
      if ((node.compareDocumentPosition(bucket[i]) & 4) !== 0) {
        at = i;
        break;
      }
  } else if (own !== undefined) {
    for (let i = bucket.length - 1; i >= 0; i--)
      if ((bucket[i] as { _$own$?: unknown })._$own$ === own) {
        at = i + 1;
        break;
      }
  } else {
    const home = node.parentNode;
    const last = bucket[bucket.length - 1];
    const sentinel = state._sentinel;
    /**
     * **The record is the light-tree truth; the sentinel is only a proxy for it.**
     *
     * `front` is "this node precedes everything already distributed" — inferred here from the
     * node preceding the `_sentinel` in the LIVE DOM. That inference holds when the host is
     * settled, and BREAKS mid-storm on an adopted seam: `flushPending` can process a genuine
     * tail-append while the sentinel is transiently positioned AFTER it, so the append reads as
     * front and takes a negative rank, sorting before the adopted nodes (run-18 residual, root
     * cause). The observer path knows better: a childList record whose `nextSibling` is null was
     * an APPEND at the light-tree tail, immune to any later churn — so `atTail` overrides the
     * proxy outright. A non-null `nextSibling` (prepend, insertBefore) is left to the existing
     * inference, which the settled and client-storm paths already exercise.
     */
    front =
      !atTail &&
      sentinel.parentNode === home &&
      // eslint-disable-next-line no-bitwise -- the node precedes the boundary: the light region
      (node.compareDocumentPosition(sentinel) & 4) !== 0;
    if (
      !atTail &&
      sentinel.parentNode === home &&
      // eslint-disable-next-line no-bitwise -- the node precedes the boundary: the light region
      (node.compareDocumentPosition(sentinel) & 4) !== 0 &&
      last !== undefined &&
      // eslint-disable-next-line no-bitwise -- fast append: skip the scan when the last member already precedes it
      !(last.parentNode === home && (last.compareDocumentPosition(node) & 4) !== 0)
    ) {
      /**
       * LANDMARKS first — exact where available: the nearest recorded comment after the node
       * names the member it belongs before, which places a hand-edit BETWEEN two parts' groups
       * where the scan below can only say "ahead of everything distributed". Skips members that
       * left this bucket (pulled, or another slot's) by walking on; bounded by the sentinel.
       */
      let placed = false;
      for (let next = node.nextSibling; next !== null && next !== sentinel; next = next.nextSibling) {
        const member = next.nodeType === 8 ? LANDMARKS.get(next) : undefined;
        if (member !== undefined) {
          const found = bucket.indexOf(member);
          if (found !== -1) {
            at = found;
            front = false;
            placed = true;
            break;
          }
        }
      }
      /**
       * **Backward too, because the skeleton has landmarks on both sides.** Looking only forward
       * meant that when every following landmark named a member that had since been removed or
       * re-slotted elsewhere, placement fell through to the scan below — which knows nothing
       * finer than "ahead of everything distributed" and so put the edit FIRST. Measured against a
       * shadow root given the same disturbance: it answers `A,U` and this answered `U,A`.
       *
       * A preceding landmark names the member captured just after it, so a node inserted after
       * that comment belongs after that member — the mirror of the forward rule, and it resolves
       * exactly when the forward walk cannot.
       */
      if (!placed)
        for (let prev = node.previousSibling; prev !== null; prev = prev.previousSibling) {
          const member = prev.nodeType === 8 ? LANDMARKS.get(prev) : undefined;
          if (member !== undefined) {
            const found = bucket.indexOf(member);
            if (found !== -1) {
              at = found + 1;
              front = false;
              placed = true;
              break;
            }
          }
        }
      if (!placed)
        for (let i = 0; i < bucket.length; i++) {
          const member = bucket[i];
          // eslint-disable-next-line no-bitwise -- first distributed member, or an in-place member that follows
          if (member.parentNode !== home || (node.compareDocumentPosition(member) & 4) !== 0) {
            at = i;
            break;
          }
        }
    }
  }
  /**
   * **A first sighting takes its light-tree rank from the position just computed.**
   *
   * `at` is this module's best answer to "where does this node belong", worked out from whatever
   * evidence exists — document position, the part that placed it, landmarks, the sentinel. That
   * answer is about ONE bucket, and re-slotting needs the same fact about the light tree, so the
   * rank is interpolated between the neighbours it landed among rather than invented separately.
   * Deriving it here is what makes the two agree by construction; a counter bumped on arrival
   * instead gave a node inserted at the FRONT of the light tree a tail rank, and re-slotting it
   * then sent it to the end — right where it was, wrong where it went.
   *
   * Midpoints, so an insertion never has to renumber. Doubles run out after about fifty
   * insertions between one adjacent pair, which no light host reaches; a re-capture (removed and
   * re-added) starts fresh at the tail, which is also where the platform puts it.
   */
  if (!state._rank.has(node)) {
    const before = at > 0 ? state._rank.get(bucket[at - 1]) : undefined;
    const after = at < bucket.length ? state._rank.get(bucket[at]) : undefined;
    state._rank.set(
      node,
      front
        ? --state._min
        : after === undefined
          ? state._next++
          : before === undefined
            ? after - 1
            : (before + after) / 2
    );
  }
  bucket.splice(at, 0, node);
  state._names.set(node, name);
  HOMES.set(node, state._sentinel);
  if (!settled) state._holding.appendChild(node);
  return name;
};

const pull = (state: HostState, node: Node, name: string) => {
  const bucket = state._map.get(name);
  if (bucket === undefined) return;
  const at = bucket.indexOf(node);
  if (at !== -1) bucket.splice(at, 1);
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
const drain = (state: HostState) => {
  state._observer.takeRecords();
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
const flushPending = (state: HostState) => {
  if (state._flushing) return;
  const records = state._observer.takeRecords();
  if (records.length === 0) return;
  state._flushing = true;
  try {
    processRecords(state._host, state, records);
  } finally {
    state._flushing = false;
  }
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
 * window must dispatch an event that window's code recognises, or a handler's `instanceof` is
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
  /**
   * **The run's current order is remembered before it is taken apart, because it is the intent.**
   *
   * The bucket records what is assigned; its order is the order things were CAPTURED. Re-placing
   * from it therefore undoes any reordering that happened after distribution — and a keyed list
   * rendering a host's children reorders exactly those nodes, in place, where they now live. The
   * symptom was a list that reordered correctly and then snapped back to its original order the
   * next time anything caused a refill.
   *
   * Only the case that is currently wrong changes: when nothing has reordered the run, this order
   * IS the bucket's order and the sort below is the identity.
   */
  const wasShowing = new Map<Node, number>();
  let node = binding._start.nextSibling;
  while (node !== null && node !== binding._end) {
    const next = node.nextSibling;
    wasShowing.set(node, wasShowing.size);
    if (binding._assigned) state._holding.appendChild(node);
    else binding._fallback.appendChild(node);
    node = next;
  }
  const bucket = activeFor(state, binding._name) === binding ? bucketOf(state, binding._name) : NOTHING;
  /**
   * **A stable MERGE, not a re-sort.** Run members keep the run's order (a keyed reorder happens
   * in place, invisible to the observer — the run is its only record). Everything else keeps its
   * BUCKET position, ranked beside the run member it follows: a prepend `take` placed at index 0
   * stays ahead of the run instead of being shoved to the end — which is exactly how the first
   * ordering attempt broke two suites. Equal ranks fall back to bucket order (sort stability is
   * guaranteed), and `NOTHING` is shared and never written to.
   */
  if (wasShowing.size > 0 && bucket !== NOTHING) {
    const rank = new Map<Node, number>();
    let carried = -1;
    for (const member of bucket) {
      const shown = wasShowing.get(member);
      if (shown !== undefined) carried = shown;
      rank.set(member, shown ?? carried + 0.5);
    }
    bucket.sort((a, b) => rank.get(a)! - rank.get(b)!);
  }
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
      state._names.delete(candidate);
      continue;
    }
    parent.insertBefore(candidate, binding._end);
    shown.push(candidate);
  }
  binding._assigned = shown.length > 0;
  if (shown.length === 0) parent.insertBefore(binding._fallback, binding._end);
  if (!same(binding._shown, shown)) {
    binding._shown = shown;
    signal(state, binding);
  }
};

const refill = (state: HostState, name: string) => {
  const binding = activeFor(state, name);
  if (binding !== undefined) fill(state, binding);
};

/**
 * Register one binding for `name` and hand back its park closure — the single source for both the
 * client seam and hydration's adopt, which previously spelled the same registration and the same
 * park body twice (the house's most-repeated defect class). Park rescues assigned user nodes into
 * holding before the instance's DOM is bulk-discarded, unregisters, and promotes the next
 * duplicate slot to the assignment — native's next-in-tree-order.
 */
const bind = (state: HostState, binding: Binding): SeamState => {
  state._bindings.push(binding);
  const slot = binding._slot;
  if (slot !== undefined) {
    state._ghosts.set(slot, binding);
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
const warnedInert = new Set<string>();

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

const processRecords = (host: Element, state: HostState, records: MutationRecord[]) => {
  const touched = new Set<string>();
  const moved: Binding[] = [];
  for (const record of records) {
    if (record.type === 'attributes') {
      const node = record.target;
      /**
       * A kept `<slot>` element renaming itself — `<slot name=${section}>` with a new value. Both
       * names are refilled: the one it left (whose next duplicate, if any, inherits) and the one it
       * joined. The binding itself is filled either way, since it may now be a duplicate and owe
       * its fallback.
       */
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
      const previous = state._names.get(node);
      if (previous !== undefined) {
        const next = slotNameOf(node)!;
        if (next !== previous) {
          pull(state, node, previous);
          /**
           * By LIGHT ORDER, not arrival. The node has not moved in the light tree — only its
           * `slot` attribute changed — so its rank still says where it belongs among whatever the
           * new bucket already holds. Appending here was the whole of the ordering divergence.
           * `fill`'s stable merge preserves this: a member ahead of the current run ranks before
           * it, which is the same rule that keeps a prepend ahead.
           */
          const joining = bucketOf(state, next);
          const rank = state._rank.get(node)!;
          let at = joining.length;
          for (let i = 0; i < joining.length; i++) {
            const other = state._rank.get(joining[i]);
            if (other !== undefined && other > rank) {
              at = i;
              break;
            }
          }
          joining.splice(at, 0, node);
          state._names.set(node, next);
          touched.add(previous);
          touched.add(next);
        }
      }
      continue;
    }
    for (const node of record.addedNodes) {
      /**
       * **Ownership answers capture outright — the heuristic stack this replaces is gone.**
       *
       * Every node the renderer puts at a captured host's top level is stamped: `true` when it
       * is the render's own output, the placing part when it is content from an outer template.
       * So "may I capture this?" is one property read:
       *
       *   `true`   — the component's own output. Never content. (Without this, a component whose
       *              rendered root carries a `slot` attribute had its output eaten.)
       *   a part   — placed content: captured, ordered by its part (see `take`).
       *   absent   — a human put it here: captured with full native semantics, TEXT INCLUDED,
       *              which retires the `slot=`-after-first-render rule and the tail-text hole in
       *              one move. Safe for exactly one reason: the renderer stamps 100% of its own
       *              top-level output — measured across every template shape, and structurally
       *              guaranteed by the `_end === null` root test, async commits included — so
       *              unstamped genuinely means "not the renderer's".
       *
       * Deleted here: the insertion-site reconstruction (`record.nextSibling`, the region helper)
       * — it existed because created-then-moved keyed rows were positionally indistinguishable
       * from user content, and they are stamped now — and the tail attribute arm, the fail-closed
       * stand-in for ownership nobody could know. `record.target === host` still bounds this to
       * TOP-LEVEL additions (current parent alone misses same-batch moves); a component's
       * internal renders mutate deeper parents and are never considered.
       */
      if (
        (record.target === host || node.parentNode === host) &&
        (node as { _$own$?: unknown })._$own$ !== true &&
        !state._names.has(node)
      ) {
        /** `nextSibling === null` in the record means an APPEND at the host's end — the
         *  light-tree tail, snapshotted at mutation time. `take` uses it to override the
         *  sentinel proxy that misfires mid-storm. See the front-detection note there. */
        const name = take(state, node, false, record.nextSibling === null);
        if (name !== null) touched.add(name);
      } else if (!state._names.has(node) && (node as { _$own$?: unknown })._$own$ !== true) {
        /**
         * **A slottable that appeared INSIDE a run, never passing the host's top level.**
         *
         * `splitText` on distributed text is the real case — a highlighting library's core
         * gesture — and the tail is created as a sibling in the COMPONENT's tree, where the rule
         * above does not look. Left uncaptured it was missing from the bucket, so the next refill
         * evacuated it to holding and never brought it back: the text silently lost half of
         * itself, while a shadow root reports both halves assigned and shows them.
         *
         * Captured here, from the record, rather than by having `fill` sweep its run for
         * surprises — the observer holds the exact node, and re-deriving it downstream would be
         * the same inference-instead-of-ownership this module spent its history removing, at the
         * cost of an O(run) scan on every fill of every host forever.
         *
         * Three conditions make it safe, and each is a fact rather than a proxy: the run must be
         * ASSIGNED (a run showing FALLBACK holds the component's own nodes, and adopting those
         * would make a component's fallback into the user's content); the node must lie BETWEEN
         * the anchors, not merely share their parent, or anything dropped elsewhere in that
         * element would be pulled into the slot; and the node's own slot name must MATCH the
         * binding it landed in, so a stray element in a named slot's run is left alone rather
         * than filed under a name it never claimed.
         *
         * Measured before keeping the scan over bindings: with 500 rows rendered inside a host,
         * every one of them an unstamped nested addition that reaches this loop, four bindings
         * cost the same as one (44.5–51.5 ms against 45.1–53.9). DOM work dominates completely.
         */
        for (const binding of state._bindings)
          if (
            binding._assigned &&
            binding._start.parentNode === record.target &&
            // eslint-disable-next-line no-bitwise -- DOCUMENT_POSITION_FOLLOWING, the platform's flag
            (binding._start.compareDocumentPosition(node) & 4) !== 0 &&
            // eslint-disable-next-line no-bitwise -- and the end anchor follows the node in turn
            (node.compareDocumentPosition(binding._end) & 4) !== 0 &&
            slotNameOf(node) === binding._name
          ) {
            take(state, node);
            touched.add(binding._name);
            break;
          }
      }
    }
    for (const node of record.removedNodes) {
      const name = state._names.get(node);
      /**
       * Our evacuations were drained, so an undrained removal of a captured node is the user's.
       * The question is only whether it is still OURS to hold, and there are three answers:
       * detached entirely (`parentNode === null`) is gone; the holding fragment or anywhere in
       * the host's own subtree is a MOVE the add/attribute handling covers — a keyed row created
       * under the host and positioned inside the component in one batch is exactly that; and
       * anywhere else is the user taking the node for themselves.
       *
       * That third case used to read as a move and kept the node captured forever: it was no
       * longer in the run, so the slot showed nothing — not the node, and not its fallback — where
       * a shadow root un-assigns and falls back. `fill` already had the corresponding guard
       * ("the user took this node") but nothing brought it a reason to run.
       */
      if (
        name !== undefined &&
        node.parentNode !== state._holding &&
        !host.contains(node) &&
        !inAnyRun(state, node)
      ) {
        pull(state, node, name);
        state._names.delete(node);
        touched.add(name);
      }
    }
  }
  for (const name of touched) refill(state, name);
  for (const binding of moved) fill(state, binding);
};

const onMutations = (host: Element, records: MutationRecord[]) => {
  const state = HOSTS.get(host)!;
  processRecords(host, state, records);
  drain(state);
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
    _rank: new WeakMap(),
    _next: 0,
    _min: 0,
    _names: new WeakMap(),
    _ghosts: new WeakMap(),
    _event: ((doc.defaultView as { Event?: typeof Event } | null)?.Event ?? Event) as typeof Event,
    _observer: new MutationObserver((records) => onMutations(host, records)),
    /**
     * **The renderer's own root marker, when it has one** — it already delimits where the render's
     * output begins, which is exactly this boundary, so a sentinel of our own was a second comment
     * saying the same thing one position to the left. Only the paths that reach `capture` WITHOUT
     * one (hydration adopts per slot, and its render's marker is not in hand there) still mint it.
     */
    _sentinel: boundary ?? doc.createComment(''),
  });
  HOSTS.set(host, created);
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
      for (const node of [...held.childNodes]) take(created, node, true);
      host.removeChild(child);
    }
  /** Hydration already has the children distributed and registers them itself; a fresh CSR
   *  capture lifts them from the host. */
  if (!skipChildren) {
    /** Comments seen since the last member become its landmarks — see LANDMARKS. */
    let pending: Node[] | null = null;
    for (const node of [...host.childNodes]) {
      if (node.nodeType === 8) (pending ??= []).push(node);
      else if (take(created, node, true) !== null && pending !== null) {
        for (const mark of pending) LANDMARKS.set(mark, node);
        pending = null;
      }
    }
  }
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
  const state = capture(host);
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
  fill(state, binding);
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
 * **The capture map records membership, not order.** Native `assignedNodes()` answers in flat-tree
 * order, so this has to as well, and the bucket's own order is the order things were CAPTURED —
 * which stops being the document's the moment anything reorders the distributed nodes. A keyed list
 * rendering a host's children is exactly that: the DOM came out `cab` and this still said `abc`,
 * while the same component in shadow mode said `cab`. The observer cannot fix it either — it
 * deliberately ignores moves inside the component's own tree, or it would react to every render.
 *
 * The common case is a handful of nodes sharing one parent, so that is the fast path: one walk of
 * that parent's children. Members split across parents — some distributed, some still parked in the
 * holding template — fall back to comparing positions, which is exact wherever they are.
 */
const inDocumentOrder = (bucket: Node[] | undefined): Node[] => {
  if (bucket === undefined || bucket.length < 2) return bucket === undefined ? [] : [...bucket];
  const parent = bucket[0].parentNode;
  let shared = parent !== null;
  for (let i = 1; shared && i < bucket.length; i++) if (bucket[i].parentNode !== parent) shared = false;
  if (!shared)
    return [...bucket].sort((a, b) =>
      // eslint-disable-next-line no-bitwise -- DOCUMENT_POSITION_FOLLOWING, the platform's own flag
      a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1
    );
  const members = new Set(bucket);
  const ordered: Node[] = [];
  for (let node = parent!.firstChild; node !== null; node = node.nextSibling)
    if (members.has(node)) ordered.push(node);
  return ordered;
};

/**
 * What the user slotted, by name — the component-internal accessor that answers identically in
 * both modes. Shadow: the native assignment. Light: the capture map, in document order (a fresh
 * array; membership is live, so ask again after mutations). `''`/omitted is the default slot.
 */
export const slotted = (host: Element, name = ''): Node[] => {
  const state = HOSTS.get(host);
  if (state !== undefined) return inDocumentOrder(state._map.get(name));
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
 * (`data-vera-slotted="offset,count"`) when the DEFAULT slot received content, which is all
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
const SLOTTED_ATTR = 'data-vera-slotted';
/**
 * Unassigned slot content is PRESERVED, not dropped — native leaves an unassigned light child in
 * the DOM (present, unrendered), and a light host has no second tree to hide it in, so the server
 * parks it in an inert `<template>` (exactly what the element is for: parsed, never rendered).
 * Hydration drains it back into holding, so content for a slot that only appears in another state
 * survives the round trip instead of vanishing from the HTML forever.
 */
const UNASSIGNED_MARK = 'data-vera-unassigned';
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
   * **Separators where two text runs would MERGE, because serialisation is where node identity
   * dies.** The `offset,count` mark counts nodes as they are HERE; the client's parser joins
   * adjacent text into one node, and the mark then addresses a node spanning a boundary it cannot
   * see. Both edges of the user's content are at risk and each corrupts a different reader:
   *
   * - the TRAILING edge breaks adoption's count — measured, `<main><slot>fb</slot> TAIL</main>`
   *   served "BODY TAIL" and hydrated to "BODY TAIL TAIL", the static text adopted twice.
   * - the LEADING edge breaks the offset, which only `rescue` reads — so a hydration bail would
   *   slice the wrong range and keep the component's markup instead of the user's.
   *
   * Run AFTER the slot loop, because until every slot is unwrapped the neighbour of a boundary is
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
  capture(host, false, boundary);
  drain(HOSTS.get(host)!);
};
/**
 * A captured node's HOME — the sentinel marking the end of its host's light region. The renderer's
 * text-part upgrade calls this: markers for a part whose text node was captured belong in the
 * HOST, not wherever distribution carried the node (see `_sentinel`). Returns null for a node no
 * light host has captured, which is every node in an app without light slots.
 */
(takeOverSlot as { _$home$?: (node: Node) => Comment | null })._$home$ = (node) => {
  const sentinel = HOMES.get(node);
  return sentinel !== undefined && sentinel.parentNode !== null ? sentinel : null;
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
  state._observer.observe(held, WATCHING);
  if (isAssigned) for (const node of fallback) held.appendChild(node);
  if (isAssigned)
    for (const node of assigned!) {
      bucketOf(state, name).push(node);
      state._names.set(node, name);
      /**
       * RANKED, like every captured node — the adoption walk visits slots in document order and
       * the server preserved within-name order, so sequential ranks reproduce the light tree.
       * Without this, adopted nodes had NO rank: every later rank-ordered merge (a re-slot's
       * splice, take's interpolation) compared against `undefined` and misplaced them — found by
       * the run-18 adopted-seam storms as membership-right, ORDER-wrong divergences from native.
       */
      state._rank.set(node, state._next++);
    }
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
 * parent carries `data-vera-slotted="offset,count"` — and returns them for the caller to re-attach
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
       * full of the user's own markup, and `data-vera-unassigned` on anything that is not a
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

/**
 * The insert descriptor — `wire([renderer, slots])` and light-DOM slots exist.
 *
 * `fn` no longer needs a cast: `'slot'` is a declared insert point now, so this is checked against
 * `SlotInsert` rather than asserted past the type system. It used to be `as never`, which is what a
 * missing insert type looks like from the inside — and from the OUTSIDE it looked like
 * `wire([renderer, slots])` failing to compile for every TypeScript consumer.
 */
export const slots = {
  name: '@verajs/renderer/slots',
  on: 'slot' as const,
  fn: takeOverSlot,
  priority: 50,
};
