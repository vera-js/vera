/**
 * **`@verajs/renderer/slots` — `<slot>` in a light-DOM component.** `wire([renderer, slots])`.
 *
 * A component that renders into its own element (no shadow root) gets the platform's slot assignment for the
 * children the page gave it: each light child goes to the first `<slot>` of its `slot` name (the default slot for
 * text and unnamed elements), a slot with nothing assigned shows its own content (the fallback), and comments are
 * never assigned.
 *
 * **The renderer knows nothing of it.** A host's light children are divided into UNITS: each static child alone, and
 * each run a binding of the page's template wrote (its markers and everything between them) whole. A unit moves as
 * one piece — never split — so every write the renderer later makes inside it lands where the unit now is, and the
 * renderer's own range stays contiguous. While a `<slot>` has content, the element steps out of the page and its
 * content stands in its place, between this module's two comments; with none, the element is back, showing its
 * fallback. What the page's template later does inside a unit is seen by a `MutationObserver` and re-distributed —
 * synchronously after every component render (core's `'render'` insert), and at the latest by the next microtask.
 */
import { diagnostic, isCustomElementName, SHARED } from '@verajs/shared-utils';
import { PROSE } from './slots-diagnostics.js';
import { elements } from './elements.js';
import { PROTOCOL } from './kinds.js';

/** A slot's assignment name: an element's `slot` attribute, `''` for text; a comment is never slottable. */
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;

/**
 * A light unit: a static child the page wrote (`a === z`), which moves as itself; or a RUN one of its template's
 * bindings writes, between this module's own two comments, which never leaves holding — the renderer walks it there,
 * contiguous, and each node of it a slot takes leaves a STAND-IN comment at its place. Every light node goes to the
 * slot its own `slot` names, exactly as the platform assigns.
 */
type Unit = { a: Node; z: Node };
/** One `<slot>` of a light host: while it has content, `rs`/`re` stand in its place and the element is out. */
type Rec = { slot: Kept; light: Light; rs: Comment | null; re: Comment | null; shown: Node[]; queued: boolean };
/** `_$region$`: a filled slot's region handed over before it mounts — by hydration, the server's two markers. */
type Kept = HTMLSlotElement & { $rec?: Rec; _$region$?: [Comment, Comment] };

/** A host's light children, by unit, in the order the page wrote them, and its slots. */
/**
 * `wait`: captured by a template that placed runs into this host during hydration, before the host's own slots exist —
 * nothing distributes until the first of them mounts, so the nodes stay exactly where the server put them.
 */
type Light = { host: Element; units: Unit[]; holding: Element; recs: Rec[]; dirty: boolean; fresh: boolean; late: boolean; wait: boolean; obs?: MutationObserver; ex?: boolean; hw?: boolean; ho?: boolean; cw?: boolean; hh?: boolean };

/**
 * **Unassigned content stays CONNECTED, as under native slots** — it waits in `<ins hidden data-vm-unassigned>`, the
 * host's first child, rather than out of the page: a component in it keeps running, and assigning or unassigning it is a
 * one-op connected move, which core keeps alive. The container is in the host exactly while it holds a light node —
 * runs' markers and stand-ins are comments, which need no connection — so a host with nothing unassigned has no extra
 * child, and the server, which knows only nodes, emits the same element in the same place.
 *
 * **Why `<ins>`** (Brian, 2026-10-08), measured in all three engines: a standard element, so it is valid HTML and
 * `:defined` (the carrier was `<vm-unassigned>`, a dashed name nothing defined, which discovery loaders tried to import
 * and "wait until everything is defined" checks waited on forever); its content model is TRANSPARENT, so it is valid
 * around whatever it holds (a `<span>` holding a `<section>` is not); and it parses inside a `<p>` where a `<div>` would
 * close the paragraph and eject the host's content. It is known by its attribute: a user's own `<ins>` is light content
 * like any other.
 */
const UNASSIGNED = 'data-vm-unassigned';
/** Into the page before a light node moves in, so the move is connected → connected. */
const park = (light: Light) => {
  if (light.holding.parentNode !== light.host) light.host.insertBefore(light.holding, light.host.firstChild);
  watchHolding(light);
  return light.holding;
};
/**
 * At the end of every pass: in the page exactly while it holds a light node — out once only comments remain, and IN if
 * the renderer wrote a new node straight into a run waiting here while it was out (that node's first connection).
 */
const unpark = (light: Light) => {
  for (let node = light.holding.firstChild; node !== null; node = node.nextSibling) if (node.nodeType !== 8) return void park(light);
  light.holding.remove();
};

const HOSTS = new WeakMap<Element, Light>();
/** The static children an outer template gave a host, recorded when its instance was created (see `hostBehavior`). */
const STATICS = new WeakMap<Element, Set<Node>>();
/** A run's node in a slot, and the comment holding its place in the run — both ways. */
const STAND = new WeakMap<Node, Comment>();
const REAL = new WeakMap<Node, Node>();
/** The slot a light node was placed in (`null`: holding). */
const PLACED = new WeakMap<Node, Rec | null>();
/**
 * A light node CAPTURED WHERE IT STANDS — outside the host, in a slot's region (the server put it there) — before that
 * slot has mounted: where it is, it stays. Slots mount one at a time, and a node waiting for a later one would otherwise
 * read as taken away (see `isWhere`).
 */
const ADOPTED = {} as Rec;

/** The host's light children in the order the page wrote them — a run read through its stand-ins. */
const lightOf = (light: Light): Node[] => {
  const out: Node[] = [];
  for (const unit of light.units) {
    if (unit.a === unit.z) out.push(unit.a);
    else for (let node = unit.a.nextSibling; node !== null && node !== unit.z; node = node.nextSibling) out.push(REAL.get(node) ?? node);
  }
  return out;
};
/** A stand-in is dropped: its node is no longer in a slot (back at its place, or gone). */
const unstand = (node: Node) => {
  const stand = STAND.get(node);
  if (stand === undefined) return;
  STAND.delete(node);
  REAL.delete(stand);
  stand.remove();
};

/**
 * **Where a light node physically is.** A `<slot>` can itself be a light child of another host — slot FORWARDING — and
 * while it has content it is out of the page, its content standing in its place between its two comments: that range is
 * where the node is, and moving the node moves the range.
 */
const firstOf = (node: Node): Node => (node as Kept).$rec?.rs ?? node;
const lastOf = (node: Node): Node => (node as Kept).$rec?.re ?? node;
/** A light node moved before `ref` in `parent` — the whole range of a forwarded slot that is out of the page. */
const move = (parent: Node, node: Node, ref: Node | null) => {
  const last = lastOf(node);
  for (let at: Node | null = firstOf(node); at !== null; ) {
    const next: Node | null = at === last ? null : at.nextSibling;
    parent.insertBefore(at, ref);
    at = next;
  }
};

/** A run's node that sits in a slot, its place in the run held by a comment before `ref` in `parent` — both ways. */
const standIn = (node: Node, parent: Node, ref: Node | null) => {
  const stand = node.ownerDocument!.createComment('');
  parent.insertBefore(stand, ref);
  STAND.set(node, stand);
  REAL.set(stand, node);
};

/** A light node back to holding: a run's node to its place in the run (where its stand-in is), any other to the end. */
const toHolding = (light: Light, node: Node) => {
  const stand = STAND.get(node);
  if (stand !== undefined) {
    move(park(light), node, stand);
    unstand(node);
    PLACED.delete(node);
  } else {
    move(park(light), node, light.holding.lastChild);
    PLACED.set(node, null);
  }
};

/* ── tree order, through slots that are out of the page ────────────────────────────────────────── */

/**
 * The positions that decide a slot's tree order: its own (its element, or the comment standing in its place), and,
 * while it sits inside another slot's element that is OUT of the page (a displaced fallback), that slot's position
 * first. `null` when the chain ends outside the host — a slot parked away by `hold`, which takes part in nothing.
 */
