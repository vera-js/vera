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
import { RESERVED_ELEMENT_NAMES } from '@verajs/shared-utils';
import { elements } from './elements.js';

/** A slot's assignment name: an element's `slot` attribute, `''` for text; a comment is never slottable. */
const slotNameOf = (node: Node): string | null =>
  node.nodeType === 3 ? '' : node.nodeType === 1 ? ((node as Element).getAttribute('slot') ?? '') : null;

/**
 * One light unit: a static child (`a === z`), or a binding's run between this module's own two comments. `at` is
 * the slot it was last placed in, or `null` for holding.
 */
type Unit = { a: Node; z: Node; at: Rec | null };
/** One `<slot>` of a light host: while it has content, `rs`/`re` stand in its place and the element is out. */
type Rec = { slot: Kept; light: Light; rs: Comment | null; re: Comment | null; shown: Node[]; queued: boolean };
type Kept = HTMLSlotElement & { $rec?: Rec };

/** A host's light children, by unit, in the order the page wrote them, and its slots. */
type Light = { host: Element; units: Unit[]; holding: DocumentFragment; recs: Rec[]; dirty: boolean };

const HOSTS = new WeakMap<Element, Light>();
/** The static children an outer template gave a host, recorded when its instance was created (see `hostBehavior`). */
const STATICS = new WeakMap<Element, Set<Node>>();
/** Which light a node that might change belongs to — a holding fragment, or a parent a region lives in. */
const WATCHED = new WeakMap<Node, Set<Light>>();

const nodesOf = (unit: Unit): Node[] => {
  const out: Node[] = [];
  for (let node: Node | null = unit.a; node !== null; node = node.nextSibling) {
    out.push(node);
    if (node === unit.z) break;
  }
  return out;
};
/** A unit's slottables: its top-level text and elements, never a comment (a marker, or this module's own). */
const slottablesOf = (unit: Unit): Node[] => nodesOf(unit).filter((node) => slotNameOf(node) !== null);
/**
 * Which slot a unit goes to: its first slottable's. A static child is one node, so this is native; a binding's run
 * goes whole, by its first slottable — a run whose elements name different slots is said in development.
 */
const nameOfUnit = (unit: Unit): string | null => {
  const nodes = slottablesOf(unit);
  if (nodes.length === 0) return null;
  const name = slotNameOf(nodes[0]);
  if (__DEV__ && nodes.some((node) => node.nodeType === 1 && slotNameOf(node) !== name))
    console.warn(
      `[vera] slots: <${(unit.a.parentNode as Element | null)?.localName ?? 'host'}> — one binding rendered elements for ` +
        `different slots; it is distributed whole, to slot "${name}". Give each slot its own binding.`
    );
  return name;
};

