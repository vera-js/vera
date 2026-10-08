/**
 * **`@verajs/renderer/hydrate-slots` — hydrating light-DOM slots.** `wire([renderer, hydration, slots, hydrateSlots])`.
 *
 * Everything only a page that HYDRATES LIGHT SLOTS runs, kept out of both modules so neither pays for the other (Brian,
 * 2026-10-07): the server's format (`data-vm-light` — its number, the light order — and the carrier), each filled slot's
 * range and detached copy, and the rescue. Hydration calls it through `_$hydrateSlots$`;
 * it captures through slots' `_$capture$`. Slots' own distribution then recomputes every assignment from the nodes'
 * names, so the server's placement decides at most WHETHER a node moves, never where it ends up.
 *
 * Without it, hydration refuses a served light host before touching anything (`hydration-slots`): the page stands as
 * served, and a component boundary reports it once.
 */
import { PROTOCOL } from './kinds.js';
import type { CaptureSeam, HydrateSlots, HydrationCursor, HydrationFail, LightCapture, ServedHost } from './types.js';

/** The registry as this module uses it — `get` named so `wire`'s registry is assignable (a type of optional members alone is "weak"). */
type Registry = { get(name: string): unknown[] | undefined; _$capture$?: CaptureSeam; _$hydrateSlots$?: HydrateSlots };
/** A served host being adopted: what hydration sees (`ServedHost`), and what this module keeps beside it. */
/** `_`-named where only this module reads them — the minifier shortens those; `carrier` is hydration's to read too. */
type Served = ServedHost & { _host: Element; _runs: string; carrier: HTMLElement | null; _pools: Node[][]; _capture: LightCapture };

/** What `@verajs/ssr` writes — a deliberate second address of its writer; `slots-ssr-client-parity` holds them together. */
const FORMAT = '1';
const LIGHT_ATTR = 'data-vm-light';
const UNASSIGNED = 'data-vm-unassigned';
const isMark = (node: Node, data: string) => node.nodeType === 8 && (node as Comment).data === data;
/** The slottable nodes from `from` up to `to` — comments are never light content. */
const pool = (from: Node | null, to: Node | null): Node[] => {
  const out: Node[] = [];
  for (let node = from; node !== null && node !== to; node = node.nextSibling) if (node.nodeType !== 8) out.push(node);
  return out;
};
/**
 * The pools' nodes in light order, as the statement gives it — `null` unless it accounts for every one, exactly. The
 * statement counts a run of adjacent TEXT as one light child, as the parser makes it; a walk may since have split it
 * (an outer template's static text beside its value), so the pieces that follow one taken are taken with it.
 */
const ordered = (runs: string, pools: Node[][]): Node[] | null => {
  const order: Node[] = [];
  for (const run of runs === '' ? [] : runs.split(',')) {
    const [index, count = '1'] = run.split('*');
    const nodes = pools[+index];
    for (let k = +count; k > 0; k--) {
      let node = nodes?.shift();
      if (node === undefined) return null;
      order.push(node);
      while (node.nodeType === 3 && nodes![0] !== undefined && nodes![0] === node.nextSibling && nodes![0].nodeType === 3) order.push((node = nodes!.shift()!));
    }
  }
  return pools.every((nodes) => nodes.length === 0) ? order : null;
};
/** The `]` that closes the range `start` opens — `null` if another `[` or the parent's end comes first: not well-formed. */
const endOf = (start: Node): ChildNode | null => {
  let end = start.nextSibling;
  while (end !== null && !isMark(end, ']') && !isMark(end, '[')) end = end.nextSibling;
  return end !== null && isMark(end, ']') ? end : null;
};
const SERVED = new WeakSet<Node>();
/** Every well-formed range under `parent`, in document order — never entering a range, the carrier, or a served host. */
const scan = (parent: Node, out: Node[][], skip: Node | null) => {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node === skip) continue;
    if (isMark(node, '[')) {
      const end = endOf(node);
      if (end !== null) {
        out.push(pool(node.nextSibling, end));
        node = end;
      }
    } else if (node.nodeType === 1 && !(node as Element).hasAttribute(LIGHT_ATTR) && !SERVED.has(node)) scan(node, out, null);
  }
};

/** The server's carrier — the host's first child, when it is `<ins data-vm-unassigned>` — or `null`. */
const carrierOf = (host: Element): HTMLElement | null => {
  const first = host.firstChild;
  return first !== null && first.nodeType === 1 && (first as Element).hasAttribute(UNASSIGNED) ? (first as HTMLElement) : null;
};
/** The statement's runs (after its format number), or `null` for another format or none. */
const statementOf = (spec: string | null): string | null => {
  const colon = spec === null ? -1 : spec.indexOf(':');
  return colon < 0 || spec!.slice(0, colon) !== FORMAT ? null : spec!.slice(colon + 1);
};
/** Every well-formed range's light nodes, then the carrier's — the pools a statement indexes, found by structure. */
const poolsOf = (host: Element, carrier: Node | null): Node[][] => {
  const pools: Node[][] = [];
  scan(host, pools, carrier);
  if (carrier !== null) pools.push(pool(carrier.firstChild, null));
  return pools;
};
/** A served host not yet adopted: its light children in light order, read fresh from its statement — or `null`. */
const stated = (host: Element): Node[] | null => {
  const runs = statementOf(host.getAttribute(LIGHT_ATTR));
  return runs === null ? null : ordered(runs, poolsOf(host, carrierOf(host)));
};