const chain = (rec: Rec): Node[] | null => {
  const out: Node[] = [];
  let node: Node = rec.rs ?? rec.slot;
  for (;;) {
    out.unshift(node);
    if (rec.light.host.contains(node)) return out;
    let root: Node = node;
    while (root.parentNode !== null) root = root.parentNode;
    const outer = (root as Kept).$rec;
    if (outer === undefined || outer.rs === null) return null;
    node = outer.rs;
  }
};
/** Whether `b` comes after `a` in tree order — the platform's `DOCUMENT_POSITION_FOLLOWING` bit. */
// eslint-disable-next-line no-bitwise -- compareDocumentPosition answers in the platform's own bitmask
const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & 4) !== 0;
const before = (x: Node[], y: Node[]) => {
  for (let i = 0; i < x.length && i < y.length; i++)
    if (x[i] !== y[i]) return follows(x[i], y[i]);
  return x.length < y.length;
};

/* ── distribution ──────────────────────────────────────────────────────────────────────────────── */

/**
 * **A filled slot's region is bounded by two comments, spelled the same on both sides.** The client creates them here;
 * the server writes exactly them (`@verajs/ssr`), so a server-rendered host and a client-distributed one are the
 * same DOM down to comment data, and hydration ADOPTS the server's instead of creating its own. Measured 2026-10-07:
 * that end state hydrates faster than any marking that makes the client split text and create markers (Chrome −11%,
 * Firefox −37%, WebKit −9% on a worst case), and it needs no counting, so nothing depends on how the browser decodes
 * text. The data carries no slot name or index: pairing is positional, and a name could close the comment.
 */
const RANGE_START = '[';
const RANGE_END = ']';

const region = (rec: Rec) => {
  if (rec.rs !== null) return;
  const doc = rec.slot.ownerDocument;
  const parent = rec.slot.parentNode!;
  rec.rs = doc.createComment(RANGE_START);
  rec.re = doc.createComment(RANGE_END);
  parent.insertBefore(rec.rs, rec.slot);
  parent.insertBefore(rec.re, rec.slot);
  rec.slot.remove();
  watch(parent, rec.light);
};
const unregion = (rec: Rec) => {
  if (rec.rs === null) return;
  rec.rs.parentNode?.insertBefore(rec.slot, rec.rs);
  rec.rs.remove();
  rec.re!.remove();
  rec.rs = rec.re = null;
};

/** `slotchange`, as the platform fires it: once per slot per change, after the change, on the slot element. */
const changed = (rec: Rec) => {
  if (rec.queued) return;
  rec.queued = true;
  queueMicrotask(() => {
    rec.queued = false;
    rec.slot.dispatchEvent(new (rec.slot.ownerDocument.defaultView!.Event)('slotchange', { bubbles: true, composed: false }));
  });
};

/**
 * Whether a node is in this host's holding or one of its slots' regions — or where the server put it (`ADOPTED`), which
 * holds until its slot mounts, as `isWhere` holds a static: a slot mounting first must not read the run's node in a
 * later slot's served region, not yet registered, as taken.
 */
const inLight = (node: Node, light: Light): boolean => {
  if (PLACED.get(node) === ADOPTED) return true;
  const parent = node.parentNode;
  if (parent === null) return false;
  if (parent === light.holding) return true;
  for (const rec of light.recs) if (rec.re !== null && rec.re.parentNode === parent) return true;
  return false;
};
/** Whether a light node is still where this module put it — false once something else took it (the user's adoption stands). */
const isWhere = (node: Node, light: Light): boolean => {
  const rec = PLACED.get(node);
  if (rec === ADOPTED) return true;
  const parent = firstOf(node).parentNode;
  if (rec === undefined) return parent === light.holding;
  /** `PLACED` is shared by every host: a node another host has placed is not this one's, wherever it sits. */
  return rec === null ? parent === light.holding : rec.light === light && parent !== null && parent === rec.re?.parentNode;
};

/**
 * **Every light node to its slot, in light order** — the whole decision, recomputed. A node something else took away
 * is forgotten first; then each name's first slot in tree order wins, its nodes go between its comments (a run's node
 * leaving a stand-in at its place), a slot left with nothing shows its fallback, and the rest wait in holding.
 */
/**
 * A distribution in progress can render (a slotted component moved is reconnected, and renders): the render's end asks
 * for another, which waits for this one to finish and then runs.
 */
let busy = false;
const distribute = (light: Light) => {
  if (busy) {
    /**
     * Unreached outside the work set in every suite (18 hits, all already marked — a first connection is a fresh capture);
     * kept because the invariant requires a dirty light in work, and redundancy here is not proven. Unlike `settleIn`'s
     * mark (removed: its only caller marks first), this one is equivalent by observation only.
     */
    mark(light);
    return;
  }
  busy = true;
  try {
    do place(light);
    while (light.dirty);
  } finally {
    busy = false;
  }
};
const place = (light: Light) => {
  light.dirty = false;
  const holding = light.holding;
  /**
   * **THE INVARIANT: a slotted node moves in ONE DOM operation, connected → connected.** Core tells a move from a removal
   * by `isConnected` at `disconnectedCallback` (the platform runs it after the operation), so one `insertBefore` from
   * where the node is to where it goes keeps a slotted component alive; a hop through holding (a fragment) is a real
   * disconnect, and the component is torn down and set up again. `tests/core-keep-alive.test.mjs` pins it.
   *
   * **Captured and not yet distributed: placed straight from the host.** A node a slot takes moves host → slot in ONE
   * operation, which the platform — and core — see as a move, not a removal (`isConnected` stays true through it): a
   * slotted component is not torn down and set up again. Only what no slot takes, and a run's own markers, go to holding.
   */
  const fresh = light.fresh;
  /**
   * Parked only when the render ENDS (`ending`): its slots have all mounted by then, so a node no slot took really has
   * none. Parked earlier — at the first slot's mount — a node for a later slot would hop host → holding → slot, two
   * operations, and be torn down and set up again on the way.
   */
  /**
   * **What clears `fresh`: only a render that ENDS** (`_$done$`, after the commit). A first render that THROWS out of
   * `renderInto` skips it, and the host stays fresh — its captured children still where the page put them, its runs
   * still in the host — until a render completes. That is consistent, not stale: a failed commit mounts no slot (mounts
   * run at a render's end), so no region exists for `inRun` to misread, and a user's edit meanwhile is an ordinary
   * host record (`adopt`). Pinned in `tests/renderer-slots.test.mjs`.
   */
  if (ending) light.fresh = false;
  const host = light.host;
  const home = (node: Node) => firstOf(node).parentNode === holding || (fresh && firstOf(node).parentNode === host);
  light.units = light.units.filter((unit) => (unit.a === unit.z ? isWhere(unit.a, light) || (fresh && firstOf(unit.a).parentNode === host) : home(unit.a) && home(unit.z)));
  for (const unit of light.units)
    if (unit.a !== unit.z)
      for (let node = unit.a.nextSibling; node !== null && node !== unit.z; node = node.nextSibling) {
        const real = REAL.get(node);
        /** The renderer moves a run's nodes between this host's slots (beside a neighbor it follows); only leaving them all is a theft. */
        if (real !== undefined && !inLight(real, light)) {
          PLACED.delete(real);
          unstand(real);
        }
      }
  const live: { rec: Rec; at: Node[] }[] = [];
  /** A slot parked away (by `hold`) takes part in nothing — and what it shows waits with it, untouched. */
  const parked = new Set<Rec>();
  for (const rec of light.recs) {
    const at = chain(rec);
    if (at !== null) live.push({ rec, at });
    else parked.add(rec);
  }
  live.sort((x, y) => (before(x.at, y.at) ? -1 : 1));
  const winner = new Map<string, Rec>();
  for (const { rec } of live) {
    const name = rec.slot.getAttribute('name') ?? '';
    if (!winner.has(name)) winner.set(name, rec);
  }
  const nodes = lightOf(light);
  /** A static child moves as itself; only a node of a binding's RUN leaves a stand-in at its place. */
  const statics = new Set<Node>();
  for (const unit of light.units) if (unit.a === unit.z) statics.add(unit.a);
  const wanted = new Map<Rec, Node[]>();
  const taken = new Set<Node>();
  for (const node of nodes) {
    const name = slotNameOf(node);
    const rec = name === null ? undefined : winner.get(name);
    if (rec === undefined) continue;
    let list = wanted.get(rec);
    if (list === undefined) wanted.set(rec, (list = []));
    list.push(node);
    taken.add(node);
  }
  for (const { rec } of live) {
    const mine = wanted.get(rec) ?? [];
    if (mine.length > 0) {
      region(rec);
      const parent = rec.re!.parentNode!;
      /** Only what is out of place moves: a move disconnects and reconnects a component, re-running its lifecycle. */
      let previous: Node = rec.rs!;
      for (const node of mine) {
        const first = firstOf(node);
        if (first.parentNode === parent && first.previousSibling === previous) {
          previous = lastOf(node);
          continue;
        }
        /** A run's node, still at its place in holding: a stand-in takes the place before it leaves. */
        if (!statics.has(node) && home(node) && !STAND.has(node)) standIn(node, first.parentNode!, first);
        move(parent, node, previous.nextSibling);
        /** Marked as moved by slots: the renderer follows it here when it inserts beside it (see `into`). */
        (node as Node & { _$slotted$?: boolean })._$slotted$ = true;
        PLACED.set(node, rec);
        previous = lastOf(node);
      }
    }
    if (mine.length !== rec.shown.length || mine.some((node, i) => node !== rec.shown[i])) {
      rec.shown = mine;
      changed(rec);
    }
  }
  for (const node of nodes) {
    if (taken.has(node)) continue;
    const rec = PLACED.get(node);
    if (rec !== undefined && rec !== null && parked.has(rec)) continue;
    /** Adopted and waiting for its slot, which mounts later in the same render: it stays where the server put it. */
    if (rec === ADOPTED && !ending) continue;
    if (STAND.has(node) || (rec !== undefined && rec !== null) || (ending && statics.has(node) && node.parentNode === host)) toHolding(light, node);
  }
  /** A run captured in the host goes to holding now — its markers, stand-ins and unassigned nodes; its slotted nodes left in one move each. */
  if (fresh && ending)
    for (const unit of light.units)
      if (unit.a !== unit.z && unit.a.parentNode === host) {
        const run: Node[] = [];
        for (let node: Node | null = unit.a; node !== null; node = node.nextSibling) {
          run.push(node);
          if (node === unit.z) break;
        }
        for (const node of run) (node.nodeType === 8 ? holding : park(light)).insertBefore(node, holding.lastChild);
      watchHolding(light);
      }
  for (const { rec } of live) if (!wanted.has(rec)) unregion(rec);
  unpark(light);
};