/** Where a unit physically is now — false once something other than this module moved it away (the user took it). */
const isWhere = (unit: Unit, light: Light): boolean => {
  const parent = unit.a.parentNode;
  if (parent === null || unit.z.parentNode !== parent) return false;
  return unit.at === null ? parent === light.holding : parent === unit.at.re?.parentNode;
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
const before = (x: Node[], y: Node[]) => {
  for (let i = 0; i < x.length && i < y.length; i++)
    if (x[i] !== y[i]) return (x[i].compareDocumentPosition(y[i]) & 4) !== 0;
  return x.length < y.length;
};

/* ── distribution ──────────────────────────────────────────────────────────────────────────────── */

const region = (rec: Rec) => {
  if (rec.rs !== null) return;
  const doc = rec.slot.ownerDocument;
  const parent = rec.slot.parentNode!;
  rec.rs = doc.createComment('');
  rec.re = doc.createComment('');
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
 * **Every unit to its slot, in light order** — the whole decision, recomputed. A unit something else took away is
 * forgotten first (the user's adoption stands); then each name's first slot in tree order wins, its units go
 * between its comments, a slot left with no slottable content shows its fallback, and the rest wait in holding.
 */
const distribute = (light: Light) => {
  light.dirty = false;
  light.units = light.units.filter((unit) => isWhere(unit, light));
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
  const wanted = new Map<Rec, Unit[]>();
  for (const unit of light.units) {
    const name = nameOfUnit(unit);
    const rec = name === null ? undefined : winner.get(name);
    let list = rec === undefined ? undefined : wanted.get(rec);
    if (rec !== undefined && list === undefined) wanted.set(rec, (list = []));
    list?.push(unit);
  }
  for (const { rec } of live) {
    const units = wanted.get(rec) ?? [];
    if (units.length > 0) {
      region(rec);
      const parent = rec.re!.parentNode!;
      for (const unit of units) {
        for (const node of nodesOf(unit)) parent.insertBefore(node, rec.re);
        unit.at = rec;
      }
    }
    const shown = units.flatMap(slottablesOf);
    if (shown.length !== rec.shown.length || shown.some((node, i) => node !== rec.shown[i])) {
      rec.shown = shown;
      changed(rec);
    }
  }
  for (const unit of light.units)
    if (unit.at !== null && !parked.has(unit.at) && !wanted.get(unit.at)?.includes(unit)) {
      for (const node of nodesOf(unit)) light.holding.insertBefore(node, light.holding.lastChild);
      unit.at = null;
    }
  for (const { rec } of live) if (!wanted.has(rec)) unregion(rec);
};

/* ── the observer: what the page's templates (and the user) do afterwards ─────────────────────── */

let observers: [MutationObserver, MutationObserver] | null = null;
/** Records of this module's own moves, taken and dropped once it is done — they are not news. */
const settle = () => {
  if (observers !== null) {
    observers[0].takeRecords();
    observers[1].takeRecords();
  }
};
const note = (records: MutationRecord[]) => {
  for (const record of records) {
    let target: Node | null = record.target;
    /** An attribute record names the element; its light is found through the parent it sits in. */
    if (record.type === 'attributes') {
      const rec = (target as Kept).$rec;
      if (rec !== undefined) {
        rec.light.dirty = true;
        continue;
      }
      while (target !== null && !WATCHED.has(target)) target = target.parentNode;
      if (target === null) continue;
    }
    const lights = WATCHED.get(target);
    if (lights !== undefined)
      for (const light of lights) {
        light.dirty = true;
        if (record.type === 'childList' && target !== light.holding) for (const node of record.addedNodes) settleIn(light, node);
      }
    /** A host's own children: an addition outside its render's range is a new light child. */
    const light = HOSTS.get(record.target as Element);
    if (light !== undefined && record.type === 'childList')
      for (const node of record.addedNodes) adopt(light, node);
  }
};
const handle = (records: MutationRecord[]) => {
  note(records);
  flush();
};
const lights = new Set<Light>();
/** Applies whatever is pending, now — after every component render, and before any read of the assignment. */
const flush = () => {
  if (observers !== null) note([...observers[0].takeRecords(), ...observers[1].takeRecords()]);
  for (const light of lights) if (light.dirty) distribute(light);
  settle();
};
const watch = (node: Node, light: Light) => {
  let set = WATCHED.get(node);
  if (set === undefined) WATCHED.set(node, (set = new Set()));
  if (set.has(light)) return;
  set.add(light);
  const view = (light.host.ownerDocument.defaultView ?? globalThis) as typeof globalThis;
  observers ??= [new view.MutationObserver(handle), new view.MutationObserver(handle)];
  observers[0].observe(node, { childList: true });
  observers[1].observe(node, { attributes: true, attributeFilter: ['slot'], subtree: true });
};

/**
 * A node added to a host after its render: a light unit, appended in light order — unless it is the render's own. The
 * render's range runs from the host's first comment to its last that is not one of this module's units (captured
 * light children not yet distributed sit before it); comments are never slottable, so none is adopted.
 */
const adopt = (light: Light, node: Node) => {
  if (node.nodeType === 8 || node.parentNode !== light.host) return;
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
  if (first !== null && first !== last && (first.compareDocumentPosition(node) & 4) !== 0 && (node.compareDocumentPosition(last!) & 4) !== 0)
    return;
  /** Before the render's range is ahead of everything distributed away; after it, behind. Read before it moves. */
  const ahead = first !== null && (node.compareDocumentPosition(first) & 4) !== 0;
  light.holding.insertBefore(node, light.holding.lastChild);
  if (ahead) light.units.unshift({ a: node, z: node, at: null });
  else light.units.push({ a: node, z: node, at: null });
  light.dirty = true;
};

/**
 * A node the USER put inside a slot's region — `slotted.before(node)`, `after()`: a light unit, at that place in light
 * order. What the renderer writes inside a unit (between its two comments) is that unit's, never a new one.
 */
const settleIn = (light: Light, node: Node) => {
  const parent = node.parentNode;
  if (parent === null || node.nodeType === 8) return;
  for (const rec of light.recs) {
    if (rec.re === null || rec.re.parentNode !== parent) continue;
    if ((rec.rs!.compareDocumentPosition(node) & 4) === 0 || (node.compareDocumentPosition(rec.re) & 4) === 0) continue;
    let next: Unit | undefined;
    for (const unit of light.units) {
      if (unit.at !== rec) continue;
      if (unit.a === node) return;
      const after = (unit.a.compareDocumentPosition(node) & 4) !== 0;
      if (after && (node.compareDocumentPosition(unit.z) & 4) !== 0) return;
      if (!after && next === undefined) next = unit;
    }
    const added: Unit = { a: node, z: node, at: rec };
    const at = next === undefined ? -1 : light.units.indexOf(next);
    if (at < 0) {
      const last = light.units.findLastIndex((unit) => unit.at === rec);
      light.units.splice(last + 1, 0, added);
    } else light.units.splice(at, 0, added);
    light.dirty = true;
    return;
  }
};

/** A captured host that turned out to have a shadow root: its children go back, in light order, for the platform. */
const release = (light: Light) => {
  for (const unit of light.units) for (const node of nodesOf(unit)) if (node.nodeType !== 8 || (node !== unit.a && node !== unit.z)) light.host.appendChild(node);
  HOSTS.delete(light.host);
  lights.delete(light);
};

/* ── capture ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * **Capture**, at `init` — before the host's first render, when everything it holds is the page's. Each static child
 * is a unit; each run between statics (what the page's template bound there) is one unit, wrapped in this module's
 * two comments so its extent survives whatever the renderer writes inside it.
 */
const capture = (host: Element): Light => {
  let light = HOSTS.get(host);
  if (light !== undefined) return light;
  const doc = host.ownerDocument;
  const holding = doc.createDocumentFragment();
  holding.append(doc.createComment(''), doc.createComment(''));
  light = { host, units: [], holding, recs: [], dirty: false };
  HOSTS.set(host, light);
  lights.add(light);
  const statics = STATICS.get(host);
  let run: Node[] | null = null;
  /** Out of the host at once — invisibly to holding, until a slot of its name takes it. */
  const close = () => {
    if (run === null) return;
    const a = doc.createComment('');
    const z = doc.createComment('');
    holding.insertBefore(a, holding.lastChild);
    for (const node of run) holding.insertBefore(node, holding.lastChild);
    holding.insertBefore(z, holding.lastChild);
    light!.units.push({ a, z, at: null });
    run = null;
  };
  for (const child of [...host.childNodes]) {
    if (statics === undefined || statics.has(child)) {
      close();
      holding.insertBefore(child, holding.lastChild);
      light.units.push({ a: child, z: child, at: null });
    } else (run ??= []).push(child);
  }
  close();
  watch(holding, light);
  observers![0].observe(host, { childList: true });
  return light;
};

/**
 * **A dashed element in a template is told it was created** — before the page's template commits into it — so the
 * children it has then are exactly its statics: a binding position is still the empty text the template parsed it
 * as. Recorded by node; `init` capture reads it.
 */
const hostBehavior = {
  create: (element: Element, adopted: boolean) => {
    if (adopted) return;
    const statics = new Set<Node>();
    for (const child of element.childNodes) if (!(child.nodeType === 3 && (child as Text).data === '')) statics.add(child);
    STATICS.set(element, statics);
  },
};

/* ── the slot element ──────────────────────────────────────────────────────────────────────────── */

/**
 * The `<slot>` element's own answers, from the live assignment (a slot outside a shadow tree answers nothing). With
 * `flatten`, an unassigned slot answers its fallback's slottables, a nested slot through itself.
 */
const assigned = (rec: Rec, elementsOnly: boolean, flatten = false): Node[] => {
  flush();
  const out = rec.shown.filter((node) => !elementsOnly || node.nodeType === 1);
  if (out.length > 0 || !flatten) return out;
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
          `[vera] slots: <slot${slot.hasAttribute('name') ? ` name="${slot.getAttribute('name')}"` : ''}> carries ` +
            `${inert.map((name) => `\`${name}\``).join(', ')}, which does nothing in a light-DOM component: the slot element ` +
            `steps out of the page while it has content. Events, \`name\` and \`&ref\` all work here.`
        );
    }
    /** A host `init` never saw has no captured children: what it holds now is its own render, never light content. */
    flush();
    let light = HOSTS.get(root as Element);
    if (light === undefined) {
      const doc = (root as Element).ownerDocument;
      const holding = doc.createDocumentFragment();
      holding.append(doc.createComment(''), doc.createComment(''));
      light = { host: root as Element, units: [], holding, recs: [], dirty: false };
      HOSTS.set(root as Element, light);
      lights.add(light);
      watch(holding, light);
      observers![0].observe(root, { childList: true });
    }
    const kept = slot as Kept;
    const rec: Rec = { slot: kept, light, rs: null, re: null, shown: [], queued: false };
    kept.$rec = rec;
    kept.assignedNodes = (options?: AssignedNodesOptions) => assigned(rec, false, options?.flatten);
    kept.assignedElements = (options?: AssignedNodesOptions) => assigned(rec, true, options?.flatten) as Element[];
    light.recs.push(rec);
    watch(kept, light);
    observers![1].observe(kept, { attributes: true, attributeFilter: ['slot', 'name'], subtree: true });
    distribute(light);
    settle();
    return rec;
  },
  /** Torn down: its content goes back to holding first, and the element back in its place, before the renderer removes it. */
  unmount: (rec: Rec) => {
    flush();
    const light = rec.light;
    light.recs.splice(light.recs.indexOf(rec), 1);
    for (const unit of light.units)
      if (unit.at === rec) {
        for (const node of nodesOf(unit)) light.holding.insertBefore(node, light.holding.lastChild);
        unit.at = null;
      }
    unregion(rec);
    distribute(light);
    settle();
  },
};

