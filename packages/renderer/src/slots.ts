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
 * of content distributed away, and past it, appends. One residue, stated so this cannot
 * overclaim: hand-edits interleaved among SEVERAL `${…}` parts' content in one host order
 * approximately — membership is always right. And one parity note: whitespace appended to a
 * light host now suppresses the default fallback, because it does exactly that in a shadow root
 * (measured). `tests/slots-transition-parity.test.mjs` holds the matrix.
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
  /** The slot element's own template children — shown while nothing is assigned, held here
   *  (detached, referenced) while displaced, restored when the slot empties. */
  _fallback: Node[];
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
   * version, at 10, 50 and even an absurd 200 slots on one host, mount is within noise (48.4 vs
   * 48.8 ms at 200), and live mutations and `slotted()` reads are FLAT in the number of slots.
   * Mount is mildly superlinear at that size in both versions, so it belongs to the DOM work and
   * not to this.
   */
  _bindings: Binding[];
  /** Captured nodes that are not currently displayed wait here — out of the document, exactly
   *  like an unassigned light child under native shadow DOM (present, not rendered). */
  _holding: DocumentFragment;
  /** node → its current slot name, for every node ever captured: the identity test that lets
   *  the observer spot USER removals and re-slottings amid the template's own mutations. */
  _names: WeakMap<Node, string>;
  /** Each kept `<slot>` element back to its binding, so a `name` change is recognised. */
  _ghosts: WeakMap<Element, Binding>;
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
const take = (state: HostState, node: Node, ordered = false): string | null => {
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
    if (
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

/** Discard the observer records our own DOM moves just produced — the callback must only ever
 *  see the USER'S mutations. Synchronous, so nothing of the user's can slip into the drain. */
const drain = (state: HostState) => {
  state._observer.takeRecords();
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
 * assigned nodes to holding (they remain captured), fallback nodes to detachment (the
 * `_fallback` array keeps them). A bucket entry the USER spirited away while it was held
 * (removed from holding, or adopted into their own DOM) is purged rather than stolen back.
 */
const fill = (state: HostState, binding: Binding) => {
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
    else parent.removeChild(node);
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
    if (home !== state._holding && home !== null && home !== parent) {
      /** The user took this node for themselves while it was unassigned — respect that. */
      bucket.splice(i--, 1);
      state._names.delete(candidate);
      continue;
    }
    parent.insertBefore(candidate, binding._end);
    shown.push(candidate);
  }
  binding._assigned = shown.length > 0;
  if (shown.length === 0) for (const fallback of binding._fallback) parent.insertBefore(fallback, binding._end);
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
 * that is actually being shown.
 */
const expose = (state: HostState, binding: Binding) => {
  const slot = binding._slot as HTMLSlotElement;
  const read = (flatten?: boolean): Node[] => {
    const bucket = activeFor(state, binding._name) === binding ? (state._map.get(binding._name) ?? NOTHING) : NOTHING;
    return bucket.length > 0 ? [...bucket] : flatten === true ? [...binding._fallback] : [];
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
const onMutations = (host: Element, records: MutationRecord[]) => {
  const state = HOSTS.get(host)!;
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
          bucketOf(state, next).push(node);
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
        const name = take(state, node);
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
        !host.contains(node)
      ) {
        pull(state, node, name);
        state._names.delete(node);
        touched.add(name);
      }
    }
  }
  for (const name of touched) refill(state, name);
  for (const binding of moved) fill(state, binding);
  drain(state);
};

/** Capture the host's children — once, at the first slot the seam hands us for it. */
const capture = (host: Element, skipChildren = false, boundary?: Comment): HostState => {
  let state = HOSTS.get(host);
  if (state !== undefined) return state;
  const doc = host.ownerDocument!;
  const created: HostState = (state = {
    _map: new Map(),
    _bindings: [],
    _holding: doc.createDocumentFragment(),
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
  const watching = { childList: true, subtree: true, attributes: true, attributeFilter: ['slot'] };
  created._observer.observe(host, watching);
  /**
   * HOLDING IS WATCHED TOO. Unassigned nodes wait in a detached fragment, which is not in the
   * host's subtree — so re-slotting one (`slot="a"` → `"b"`) went unseen and the node never moved
   * to its new slot, while native re-assigns a light child whether or not it is currently
   * assigned (measured: displayed nodes re-slotted, held ones silently did not).
   */
  created._observer.observe(created._holding, watching);
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
  const fallback = [...slot.childNodes];
  for (const node of fallback) slot.removeChild(node);
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
      if (name === '') {
        let offset = 0;
        for (let n = parent.firstChild; n !== null && n !== assigned[0]; n = n.nextSibling) offset++;
        (parent as Element).setAttribute(SLOTTED_ATTR, `${offset},${assigned.length}`);
      }
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
  if (isAssigned)
    for (const node of assigned!) {
      bucketOf(state, name).push(node);
      state._names.set(node, name);
    }
  const binding: Binding = {
    _start: start,
    _end: end,
    _name: name,
    _fallback: fallback,
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