/* ── the observer: what the page's templates (and the user) do afterwards ─────────────────────── */

/**
 * **An observer per light** — never one shared by every host: Gecko's `observe()` is linear in what that observer
 * already watches, removed nodes included, through collections (2000 observes 4 → 45 ms over ten batches on one observer,
 * flat on a fresh one, flat on Chromium and WebKit), so a shared one made every new light host slower in Firefox without
 * end (2000 hosts: 262 → 9305 ms over eight renders that replaced them; flat now). A light's observer goes with it.
 *
 * From THIS module's own realm, which cannot close while its code runs — a MutationObserver watches nodes of another
 * document (measured on Chromium, Firefox and WebKit). Taking it from a host's window went deaf with that window: a
 * light host in an iframe or a popped-out window, closed later (`tests/browser/slots-realm.test.js`). The host's window
 * is the fallback only where this realm has no observer at all.
 */
const observerOf = (light: Light): MutationObserver => {
  const Observer = globalThis.MutationObserver ?? (light.host.ownerDocument.defaultView as typeof globalThis).MutationObserver;
  /**
   * Bound to their light (2026-10-17): a record can only reach a light through what THAT light registered, so it arrives
   * already knowing whose it is — no node → lights lookup, and no per-node bookkeeping (a WeakMap entry and a Set for every
   * watched node were ~164 ms of Chrome's slots creation at 10 000 hosts).
   */
  const handle = (records: MutationRecord[]) => {
    note(light, records);
    flush();
  };
  /**
   * ONE per light (2026-10-17; probe P3 vs P2: ~1 point of creation in each engine): its registrations are on distinct nodes —
   * the host's subtree for childList, each light element and slot for its attributes, holding and a fallback's region
   * parent for childList — so none replaces another's options, except a node both a light element and a slot (`own`).
   */
  return (light.obs ??= new Observer(handle));
};
/**
 * **A `hold()`-parked branch, watched while it is parked** — a slot's region in it is out of its host's subtree, where
 * the host's own attribute registration cannot see a node in it renamed (`slot=`): re-routed now, as native slots would.
 * One observer for every parked root (the renderer's `_$parked$`), registering the same root again when it parks again.
 */
let parkedObserver: MutationObserver | undefined;
/** Each parked branch's owner — the container whose render parked it (a WeakMap on the parked root: parking is rare). */
const PARKED = new WeakMap<Node, Node>();
const parkedHandle = (records: MutationRecord[]) => {
  noteParked(records);
  flush();
};
/**
 * A light's pending records. A light in the work set (`all` false) is not asked while it has no childList registration
 * (its first render): its renames stay with the callback, and `takeRecords()` on every host every pass was ~114 ms of
 * Chrome's slots creation at 10 000 hosts (2026-10-17).
 */
const take = (light: Light, all = true): MutationRecord[] =>
  light.obs === undefined || (!all && light.ho !== true && light.cw !== true) ? [] : light.obs.takeRecords();
/**
 * **This module's own moves, dropped** — what was pending before them was read at the start of the same pass. Nothing to
 * drop while the light has no childList registration (see `take`). A move never changes an attribute, so a rename found
 * here is someone else's (a moved element's `connectedCallback`): it marks its light and is followed after this pass.
 */
const drop = (light: Light) => {
  if (light.obs === undefined || (light.ho !== true && light.cw !== true)) return;
  for (const record of light.obs.takeRecords())
    if (record.type === 'attributes') {
      mark((record.target as Kept).$rec?.light ?? light);
      queueMicrotask(flush);
    }
};
/** A render is ending (the renderer's `_$done$`): captured children no slot took are parked now, not before. */
let ending = false;
/** Records of this module's own moves, taken and dropped once it is done — they are not news. */
/** How many nodes this batch has put ahead of everything, per host — so a batch's front insertions keep their order. */
let lead = new WeakMap<Light, number>();
/** Whether THIS light watches `node` — its holding, a region's parent, one of its slots, or its host as a region parent. */
const watchedBy = (light: Light, node: Node) =>
  node === light.holding ||
  (node === light.host && light.hw === true) ||
  (node as Kept).$rec?.light === light ||
  light.recs.some((rec) => rec.re !== null && rec.re.parentNode === node);
const note = (light: Light, records: MutationRecord[]) => {
  lead = new WeakMap();
  for (const record of records) {
    const target: Node = record.target;
    /** An attribute record names the element: a slot's own name, or a node under something this light watches. */
    if (record.type === 'attributes') {
      const rec = (target as Kept).$rec;
      if (rec !== undefined) {
        mark(rec.light);
        continue;
      }
      /** A light node's own `slot=` — acted on only while it is still THIS light's (a registration stays on a node that left). */
      if (inLight(target, light) || target.parentNode === light.host) mark(light);
      continue;
    }
    /**
     * A watched node's children — holding, a region's parent, a slot — replayed into the runs (the host too, when a region
     * sits directly in it). Any other target in the host's subtree is the component's own template writing: not slotting.
     */
    if (target === light.host ? light.hw === true : watchedBy(light, target)) {
      mark(light);
      replay(light, record);
    }
    /** A host's own children: an addition outside its render's range is a new light child. */
    if (target === light.host) {
      /**
       * Until its first render ends, a run still sits IN the host — so what the renderer takes from it there (a node a slot
       * already took, through its stand-in) is read back as it is in holding. Missed, the stand-in went and its node stayed
       * in the slot: a commit during the host's own render left the old content beside the new.
       *
       * **Why the REMOVED half is the whole of it** — the invariant: while the run is physically in the host, every node the
       * renderer ADDS here lands exactly where the run is, between its own markers, so it is already in place and
       * `lightOf` reads it there (nothing to move; replaying it as a run neighbor would move the render's own markers);
       * every change inside a slot's region — a row added beside a node a slot took (`into` follows `_$slotted$` there),
       * or removed from it — is recorded on that region's parent, which is watched, and replayed in full (into the run
       * where it is — the host, while fresh: see `replay`). What a host
       * record alone can carry is a REMOVED stand-in: the one change that leaves state behind (its node, still in a slot).
       * Additions here are otherwise the render's own or a new light child (`adopt`).
       */
      if (light.fresh) unrun(light, record);
      for (const node of record.addedNodes) adopt(light, node);
    }
  }
};
/**
 * A `hold()`-parked branch's renames (`parkedObserver`, one for every parked root): routed by the node's own marks — a
 * slot's light, a placed node's slot's light, or the host it sits in — since no per-node watcher list exists any more.
 */