/** The slotted nodes a light host shows in its slot of `name` — or a shadow host's, from the platform. */
export const slotted = (host: Element, name = ''): Node[] => {
  const light = HOSTS.get(host);
  if (light !== undefined) {
    flush();
    for (const rec of light.recs) if ((rec.slot.getAttribute('name') ?? '') === name && rec.shown.length > 0) return [...rec.shown];
    /** Unassigned, a node still belongs to the host: it waits in holding for a slot of its name. */
    return light.units.filter((unit) => unit.at === null && nameOfUnit(unit) === name).flatMap(slottablesOf);
  }
  /**
   * `_root` first: a CLOSED root is null through `shadowRoot`, and core keeps the root it attached under that unmangled
   * name in both modes (`@verajs/styles` reads it the same way). Quoted, so this bundle's mangling leaves it alone.
   * Names are compared, never put in a selector — a quote in one would throw.
   */
  const root = (host as unknown as Record<string, ShadowRoot | null | undefined>)['_root'] ?? host.shadowRoot;
  const slot = [...(root?.querySelectorAll('slot') ?? [])].find((s) => (s.getAttribute('name') ?? '') === name);
  return slot === undefined ? [] : slot.assignedNodes();
};

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

/** Discovery: `<slot>` elements and dashed hosts claimed in templates, through `elements`. */
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
    fn: (element: Element) => {
      const name = element.localName;
      /**
       * A SHADOW host distributes natively: core attaches its root before this insert runs and keeps it under the
       * unmangled `_root` (a closed root is null through `shadowRoot`), quoted so this bundle's mangling leaves it alone.
       */
      if ((element as unknown as Record<string, unknown>)['_root'] != null || element.shadowRoot !== null) return;
      if (name.includes('-') && !RESERVED_ELEMENT_NAMES.has(name) && !HOSTS.has(element)) capture(element);
    },
    priority: 10,
  },
  {
    name: '@verajs/renderer/slot-discovery',
    on: 'element' as const,
    fn: (el: Element) =>
      el.localName === 'slot' ? slotBehavior : el.localName.includes('-') && !RESERVED_ELEMENT_NAMES.has(el.localName) ? hostBehavior : undefined,
    priority: 10,
  },
  /** After every component render: what its template did to a light host's units is distributed before anything reads it. */
  { name: '@verajs/renderer/slots-flush', on: 'render' as const, fn: () => flush(), priority: 60 },
];

/** `wire([renderer, slots])`. */
export const slots = [slotDiscovery, serve];