let registry: Registry;
/** Hydration's mismatch, handed over at `open`. */
let fail: HydrationFail;

/** A served host, read: its statement, its carrier. Slots must be wired, and of this release. */
const open = (host: Element, failWith: HydrationFail): Served => {
  fail = failWith;
  const seam = registry._$capture$;
  if (seam === undefined) throw new Error(__DEV__ ? '[vera] hydrate-slots: wire `slots` beside it' : '[vera] hydrate-slots: no slots');
  const spec = host.getAttribute(LIGHT_ATTR)!;
  host.removeAttribute(LIGHT_ATTR);
  SERVED.add(host);
  if (seam[0] !== PROTOCOL) fail('protocol', host, __DEV__ && (() => `slots protocol ${seam[0]}, expected ${PROTOCOL}`));
  const runs = statementOf(spec);
  const served = { _host: host, _runs: runs ?? '', carrier: carrierOf(host), _pools: [], _capture: seam[1] };
  /** Another release's server: rescued HERE — hydration holds no state for this host until `open` returns. */
  if (runs === null) {
    rescue(served);
    /** Named in every build (Brian, 2026-10-02): a deploy, not a developer, meets it. */
    fail('format', host, () => `${__DEV__ ? `server format ${JSON.stringify(spec.split(':')[0])}, expected ${FORMAT}: ` : ''}update @verajs/ssr and @verajs/renderer together`);
  }
  return served;
};

/** At a canonical `<slot>`: a range at the cursor is its region — the slot itself a detached copy, as the client keeps it. */
const slot = (canonical: Element, cursor: HydrationCursor, served: ServedHost): Element | null => {
  if (canonical.localName !== 'slot') return null;
  const rs = cursor.offset === 0 ? cursor.node : null;
  if (rs === null || !isMark(rs, '[')) return null;
  const re = endOf(rs);
  if (re === null) return fail('slot', rs, __DEV__ && (() => `a filled slot's range here is not well-formed`));
  (served as Served)._pools.push(pool(rs.nextSibling, re));
  const copy = cursor.parent.ownerDocument!.importNode(canonical, true) as Element & { _$region$?: [Comment, Comment] };
  copy._$region$ = [rs as Comment, re as Comment];
  cursor.node = re.nextSibling;
  return copy;
};

/** Light hosts a template placed RUNS into, walked in this adoption: captured (or converted) at its close. */
let pending: HydrationCursor[] = [];

/**
 * **A light host a template wrote runs into, seated** — whoever walks a light host's content first captures it. Its
 * light children become units in light order: each node outside a run a static, each run `[start, nodes, end]` (its part's
 * anchors, held by `insert`, and the light nodes between them). The statement's order: captured now, waiting for the
 * host's own slots (`wait`). The live record's: each run made one unit of it (`runOf`). Anchors that do not pair up as
 * the template's runs — a run whose items are not each one element — decline.
 */
const seat = (cursor: HydrationCursor) => {
  const { parent, _marks: marks, _runs: runs, end } = cursor as Required<HydrationCursor>;
  const host = parent as Element;
  if (marks.length !== runs * 4)
    fail('run', host, __DEV__ && (() => `a list or value this template writes into a light-slot component is not one element per item`));
  const [, capture, lightNodes, records, standIn, placed, adopted] = registry._$capture$!;
  /**
   * The light children NOW, not as the walk began: a text child the walk split is several light children, as a client
   * render makes it — read as the walk began, its pieces were never captured and the next distribution dropped them.
   */
  const nodes = (end === 0 ? lightNodes(host) : stated(host)) ?? fail('run', host, false);
  const index = (node: unknown) => (node === null ? nodes.length : nodes.indexOf(node as Node));
  /** The statement's order: every light child captured as a static first, waiting for the host's own slots. */
  if (end !== 0) capture(host, null, nodes, carrierOf(host), true);
  const record = records.get(host)!;
  const { holding } = record;
  const ref = holding.lastChild;
  const doc = host.ownerDocument;
  for (let m = 0; m < marks.length; m += 4) {
    const k = index(marks[m + 1]);
    const run = nodes.slice(k, index(marks[m + 3]));
    /**
     * **The run, as the client keeps one**, in place of the statics its nodes were: its unit's two comments in holding,
     * its part's anchors inside them, and at each node's place a stand-in if a slot holds it (it stays there), or the
     * node itself if it waits unassigned. Only holding and the record change; no slotted node moves.
     */
    const at = record.units.findIndex((unit) => unit.a === nodes[k]);
    record.units = record.units.filter((unit) => !run.includes(unit.a));
    const unit = { a: doc.createComment(''), z: doc.createComment('') };
    holding.insertBefore(unit.a, ref);
    holding.insertBefore(marks[m] as Node, ref);
    for (const node of run)
      if (node.parentNode === holding) {
        holding.insertBefore(node, ref);
        placed.set(node, null);
      } else {
        standIn(node, holding, ref);
        if (!placed.has(node)) placed.set(node, adopted);
      }
    holding.insertBefore(marks[m + 2] as Node, ref);
    holding.insertBefore(unit.z, ref);
    record.units.splice(at < 0 ? record.units.length : at, 0, unit);
  }
  /** Nothing to mark: holding is watched, so slots notes these writes as it notes any other. */
};