const noteParked = (records: MutationRecord[]) => {
  for (const record of records) {
    /**
     * A write into a parked branch (an applier resolving into it, the outer template committing there): it has left its
     * host's subtree, so it is replayed for the host whose render parked it — and only while it is still out (restored, the
     * host's own registration sees it, and replaying it twice would place it twice).
     */
    if (record.type === 'childList') {
      let top: Node = record.target;
      while (top.parentNode !== null) top = top.parentNode;
      const owner = PARKED.get(top);
      const light = owner === undefined ? undefined : HOSTS.get(owner as Element);
      if (light !== undefined && !light.host.contains(record.target) && watchedBy(light, record.target)) {
        mark(light);
        replay(light, record);
      }
      continue;
    }
    for (let node: Node | null = record.target; node !== null; node = node.parentNode) {
      const own = (node as Kept).$rec ?? PLACED.get(node);
      if (own) {
        mark(own.light);
        break;
      }
      const light = HOSTS.get(node as Element);
      if (light !== undefined) {
        mark(light);
        break;
      }
    }
  }
};
/**
 * **The lights that need work** — dirty, or fresh until their first render ends, never one waiting for its own slots
 * (`wait`): the only ones `flush` visits. A set of EVERY light ever seen held each removed host for good (a leak) and
 * made every flush walk them all — hydrating 2000 light hosts slowed 72 → 365 ms over ten renders that replaced them.
 * A light leaves once it is clean, or clean and disconnected (a first render that threw stays fresh); it comes back
 * through `mark`, or its own render's end (`_$done$`).
 */
const work = new Set<Light>();
/** The one way a light asks to be distributed. */
const mark = (light: Light) => {
  light.dirty = true;
  if (!light.wait) work.add(light);
};
/**
 * **Applies what is pending, now** — after every component render, and before any read of the assignment. It reads the
 * records of the lights it can name: its `context` (the light being read, mounted into, or rendered), every light whose
 * element the finished render's `root` created (`FED` — an outer template changing a component's children is
 * distributed by the end of that render), the work set, and the parked branches. Any other light's records arrive at the
 * microtask, through its own observer: a light host changed DIRECTLY by the page's code is redistributed by the next
 * microtask, or at once when its slotted content is read through the slots API (`tests/slots-sync-reads.test.mjs`).
 */
const flush = (context?: Light, root?: Node) => {
  if (busy) return;
  const near: Light[] = [];
  if (context !== undefined) near.push(context);
  const fed = root === undefined ? undefined : FED.get(root);
  if (fed !== undefined)
    FED.set(
      root!,
      fed.filter((ref) => {
        const element = ref.deref();
        if (element === undefined) return false;
        const light = HOSTS.get(element);
        if (light !== undefined) near.push(light);
        return true;
      })
    );
  /** Each light's records, read by that light (they arrive knowing whose they are), then the parked branches'. */
  for (const light of near) note(light, take(light));
  /**
   * The work set's NAME records stay with their callback: distribution reads `slot=` from the DOM as it is, so a rename is
   * only a trigger — and a light being READ (`near`: the slots API, a mount, its own render) takes them now, so a read
   * right after a rename is current (tests/slots-sync-reads.test.mjs). ChildList records are taken in order, always.
   */
  for (const light of work) note(light, take(light, false));
  if (parkedObserver !== undefined) noteParked(parkedObserver.takeRecords());
  for (const light of work) {
    if (light.dirty || (ending && light.fresh)) {
      distribute(light);
      drop(light);
    }
    if (!light.dirty && (!light.fresh || !light.host.isConnected)) work.delete(light);
  }
  /** What this module just moved, recorded on the lights it read: not news. */
  for (const light of near) drop(light);
};
/** Whether `node` sits outside the host's subtree registration — detached, or inside a slot (which steps out with its content). */
const outside = (node: Node, host: Element) => {
  for (let at: Node | null = node; at !== host; at = at.parentNode) if (at === null || (at as Kept).$rec !== undefined) return true;
  return false;
};
const watch = (node: Node, light: Light) => {
  /** The host's own subtree registration covers it; a region directly in the host also gets the region's handling. */
  if (node === light.host) {
    light.hw = true;
    return;
  }
  const observer = observerOf(light);
  /**
   * A slot: its own name only. A slot with content steps OUT of the page, so this is how a rename reaches it there; a
   * nested slot in its fallback is claimed and registered on its own. Re-registering replaces the options, so a node that
   * is also this light's light element keeps `slot=` too (the union; `own`).
   */
  if ((node as Kept).$rec !== undefined) {
    observer.observe(node, { attributes: true, attributeFilter: mineAlready(node) ? ['slot', 'name'] : ['name'] });
    return;
  }
  /** Holding (out of the page while empty) and a region's parent inside a slot's fallback (out with that slot): on themselves. */
  if (node === light.holding || outside(node, light.host)) {
    light.cw = true;
    observer.observe(node, { childList: true });
  }
};
/** A light element's own `slot=` — registered when its light is first observed (`register`) and on every arrival after (`adopt`, `replay`, `settleIn`). */
const OWN = Symbol();
const mineAlready = (node: Node) => (node as Node & { [OWN]?: boolean })[OWN] === true;
const own = (light: Light, node: Node) => {
  /** Not before the light is observed (`register`, at its first slot), which registers every light element it has then. */
  if (node.nodeType !== 1 || light.ho !== true) return;
  (node as Node & { [OWN]?: boolean })[OWN] = true;
  observerOf(light).observe(node, { attributes: true, attributeFilter: (node as Kept).$rec !== undefined ? ['slot', 'name'] : ['slot'] });
};

/**
 * A node added to a host after its render: a light unit, appended in light order — unless it is the render's own. The
 * render's range runs from the host's first comment to its last that is not one of this module's units (captured
 * light children not yet distributed sit before it); comments are never slottable, so none is adopted.
 */
const adopt = (light: Light, node: Node) => {
  if (node.nodeType === 8 || node.parentNode !== light.host || node === light.holding) return;
  const ours = new Set<Node>();
  for (const unit of light.units) ours.add(unit.a).add(unit.z);
  if (ours.has(node)) return;
  let first: Node | null = null;
  let last: Node | null = null;
  for (const child of light.host.childNodes)
    if (child.nodeType === 8 && !ours.has(child)) {
      first ??= child;
      last = child;
    }
  if (first !== null && first !== last && follows(first, node) && follows(node, last!))
    return;
  /** Before the render's range is ahead of everything distributed away; after it, behind. Read before it moves. */
  const ahead = first !== null && follows(node, first);
  park(light).insertBefore(node, light.holding.lastChild);
  PLACED.set(node, null);
  own(light, node);
  if (ahead) {
    const at = lead.get(light) ?? 0;
    light.units.splice(at, 0, { a: node, z: node });
    lead.set(light, at + 1);
  } else light.units.push({ a: node, z: node });
  mark(light);
};

/** Which unit a light node is in — its own, or (a run's node in a slot) the run its stand-in sits in. */
const unitIndexOf = (light: Light, node: Node): number => {
  const stand = STAND.get(node);
  if (stand === undefined) return light.units.findIndex((unit) => unit.a === node);
  return light.units.findIndex(
    (unit) => unit.a !== unit.z && follows(unit.a, stand) && follows(stand, unit.z)
  );
};

/**
 * A node the USER put inside a slot's region — `slotted.before(node)`, `after()`: a light unit of its own, at that
 * place in light order. (No `mark`: only `replay` reaches here, for a record `note` has already marked the light for.)
 */
