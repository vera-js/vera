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
import type { HydrateSlots, HydrationCursor, HydrationFail, LightCapture, ServedHost } from './types.js';

/** The registry as this module uses it — `get` named so `wire`'s registry is assignable (a type of optional members alone is "weak"). */
type Registry = { get(name: string): unknown[] | undefined; _$capture$?: [number, LightCapture]; _$hydrateSlots$?: HydrateSlots };
/** A served host being adopted: what hydration sees (`ServedHost`), and what this module keeps beside it. */
type Served = ServedHost & { host: Element; runs: string; carrier: HTMLElement | null; pools: Node[][]; capture: LightCapture };

/** What `@verajs/ssr` writes — a deliberate second address of its writer; `slots-ssr-client-parity` holds them together. */
const FORMAT = '1';
const LIGHT_ATTR = 'data-vm-light';
const UNASSIGNED = 'vm-unassigned';
const isMark = (node: Node, data: string) => node.nodeType === 8 && (node as Comment).data === data;
/** The slottable nodes from `from` up to `to` — comments are never light content. */
const pool = (from: Node | null, to: Node | null): Node[] => {
  const out: Node[] = [];
  for (let node = from; node !== null && node !== to; node = node.nextSibling) if (node.nodeType !== 8) out.push(node);
  return out;
};
/** The pools' nodes in light order, as the statement gives it — `null` unless it accounts for every one, exactly. */
const ordered = (runs: string, pools: Node[][]): Node[] | null => {
  const order: Node[] = [];
  for (const run of runs === '' ? [] : runs.split(',')) {
    const [index, count = '1'] = run.split('*');
    for (let k = +count; k > 0; k--) {
      const node = pools[+index]?.shift();
      if (node === undefined) return null;
      order.push(node);
    }
  }
  return pools.every((nodes) => nodes.length === 0) ? order : null;
};
const SERVED = new WeakSet<Node>();
/** Every well-formed range under `parent`, in document order — never entering a range, the carrier, or a served host. */
const scan = (parent: Node, out: Node[][], skip: Node | null) => {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node === skip) continue;
    if (isMark(node, '[')) {
      let end = node.nextSibling;
      while (end !== null && !isMark(end, ']') && !isMark(end, '[')) end = end.nextSibling;
      if (end !== null && isMark(end, ']')) {
        out.push(pool(node.nextSibling, end));
        node = end;
      }
    } else if (node.nodeType === 1 && !(node as Element).hasAttribute(LIGHT_ATTR) && !SERVED.has(node)) scan(node, out, null);
  }
};

let registry: Registry;
/** Hydration's mismatch, handed over at `open`. */
let fail: HydrationFail;

/** A served host, read: its statement, its carrier. Slots must be wired, and of this release. */
const open = (host: Element, failWith: HydrationFail): Served => {
  fail = failWith;
  const seam = registry._$capture$;
  if (seam === undefined) throw new Error('[vera] hydrate-slots: wire `slots` beside it');
  const spec = host.getAttribute(LIGHT_ATTR)!;
  host.removeAttribute(LIGHT_ATTR);
  SERVED.add(host);
  if (seam[0] !== PROTOCOL) fail('protocol', host, () => `slots protocol ${seam[0]}, expected ${PROTOCOL}`);
  const first = host.firstChild;
  const carrier = first !== null && first.nodeType === 1 && (first as Element).localName === UNASSIGNED ? (first as HTMLElement) : null;
  const colon = spec.indexOf(':');
  const served = { host, runs: spec.slice(colon + 1), carrier, pools: [], capture: seam[1] };
  /** Another release's server: rescued HERE — hydration holds no state for this host until `open` returns. */
  if (colon < 0 || spec.slice(0, colon) !== FORMAT) {
    rescue(served);
    fail('format', host, () => `server format ${JSON.stringify(spec.slice(0, Math.max(colon, 0)))}, expected ${FORMAT}: update @verajs/ssr and @verajs/renderer together`);
  }
  return served;
};

/** At a canonical `<slot>`: a range at the cursor is its region — the slot itself a detached copy, as the client keeps it. */
const slot = (canonical: Element, cursor: HydrationCursor, served: ServedHost): Element | null => {
  if (canonical.localName !== 'slot') return null;
  const rs = cursor.offset === 0 ? cursor.node : null;
  if (rs === null || !isMark(rs, '[')) return null;
  let re = rs.nextSibling;
  while (re !== null && !isMark(re, ']')) re = re.nextSibling;
  if (re === null) return fail('slot', rs, __DEV__ && (() => `a filled slot's range here never ends`));
  (served as Served).pools.push(pool(rs.nextSibling, re));
  const copy = cursor.parent.ownerDocument!.importNode(canonical, true) as Element & { _$region$?: [Comment, Comment] };
  copy._$region$ = [rs as Comment, re as Comment];
  cursor.node = re.nextSibling;
  return copy;
};

/** The walk matched: the light children, in light order, captured where they stand — before anything commits. */
const close = (adopted: ServedHost) => {
  const served = adopted as Served;
  const { host, carrier, pools } = served;
  if (carrier !== null) pools.push(pool(carrier.firstChild, null));
  served.capture(host, null, ordered(served.runs, pools) ?? fail('slots', host, __DEV__ && (() => `its light-slot statement does not account for what its slots hold`)), carrier);
};

/** It did not: every well-formed range's nodes and the carrier's, into the carrier, captured there before the clear. */
const rescue = (served: ServedHost) => {
  const { host, runs, capture } = served as Served;
  let { carrier } = served as Served;
  const pools: Node[][] = [];
  scan(host, pools, carrier);
  if (carrier !== null) pools.push(pool(carrier.firstChild, null));
  const all = pools.flat();
  const nodes = ordered(runs, pools) ?? all;
  carrier ??= host.ownerDocument.createElement(UNASSIGNED);
  for (const node of nodes) carrier.appendChild(node);
  capture(host, null, nodes, carrier);
};

/** `wire([renderer, hydration, slots, hydrateSlots])`. */
export const hydrateSlots = (given: Registry) => {
  registry = given;
  given._$hydrateSlots$ = [PROTOCOL, open, slot, close, rescue];
};