/** The walk matched: the light children, in light order, captured where they stand — before anything commits. */
const close = (adopted: ServedHost | null) => {
  for (const cursor of pending) seat(cursor);
  pending = [];
  if (adopted === null) return;
  const served = adopted as Served;
  const { _host: host, carrier, _pools: pools } = served;
  if (carrier !== null) pools.push(pool(carrier.firstChild, null));
  served._capture(host, null, ordered(served._runs, pools) ?? fail('slots', host, __DEV__ && (() => `its light-slot statement does not account for what its slots hold`)), carrier);
};

/**
 * It did not: every well-formed range's nodes and the carrier's, captured where they stand before the clear. The clear
 * detaches them with the old markup and the fresh render's end places each by identity, slotted or held — moving them
 * into the carrier first only moved each light node twice more (measured: three disconnect/connect pairs for one).
 */
const rescue = (served: ServedHost | null) => {
  pending = [];
  if (served === null) return;
  const { _host: host, _runs: runs, _capture: capture, carrier } = served as Served;
  const pools = poolsOf(host, carrier);
  /** Every node first: `ordered` consumes the pools, and one that fails partway has taken some. */
  const all = pools.flat();
  capture(host, null, ordered(runs, pools) ?? all, carrier);
};

/**
 * **A light host a template places content into** (the outer walk's light cursor): its children in light order. Slots'
 * live record is the one source once it exists — a node the page added since is in it, and the template need not
 * account for it; before that (the host not yet adopted), the server's statement, read fresh and never cached, which the
 * template must account for exactly. Neither: `null`, and the walk reads the host's DOM.
 */
const light = (host: Element, canonical: Element, plan: ReadonlyMap<Node, readonly number[]>, values: readonly unknown[]): HydrationCursor | null => {
  /** Only a custom element the template places content into can be a light host. */
  if (canonical.firstChild === null || !host.localName.includes('-')) return null;
  /** RUNS the template writes directly among those children: a value that is not text (a text value is claimed in place). */
  let runs = 0;
  for (let node: Node | null = canonical.firstChild; node !== null; node = node.nextSibling)
    if (node.nodeType === 3) {
      const owned = plan.get(node);
      if (owned !== undefined && values[owned[0]] != null && typeof values[owned[0]] === 'object') runs++;
    }
  const seam = registry._$capture$;
  const live = seam?.[0] === PROTOCOL ? seam[2](host) : null;
  if (live !== null) return walker(host, live, 0, runs);
  const nodes = stated(host);
  return nodes === null ? null : walker(host, nodes, nodes.length, runs);
};
/**
 * A cursor over `nodes` — the walk must account for the first `end` of them (all of a statement's, none of a record's);
 * with runs, held until the adoption's close seats it.
 */
const walker = (host: Element, nodes: Node[], end: number, runs: number): HydrationCursor => {
  const cursor = { parent: host, node: nodes[0] ?? null, offset: 0, light: nodes, at: 0, end, _runs: runs, _marks: [] };
  if (runs > 0) pending.push(cursor);
  return cursor;
};

/**
 * An insert on a light walk. A run's anchor is held, with the node it stands before, for the unit `seat` builds — split
 * first if the walk stands inside a text child, as a plain insert would; text (an empty value's anchor) goes in place.
 */
const insert = (cursor: HydrationCursor, node: Node) => {
  if (cursor.offset > 0) {
    cursor.node = (cursor.node as Text).splitText(cursor.offset);
    cursor.offset = 0;
  }
  const at = cursor.node;
  if (node.nodeType === 3) (at === null ? cursor.parent : at.parentNode!).insertBefore(node, at);
  else cursor._marks!.push(node, at);
};

/** The walk's step, once this piece is wired: on a light cursor the next light child, else the next sibling. */
const next = (cursor: HydrationCursor, node: Node): Node | null => {
  const nodes = cursor.light;
  return nodes === undefined ? node.nextSibling : (nodes[++cursor.at!] ?? null);
};

/** `wire([renderer, hydration, slots, hydrateSlots])`. */
export const hydrateSlots = (given: Registry) => {
  registry = given;
  given._$hydrateSlots$ = [PROTOCOL, open, slot, close, rescue, light, next, insert];
};