const settleIn = (light: Light, node: Node) => {
  const parent = node.parentNode;
  if (parent === null || node.nodeType === 8) return;
  for (const rec of light.recs) {
    if (rec.re === null || rec.re.parentNode !== parent) continue;
    if (!follows(rec.rs!, node) || !follows(node, rec.re)) continue;
    let at = -1;
    for (let next = node.nextSibling; next !== null && next !== rec.re && at < 0; next = next.nextSibling) at = unitIndexOf(light, next);
    if (at < 0) light.units.push({ a: node, z: node });
    else light.units.splice(at, 0, { a: node, z: node });
    PLACED.set(node, rec);
    own(light, node);
    return;
  }
};

/**
 * **What the renderer wrote, read back into the runs.** A run's node in a slot is still the renderer's: an insert
 * before it (a new row), markers around it (a text becoming a template), its move or removal all happen where the
 * node now is. Each lands in the run at the place its neighbor's stand-in holds, so the run stays the renderer's
 * whole range; what has no such neighbor is the user's own edit.
 */
/**
 * **What the renderer took away from a run, read back** — the removed half of `replay`: a stand-in it removed takes its
 * node with it (cleared with its run) or into the fragment `hold` parked it in; a run's node it removed from a slot drops
 * its place. Called on its own for a host's own records while its first render runs, when a run still sits in the host.
 */
const unrun = (light: Light, record: MutationRecord) => {
  const holding = light.holding;
  for (const node of record.removedNodes) {
    const real = REAL.get(node);
    if (real !== undefined) {
      /**
       * A stand-in the renderer took: cleared with its run (its node goes too), or parked by `hold` in a fragment (its
       * node joins it). One the renderer MOVED — beside a node of the run that sits in a slot — is still the run's; its
       * addition, below, puts it back at its new place.
       */
      const parent = node.parentNode;
      if (parent === holding || (parent !== null && parent.nodeType !== 11)) continue;
      if (parent === null) real.parentNode?.removeChild(real);
      else parent.insertBefore(real, node);
      PLACED.delete(real);
      unstand(real);
    } else if (STAND.has(node) && node.parentNode === null) {
      /** A run's node the renderer removed from its slot (a row deleted): its place goes too. */
      PLACED.delete(node);
      unstand(node);
    }
  }
};

const replay = (light: Light, record: MutationRecord) => {
  const holding = light.holding;
  unrun(light, record);
  for (const node of record.addedNodes) {
    if (node.parentNode !== record.target) continue;
    if (record.target === holding) {
      /** Back in holding (the renderer moved it before a marker there): its own place now, not its stand-in's. */
      if (STAND.has(node)) {
        PLACED.delete(node);
        unstand(node);
      }
      /** A run's node written straight into holding (a row the outer template inserted) is a light node from now on. */
      own(light, node);
      continue;
    }
    if (PLACED.get(node) !== undefined && !STAND.has(node)) continue;
    const next = record.nextSibling;
    const previous = record.previousSibling;
    /** Where the runs are: holding — and, until the host's first render ends, the host, where a fresh run still sits. */
    const inRun = (node: Node) => node.parentNode === holding || (light.fresh && node.parentNode === light.host);
    const ahead = next === null ? undefined : (STAND.get(next) ?? (inRun(next) ? next : undefined));
    const behind = previous === null ? undefined : (STAND.get(previous) ?? (inRun(previous) ? previous : undefined));
    if (ahead === undefined && behind === undefined) {
      settleIn(light, node);
      continue;
    }
    const place = ahead ?? behind!.nextSibling;
    /**
     * A run's node moved within the page: its place in the run moves. New to the run: it joins it, at that place — in
     * whatever holds the run: holding, or (until its host's first render ends) the HOST itself, where a fresh run still
     * sits. Inserted into holding regardless, a node new to a fresh run threw there and was left in the slot unrecorded.
     */
    const stand = STAND.get(node);
    const run = place === null ? holding : place.parentNode!;
    (run === holding && stand === undefined ? park(light) : run).insertBefore(stand ?? node, place);
    own(light, node);
  }
};

/** A captured host that turned out to have a shadow root: its children go back, in light order, for the platform. */
const release = (light: Light) => {
  for (const unit of light.units) {
    if (unit.a === unit.z) {
      move(light.host, unit.a, null);
      continue;
    }
    for (let node = unit.a.nextSibling; node !== null && node !== unit.z; ) {
      const next = node.nextSibling;
      light.host.appendChild(REAL.get(node) ?? node);
      node = next;
    }
  }
  light.holding.remove();
  HOSTS.delete(light.host);
  work.delete(light);
  /**
   * Its observer goes with it. Bound to its light, it would otherwise keep handling the host's records as this light's
   * — adopting the platform's own light children into a holding that no longer exists (renderer-slots' native-sequence
   * row, 2026-10-17). Before the binding, a released light's records were simply not found and dropped.
   */
  light.obs?.disconnect();
  light.obs = undefined;
};


/* ── capture ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * **A light's childList registrations, once its first render has ENDED** (observer redesign step 3, "3c", 2026-10-17).
 * ONE over the host's subtree — its own children and every region and slot inside it: what native slotting reacts to,
 * wherever it sits, so a region's parent needs no registration of its own — and its holding (out of the page while empty).
 * Not before: the first render's own writes would make a record each for nothing (`reconcile` covers that window).
 * Attribute changes are registered per NODE (`own`, a slot's `name` in `watch`): one subtree attribute registration made
 * Firefox check every attribute write inside the host (−17.7% of light-slots creation).
 */
const register = (light: Light) => {
  if (light.ho === true) return;
  light.ho = true;
  observerOf(light).observe(light.host, { childList: true, subtree: true });
  for (const node of lightOf(light)) own(light, node);
  /**
   * A light with a RUN (a part an outer template writes into, for as long as the host lives) has its holding watched
   * from now — the run moves there, and is written into there, even while holding holds nothing else. One with static
   * light children only is watched once something is parked (`park`), or never.
   */
  if (
    /** `hydrate-slots` writes runs straight into holding and relies on it being watched (hydrate-slots.ts, "holding is watched"). */
    (wired as { _$hydrateSlots$?: unknown } | undefined)?._$hydrateSlots$ !== undefined ||
    light.units.some((unit) => unit.a !== unit.z) ||
    light.holding.childNodes.length > 2
  )
    watchHolding(light);
};
/**
 * **Holding, watched once anything lives in it** — a run's markers and stand-ins, or a parked node — since the outer
 * template keeps writing into a run there, in or out of the page. An empty holding (every light node took a slot) is
 * never written into, so it costs no registration (2026-10-17).
 */
const watchHolding = (light: Light) => {
  if (light.ho !== true || light.hh === true) return;
  light.hh = true;
  watch(light.holding, light);
};
/**
 * **What changed while a light was not yet observed — its first render** — read off the DOM once, at that render's end
 * (3c, vera-5a): who made the change does not matter, the renderer or user code (a child's `connectedCallback`, a
 * directive). A stand-in gone takes its node with it, as `unrun` does for a removal record; a host child nothing knows
 * of is a light child added meanwhile (`adopt`) — unless it is the render's own (between its markers: `adopt` checks the
 * range), one of the captured units, or a member of a captured run.
 */
const reconcile = (light: Light) => {
  for (const rec of light.recs)
    for (const node of [...rec.shown]) {
      const stand = STAND.get(node);
      if (stand === undefined) continue;
      if (node.parentNode === null) {
        PLACED.delete(node);
        unstand(node);
        continue;
      }
      const parent = stand.parentNode;
      if (parent === null) node.parentNode.removeChild(node);
      else if (parent.nodeType === 11) parent.insertBefore(node, stand);
      else continue;
      PLACED.delete(node);
      unstand(node);
    }
  /**
   * A node written INTO a slot's region meanwhile — a keyed row inserted beside a slotted neighbor follows it there
   * (`into`) — is handed to `replay` as the record it would have been: its parent, itself, its neighbors now.
   */
  for (const rec of light.recs) {
    if (rec.rs === null || rec.re === null) continue;
    for (let node = rec.rs.nextSibling; node !== null && node !== rec.re; ) {
      const next = node.nextSibling;
      if (!PLACED.has(node) && node.nodeType !== 8)
        replay(light, { type: 'childList', target: rec.re.parentNode!, addedNodes: [node] as unknown as NodeList, removedNodes: [] as unknown as NodeList, previousSibling: node.previousSibling, nextSibling: node.nextSibling } as unknown as MutationRecord);
      node = next;
    }
  }
  const host = light.host;
  /** The render's range, once: its first and last comment that is not a captured unit's (as `adopt` reads it). */
  const ours = new Set<Node>();
  for (const unit of light.units) ours.add(unit.a).add(unit.z);
  let first: Node | null = null;
  let last: Node | null = null;
  for (let child = host.firstChild; child !== null; child = child.nextSibling)
    if (child.nodeType === 8 && !ours.has(child)) {
      first ??= child;
      last = child;
    }
  const ranged = first !== null && first !== last;
  for (const child of [...host.childNodes]) {
    if (child.nodeType === 8 || child === light.holding || ours.has(child) || PLACED.has(child)) continue;
    if (ranged && follows(first!, child) && follows(child, last!)) continue;
    if (light.units.some((unit) => unit.a !== unit.z && follows(unit.a, child) && follows(child, unit.z))) continue;
    adopt(light, child);
  }
};
/** A host's light record, new: its holding (bracketed by two comments, so `lastChild` is always an anchor), watched. */
const lightFor = (host: Element, late: boolean, carrier: HTMLElement | null = null): Light => {
  const doc = host.ownerDocument;
  /** The server's carrier, adopted, is the same element a client render makes: given the same style and anchors. */
  const holding = carrier ?? (doc.createElement('ins') as HTMLElement);
  holding.setAttribute('hidden', '');
  holding.setAttribute(UNASSIGNED, '');
  /**
   * `hidden` is only the UA's `display: none`, and any author rule that sets `display` beats it — a reset, a design
   * system's `:where(*)`, a `[hidden]` override — and unassigned content would RENDER. An inline `!important` beats every
   * author stylesheet; written through CSSOM, which a strict CSP does not block (served markup carries `hidden` only).
   */
  holding.style.setProperty('display', 'none', 'important');
  holding.insertBefore(doc.createComment(''), holding.firstChild);
  holding.append(doc.createComment(''));
  const light: Light = { host, units: [], holding, recs: [], dirty: false, fresh: false, late, wait: false };
  HOSTS.set(host, light);
  return light;
};

/**
 * **Capture**, at `init` — before the host's first render, when everything it holds is the page's. Each static child
 * is a unit; each run between statics (what the page's template bound there) is one unit, wrapped in this module's
 * two comments so its extent survives whatever the renderer writes inside it.
 *
 * `nodes` and `carrier` are hydration's (`_$capture$`): a served host's light children in light order, wherever the server
 * distributed them, and the server's unassigned container, which becomes the holding. A node captured in a slot's region
 * stays there (`ADOPTED`) — distribution then moves only what is out of place, so the server's placement decides at most
 * WHETHER a node moves, never where it ends up.
 */
const capture = (host: Element, before: Node | null = null, nodes: Node[] = [...host.childNodes], carrier: HTMLElement | null = null, wait = false): Light => {
  let light = HOSTS.get(host);
  /** A slot of a custom element `init` never saw mounted first: its light content arrives now, at the render's end. */
  if (light !== undefined && !light.late) return light;
  const doc = host.ownerDocument;
  light ??= lightFor(host, false, carrier);
  light.late = false;
  const statics = STATICS.get(host);
  let run: Node[] | null = null;
  /**
   * Recorded, not moved: the children stay where the page put them — in the host, as they would under a shadow root —
   * until the host's first render finishes, which distributes them (the ones no slot takes, invisibly to holding).
   */
  const close = () => {
    if (run === null) return;
    const a = doc.createComment('');
    const z = doc.createComment('');
    host.insertBefore(a, run[0]);
    host.insertBefore(z, run[run.length - 1].nextSibling);
    light!.units.push({ a, z });
    run = null;
  };
  for (const child of nodes) {
    /** At a first render's end, only what precedes the render's own range is light content. */
    if (child === before) break;
    const parent = child.parentNode;
    if (parent !== host) PLACED.set(child, parent === light.holding ? null : ADOPTED);
    own(light, child);
    if (statics === undefined || statics.has(child)) {
      close();
      light.units.push({ a: child, z: child });
    } else (run ??= []).push(child);
  }
  close();
  /**
   * `wait`: captured by a template that placed content into this host (hydration), not by the host — nothing is
   * distributed until the host's own slots mount, so a host never defined keeps its nodes where they stand.
   */
  if (wait) light.wait = true;
  else {
    light.fresh = true;
    mark(light);
  }
  return light;
};

/**
 * **A dashed element in a template is told it was created** — before the page's template commits into it — so the
 * children it has then are exactly its statics: a binding position is still the empty text the template parsed it
 * as. Recorded by node; `init` capture reads it.
 */
/**
 * **Which elements each render root's templates created** — so that root's render end reads their lights' records too:
 * a host whose light children an OUTER template changed is distributed by the end of that render, synchronously, though
 * it has an observer of its own (Gecko's `observe()` is linear in its observer's registrations, so none is shared).
 * Weak both ways: a root or an element gone takes its entries with it, and a dead ref is dropped by the read itself.
 */
const FED = new WeakMap<Node, WeakRef<Element>[]>();
/**
 * Only for a dashed element its TEMPLATE gives children (slot-discovery decides once per template, at preparation): no
 * outer template can write into one it gives none, so there is nothing to record — an app's list of `<x-row></x-row>`
 * paid a child scan and a Set per row at create, and a WeakRef per row in its root's `FED` at mount, which that root's
 * every render then filtered (wiring slots made such a list ~9× slower to create, 2026-10-17).
 */
const hostBehavior = {
  mount: (element: Element, { root }: { root: Node | null }) => {
    if (root === null) return;
    let fed = FED.get(root);
    if (fed === undefined) FED.set(root, (fed = []));
    fed.push(new WeakRef(element));
  },
  create: (element: Element, adopted: boolean) => {
    if (adopted) return;
    const statics = new Set<Node>();
    let hole = false;
    for (const child of [...element.childNodes]) {
      const placeholder = child.nodeType === 3 && (child as Text).data === '';
      /**
       * Two bindings written back to back (`${a}${b}`) have nothing static between them, so their runs would join into
       * one unit: a comment of this module's goes between them — every binding is its own unit.
       */
      if (placeholder && hole) {
        const between = element.ownerDocument.createComment('');
        element.insertBefore(between, child);
        statics.add(between);
      }
      if (!placeholder) statics.add(child);
      hole = placeholder;
    }
    STATICS.set(element, statics);
  },
};

/* ── the slot element ──────────────────────────────────────────────────────────────────────────── */

/**
 * The `<slot>` element's own answers, from the live assignment (a slot outside a shadow tree answers nothing). With
 * `flatten`, an unassigned slot answers its fallback's slottables, a nested slot through itself.
 */
const assigned = (rec: Rec, elementsOnly: boolean, flatten = false): Node[] => {
  flush(rec.light);
  const out = rec.shown.filter((node) => !elementsOnly || node.nodeType === 1);
  /** The fallback is read only when NOTHING is assigned — assigned text with no element still answers [] for elements. */
  if (rec.shown.length > 0 || !flatten) return out;
  for (const node of rec.slot.childNodes) {
    const nested = (node as Kept).$rec;
    if (nested !== undefined) out.push(...assigned(nested, elementsOnly, true));
    else if (node.nodeType === 1 && (node as Element).localName === 'slot') continue;
    else if (node.nodeType === 1 || (!elementsOnly && node.nodeType === 3)) out.push(node);
  }
  /** A nested slot whose content stands in its place is read where it stands. */
  return out;
};

const slotBehavior = {
  mount: (slot: Element, context: { root: Node | null }) => {
    const root = context.root;
    /**
     * A shadow root distributes natively; only a light host (an element rendered into) is this module's. A host
     * captured at `init` that then rendered into a shadow root of its own gets its children back, for the platform.
     */
    if (root !== null && root.nodeType === 11) {
      const owner = HOSTS.get((root as ShadowRoot).host);
      if (owner !== undefined && owner.recs.length === 0) release(owner);
    }
    if (root === null || root.nodeType !== 1) return undefined;
    if (__DEV__) {
      const inert = [...slot.attributes].map((attribute) => attribute.name).filter((name) => name !== 'name');
      if (inert.length > 0)
        console.warn(
          diagnostic('slots', `<${(root as Element).localName}>`, 'slot-attributes',
            __DEV__ && PROSE['slot-attributes'](`<slot${slot.hasAttribute('name') ? ` name="${slot.getAttribute('name')}"` : ''}>`, inert.map((name) => `\`${name}\``).join(', ')))
        );
    }
    /** A host `init` never saw has no captured children: what it holds now is its own render, never light content. */
    /** Its own light's records first: what the user did to it this task is noted before this module's moves, which are dropped. */
    flush(HOSTS.get(root as Element));
    const light = HOSTS.get(root as Element) ?? lightFor(root as Element, isCustomElementName((root as Element).localName));
    const kept = slot as Kept;
    const rec: Rec = { slot: kept, light, rs: null, re: null, shown: [], queued: false };
    kept.$rec = rec;
    /** A region handed over (hydration: the server's two markers) IS this slot's region, and what is between them stays. */
    const served = kept._$region$;
    if (served !== undefined) {
      kept._$region$ = undefined;
      [rec.rs, rec.re] = served;
      for (let node = rec.rs.nextSibling!; node !== rec.re; node = node.nextSibling!) {
        PLACED.set(node, rec);
        (node as Node & { _$slotted$?: boolean })._$slotted$ = true;
      }
      watch(rec.re.parentNode!, light);
    }
    kept.assignedNodes = (options?: AssignedNodesOptions) => assigned(rec, false, options?.flatten);
    kept.assignedElements = (options?: AssignedNodesOptions) => assigned(rec, true, options?.flatten) as Element[];
    light.recs.push(rec);
    light.wait = false;
    watch(kept, light);
    distribute(light);
    drop(light);
    /**
     * Its FIRST slot, after its first render — in a later render of its own, or in ANOTHER container's (an applier
     * committing there, which never reaches this host's `_$done$`): once that render is over — a microtask, which no
     * render is ever halfway through — read what changed while it was unobserved, and observe it from then. Inside its
     * first render, its own `_$done$` does both.
     */
    if (!light.fresh && light.ho !== true)
      queueMicrotask(() => {
        if (light.ho === true || HOSTS.get(light.host) !== light) return;
        reconcile(light);
        flush(light);
        register(light);
      });
    return rec;
  },
  /** Torn down: its content goes back to holding first, and the element back in its place, before the renderer removes it. */
  unmount: (rec: Rec) => {
    flush(rec.light);
    const light = rec.light;
    light.recs.splice(light.recs.indexOf(rec), 1);
    for (const node of lightOf(light)) if (PLACED.get(node) === rec) toHolding(light, node);
    unregion(rec);
    distribute(light);
    drop(light);
  },
};

/**
 * **A served light host whose first render nothing adopts** — the renderer asks (`_$unadopted$`) before that render
 * would APPEND beside the server's markup: two copies, the server's dead. The server states every host it renders while
 * slots is wired (`data-vm-light`): stated EMPTY (`N:`), the host holds nothing of the page's, so the server's render
 * is cleared (its SSR stylesheets kept) and the client renders fresh — working, without the server's head start; stated
 * with light content, that content cannot be told from the server's render without `hydrateSlots`, so the host stands
 * as served and the coded error names what to wire. Development warns once per page.
 */
let warnedUnadopted = false;
const unadopted = (container: Node) => {
  /** An empty container holds no server markup to append beside: no attribute read for it (every component's first render). */
  const spec = container.nodeType === 1 && container.firstChild !== null ? (container as Element).getAttribute(LIGHT_ATTR) : null;
  if (spec === null) return;
  if (!spec.endsWith(':'))
    /**
     * A WIRING state, not a misused argument, so the diagnostic shape (`[vera] slots: <host> — …`), not `misuse()`'s.
     * Production keeps its own short line, which already carries the code: the code-and-link shape measured +18 B on
     * vera-renderer-slots.min.js (Brian's byte rule, 2026-10-09 — a production message converts only where its bundle
     * is not larger). Development's text is the table's.
     */
    throw new Error(
      __DEV__
        ? diagnostic('slots', `<${(container as Element).localName}>`, 'hydration-unwired', __DEV__ && PROSE['hydration-unwired']("this light host, holding the page's content, stands as served"))
        : '[vera] hydration-unwired'
    );
  for (let node = container.firstChild; node !== null; ) {
    const next: ChildNode | null = node.nextSibling;
    if (node.nodeType !== 1 || !(node as Element).hasAttribute('data-vm-sheet')) container.removeChild(node);
    node = next;
  }
  (container as Element).removeAttribute(LIGHT_ATTR);
  if (__DEV__ && !warnedUnadopted) {
    warnedUnadopted = true;
    console.warn(diagnostic('slots', 'the page', 'hydration-unwired', __DEV__ && PROSE['hydration-unwired']('its components re-render on the client instead of adopting the server markup')));
  }
};

/** A light host's children in light order, as its record holds them — what a template placing content into it adopts. */
const lightNodes = (host: Element): Node[] | null => {
  const light = HOSTS.get(host);
  if (light === undefined) return null;
  flush(light);
  return lightOf(light);
};

/** The slotted nodes a light host shows in its slot of `name` — or a shadow host's, from the platform. */
export const slotted = (host: Element, name = ''): Node[] => {
  const light = HOSTS.get(host);
  if (light !== undefined) {
    flush(light);
    for (const rec of light.recs) if ((rec.slot.getAttribute('name') ?? '') === name && rec.shown.length > 0) return [...rec.shown];
    /** Unassigned, a node still belongs to the host: it waits in holding for a slot of its name. */
    return lightOf(light).filter((node) => slotNameOf(node) === name);
  }
  /**
   * Core's `_$r$` first: a CLOSED root is null through `shadowRoot`, and core keeps the root it attached under that
   * sigiled name in both modes (`@verajs/styles` reads it the same way); no mangling regex matches a sigil.
   * Names are compared, never put in a selector — a quote in one would throw.
   */
  const root = (host as unknown as Record<string, ShadowRoot | null | undefined>)['_$r$'] ?? host.shadowRoot;
  const slot = [...(root?.querySelectorAll('slot') ?? [])].find((s) => (s.getAttribute('name') ?? '') === name);
  return slot === undefined ? [] : slot.assignedNodes();
};

const LIGHT_ATTR = 'data-vm-light';

/**
 * Whether hydration is wired — it marks the registry (`_$hydrating$`) when it installs, which may be before or after this
 * module: a served host (`data-vm-light`) is then captured by the adoption, never by `init`'s capture.
 */
let wired: { _$hydrating$?: boolean } | null = null;

/**
 * **The `'slot'` insert: a marker** — `@verajs/ssr` distributes light hosts on the server exactly while it is wired. The
 * client claims each `<slot>` through `'element'`, so the function is never called here.
 */
const serve = { name: '@verajs/renderer/slots', on: 'slot' as const, fn: () => null, priority: 50 };

/** Discovery: `<slot>` elements and dashed hosts claimed in templates, through `elements`. */
/**
 * **`observeSlots: 'lazy' | 'eager'`** (paired as HTML's `loading` pairs them) — a component's own option
 * (`init({ host, observeSlots: 'eager' }, …)`, `define({ tag, observeSlots })`), else the app's default
 * (`slots({ observeSlots: 'eager' })`), else `'lazy'`; resolved ONCE here and kept on the light.
 * - `'lazy'`: observed from its first `<slot>` or light child, and a component with neither gets nothing at all (wiring
 *   slots made plain components 2.1–2.7× slower to create when every one was captured and observed). Fully correct for
 *   everything a template renders.
 * - `'eager'`: captured and observed from its first render, so a child appended by hand before any slot renders is
 *   hidden and a `<slot>` inserted by hand is seen — what native shadow DOM does for every host, at an observer per
 *   component.
 */
/** Development: `observeSlots` is `'lazy'` or `'eager'`; anything else reads as `'lazy'`, and says so — as core does for `foreignNodes`. */
const checkObserve = (subject: string, value: unknown) => {
  if (value !== undefined && value !== 'lazy' && value !== 'eager')
    console.warn(diagnostic('slots', subject, 'observe-slots-option', __DEV__ && PROSE['observe-slots-option'](typeof value === 'string' ? `'${value}'` : String(value))));
};
const captureAtInit = (element: Element, options: object | undefined) => {
  const own = (options as { observeSlots?: unknown } | undefined)?.observeSlots;
  if (__DEV__) checkObserve(`<${element.localName}>`, own);
  const eager = (own !== undefined ? own : (wired as { _$observeSlots$?: unknown } | undefined)?._$observeSlots$) === 'eager';
  /** Nothing to hide and nothing expected (the cheap tests first — they settle every plain component). */
  if (element.firstChild === null && !eager) return;
  /**
   * A SHADOW host distributes natively: core attaches its root before this insert runs and keeps it under the
   * unmangled `_root` (a closed root is null through `shadowRoot`), quoted so this bundle's mangling leaves it alone.
   */
  if ((element as unknown as Record<string, unknown>)['_$r$'] != null || element.shadowRoot !== null) return;
  /** A SERVER host waits: whether its marks are trusted is the following render's to decide (`read`, under adoption). */
  if (isCustomElementName(element.localName) && !HOSTS.has(element) && !(wired?._$hydrating$ === true && element.hasAttribute(LIGHT_ATTR))) {
    const light = capture(element);
    if (eager) light.ex = true;
  }
};
/** Development: the option key this hook reads, so core's unknown-option check accepts it (`$keys` sits on the FUNCTION). */
if (__DEV__) Object.assign(captureAtInit, { $keys: ['observeSlots'], $module: '@verajs/renderer/slots' });

export const slotDiscovery = [
  elements,
  /**
   * **Capture at `init`** — core's insert point, before the component's first render, when everything a CUSTOM element
   * (a dash, not a reserved SVG/MathML name) holds is the page's: its light content, captured even if its `<slot>`
   * arrives later. Once per host: a reconnect finds it captured and its render untouched.
   */
  {
    name: '@verajs/renderer/slots-capture',
    on: 'init' as const,
    fn: captureAtInit,
    priority: 10,
  },
  {
    name: '@verajs/renderer/slot-discovery',
    on: 'element' as const,
    fn: (el: Element) =>
      el.localName === 'slot' ? slotBehavior : el.firstChild !== null && isCustomElementName(el.localName) ? hostBehavior : undefined,
    priority: 10,
  },
  /**
   * **After every render** — the renderer says when one finishes (`_$done$`, off-chain like `$t`), and what it did to a
   * light host's children is distributed before anything reads them.
   */
  (registry: Map<string, unknown[]>) => {
    /** Hydration's seam — off-chain like `_$done$`, stamped with this package's seam protocol: capture a served host. */
    wired = registry as unknown as { _$hydrating$?: boolean };
    (registry as unknown as { _$capture$?: unknown })._$capture$ = [PROTOCOL, capture, lightNodes, HOSTS, standIn, PLACED, ADOPTED];
    (registry as unknown as { _$unadopted$?: (container: Node) => void })._$unadopted$ = unadopted;
    (registry as unknown as { _$parked$?: (root: Node, owner: Node | null) => void })._$parked$ = (root, owner) => {
      if (owner !== null) PARKED.set(root, owner);
      (parkedObserver ??= new (globalThis.MutationObserver ?? (root.ownerDocument!.defaultView as typeof globalThis).MutationObserver)(parkedHandle)).observe(root, {
        attributes: true,
        attributeFilter: ['slot'],
        childList: true,
        subtree: true,
      });
    };
    /** Development only: how many lights wait for work — 0 once every rendered host is distributed (a retention pin). */
    if (__DEV__) (registry as unknown as { _$slotsWork$?: () => number })._$slotsWork$ = () => work.size;
    (registry as unknown as { _$done$?: (container: Node, start: Node) => void })._$done$ = (container, start) => {
      /**
       * A CUSTOM element rendered into that `init` never captured (the renderer used on its own, without core): what it
       * held before its first render's range is its light content — Brian's ruling 4, custom elements by their name.
       */
      let own = HOSTS.get(container as Element);
      if (container.nodeType === 1 && (own?.late ?? container.firstChild !== start) && (container as Element).shadowRoot === null && isCustomElementName((container as Element).localName)) {
        capture(container as Element, start);
        own = HOSTS.get(container as Element);
      }
      /**
       * Nothing of this module's here — no light, nothing waiting, no host this render fed, nothing parked: the render of
       * every component that needs no slotting ends here (a full `flush` per render was most of what wiring slots still
       * cost a plain component in Firefox).
       */
      if (own === undefined && work.size === 0 && parkedObserver === undefined && FED.get(container) === undefined) return;
      /** Its own render ended: a fresh light that left the work set (disconnected meanwhile) is distributed now. */
      if (own?.fresh && !own.wait) work.add(own);
      /**
       * Unobserved until it has a slot: what changed meanwhile is read once — at its first render's end, and at the end of
       * the render that mounted its first slot — before the distribution below. A light with no slot shows nothing, so
       * nothing about it needs following until then.
       */
      const slotted = own !== undefined && own.recs.length > 0;
      if (own !== undefined && own.ho !== true && (own.fresh || slotted)) reconcile(own);
      ending = true;
      try {
        flush(own, container);
      } finally {
        ending = false;
      }
      /** Observed from here on — after this module's own moves above, which then make no records. */
      if (own !== undefined && own.ho !== true && (slotted || own.ex === true)) register(own);
    };
  },
];

const parts = [slotDiscovery, serve];
/** What `wire` hands a connector: the registry (told apart from options by its `get`) and `wire` itself. */
type Registry = { get(name: never): unknown };
type Wire = (item: never) => void;
type ObserveSlots = 'lazy' | 'eager';
type SlotsOptions = { observeSlots?: ObserveSlots };
type SlotsConnector = (registry: Registry, wire: Wire) => void;
/** Two call signatures: as `wire` calls it (bare), and as an app calls it (with options) — both a module to `wire`. */
type SlotsModule = { (options?: SlotsOptions): SlotsConnector; (registry: Registry, wire: Wire): void };
/**
 * **`slots` is a DUAL** — `wire([renderer, slots])`, or `wire([renderer, slots({ observeSlots: 'eager' })])` to make
 * observing from the first render every light component's default (a component's own `observeSlots` wins either way). Bare, `wire` hands it the
 * registry and `wire` itself, and it wires its parts; called, it returns a connector doing the same and writing the
 * default on that registry — two cores on one page keep their own.
 */
/**
 * A `wire` that hands a connector only the registry — a core older than this module, or code calling connectors itself —
 * can wire nothing of slots: said, in both builds, rather than leaving every slot quietly undistributed (vera-5a).
 */
const tooOld = () => {
  throw new Error(__DEV__ ? diagnostic('slots', 'wire([slots])', 'slots-wire-too-old', __DEV__ && PROSE['slots-wire-too-old']()) : '[vera] slots-wire-too-old');
};
export const slots = ((given?: SlotsOptions | Registry, w?: (item: unknown) => void): SlotsConnector | undefined => {
  /** Told apart by the REGISTRY (its `get`), as the module rule says — never by whether a second argument came. */
  if (typeof (given as Registry | undefined)?.get === 'function') {
    if (typeof w !== 'function') tooOld();
    w!(parts);
    return undefined;
  }
  const options = given as SlotsOptions | undefined;
  if (__DEV__) {
    for (const key in options) if (key !== 'observeSlots') console.warn(diagnostic('slots', 'slots()', 'unknown-option', __DEV__ && SHARED.unknownOption(key, 'observeSlots')));
    checkObserve('slots()', options?.observeSlots);
  }
  const observe = options?.observeSlots;
  return (registry, wire) => {
    if (typeof wire !== 'function') tooOld();
    (wire as (item: unknown) => void)(parts);
    if (observe !== undefined) (registry as unknown as { _$observeSlots$?: unknown })._$observeSlots$ = observe;
  };
}) as SlotsModule;

/** Its option's type, where slots is imported: `init({ host, observeSlots: 'eager' }, …)` (core's `VeraInitOptions`). */
declare global {
  // eslint-disable-next-line no-restricted-syntax -- merging IS the point: slots adds its key to core's options
  interface VeraInitOptions {
    observeSlots?: 'lazy' | 'eager';
  }
}
