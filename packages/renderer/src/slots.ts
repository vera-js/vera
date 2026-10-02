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
 * A light unit: a static child the page wrote (`a === z`), which moves as itself; or a RUN one of its template's
 * bindings writes, between this module's own two comments, which never leaves holding — the renderer walks it there,
 * contiguous, and each node of it a slot takes leaves a STAND-IN comment at its place. Every light node goes to the
 * slot its own `slot` names, exactly as the platform assigns.
 */
type Unit = { a: Node; z: Node };
/** One `<slot>` of a light host: while it has content, `rs`/`re` stand in its place and the element is out. */
type Rec = { slot: Kept; light: Light; rs: Comment | null; re: Comment | null; shown: Node[]; queued: boolean };
type Kept = HTMLSlotElement & { $rec?: Rec };

/** A host's light children, by unit, in the order the page wrote them, and its slots. */
type Light = { host: Element; units: Unit[]; holding: DocumentFragment; recs: Rec[]; dirty: boolean; fresh: boolean };

const HOSTS = new WeakMap<Element, Light>();
/** The static children an outer template gave a host, recorded when its instance was created (see `hostBehavior`). */
const STATICS = new WeakMap<Element, Set<Node>>();
/** Which light a node that might change belongs to — a holding fragment, or a parent a region lives in. */
const WATCHED = new WeakMap<Node, Set<Light>>();
/** A run's node in a slot, and the comment holding its place in the run — both ways. */
const STAND = new WeakMap<Node, Comment>();
const REAL = new WeakMap<Node, Node>();
/** The slot a light node was placed in (`null`: holding). */
const PLACED = new WeakMap<Node, Rec | null>();

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

/** Whether a light node is still where this module put it — false once something else took it (the user's adoption stands). */
const isWhere = (node: Node, light: Light): boolean => {
  const rec = PLACED.get(node);
  const parent = node.parentNode;
  if (rec === undefined) return parent === light.holding;
  return rec === null ? parent === light.holding : parent !== null && parent === rec.re?.parentNode;
};

/**
 * **Every light node to its slot, in light order** — the whole decision, recomputed. A node something else took away
 * is forgotten first; then each name's first slot in tree order wins, its nodes go between its comments (a run's node
 * leaving a stand-in at its place), a slot left with nothing shows its fallback, and the rest wait in holding.
 */
const distribute = (light: Light) => {
  light.dirty = false;
  const holding = light.holding;
  /** Captured and not yet distributed: out of the host now, in light order — once (a top-level slot's content lives there). */
  if (light.fresh) for (const unit of light.units)
    if (unit.a.parentNode === light.host)
      if (unit.a === unit.z) holding.insertBefore(unit.a, holding.lastChild);
      else {
        const run: Node[] = [];
        for (let node: Node | null = unit.a; node !== null; node = node.nextSibling) {
          run.push(node);
          if (node === unit.z) break;
        }
        for (const node of run) holding.insertBefore(node, holding.lastChild);
      }
  light.fresh = false;
  light.units = light.units.filter((unit) => (unit.a === unit.z ? isWhere(unit.a, light) : unit.a.parentNode === holding && unit.z.parentNode === holding));
  for (const unit of light.units)
    if (unit.a !== unit.z)
      for (let node = unit.a.nextSibling; node !== null && node !== unit.z; node = node.nextSibling) {
        const real = REAL.get(node);
        if (real !== undefined && !isWhere(real, light)) {
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
      for (const node of mine) {
        /** A run's node, still at its place in holding: a stand-in takes the place before it leaves. */
        if (node.parentNode === holding && !STAND.has(node) && PLACED.get(node) === undefined) {
          const stand = node.ownerDocument!.createComment('');
          holding.insertBefore(stand, node);
          STAND.set(node, stand);
          REAL.set(stand, node);
        }
        parent.insertBefore(node, rec.re);
        if (PLACED.get(node) !== undefined || !STAND.has(node)) PLACED.set(node, rec);
        else PLACED.set(node, rec);
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
    const stand = STAND.get(node);
    if (stand !== undefined) {
      /** A run's node, back to its place in the run. */
      holding.insertBefore(node, stand);
      unstand(node);
      PLACED.delete(node);
    } else if (rec !== undefined && rec !== null) {
      holding.insertBefore(node, holding.lastChild);
      PLACED.set(node, null);
    }
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
/** How many nodes this batch has put ahead of everything, per host — so a batch's front insertions keep their order. */
let lead = new WeakMap<Light, number>();
const note = (records: MutationRecord[]) => {
  lead = new WeakMap();
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
        if (record.type === 'childList') replay(light, record);
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
  PLACED.set(node, null);
  if (ahead) {
    const at = lead.get(light) ?? 0;
    light.units.splice(at, 0, { a: node, z: node });
    lead.set(light, at + 1);
  } else light.units.push({ a: node, z: node });
  light.dirty = true;
};

/** Which unit a light node is in — its own, or (a run's node in a slot) the run its stand-in sits in. */
const unitIndexOf = (light: Light, node: Node): number => {
  const stand = STAND.get(node);
  if (stand === undefined) return light.units.findIndex((unit) => unit.a === node);
  return light.units.findIndex(
    (unit) => unit.a !== unit.z && (unit.a.compareDocumentPosition(stand) & 4) !== 0 && (stand.compareDocumentPosition(unit.z) & 4) !== 0
  );
};

/**
 * A node the USER put inside a slot's region — `slotted.before(node)`, `after()`: a light unit of its own, at that
 * place in light order.
 */
const settleIn = (light: Light, node: Node) => {
  const parent = node.parentNode;
  if (parent === null || node.nodeType === 8) return;
  for (const rec of light.recs) {
    if (rec.re === null || rec.re.parentNode !== parent) continue;
    if ((rec.rs!.compareDocumentPosition(node) & 4) === 0 || (node.compareDocumentPosition(rec.re) & 4) === 0) continue;
    let at = -1;
    for (let next = node.nextSibling; next !== null && next !== rec.re && at < 0; next = next.nextSibling) at = unitIndexOf(light, next);
    if (at < 0) light.units.push({ a: node, z: node });
    else light.units.splice(at, 0, { a: node, z: node });
    PLACED.set(node, rec);
    light.dirty = true;
    return;
  }
};

/**
 * **What the renderer wrote, read back into the runs.** A run's node in a slot is still the renderer's: an insert
 * before it (a new row), markers around it (a text becoming a template), its move or removal all happen where the
 * node now is. Each lands in the run at the place its neighbour's stand-in holds, so the run stays the renderer's
 * whole range; what has no such neighbour is the user's own edit.
 */
const replay = (light: Light, record: MutationRecord) => {
  const holding = light.holding;
  for (const node of record.removedNodes) {
    const real = REAL.get(node);
    if (real !== undefined) {
      /** A stand-in the renderer took: cleared with its run (its node goes too), or parked by `hold` (it joins it). */
      if (node.parentNode === holding) continue;
      if (node.parentNode === null) real.parentNode?.removeChild(real);
      else node.parentNode.insertBefore(real, node);
      PLACED.delete(real);
      unstand(real);
    } else if (STAND.has(node) && node.parentNode === null) {
      /** A run's node the renderer removed from its slot (a row deleted): its place goes too. */
      PLACED.delete(node);
      unstand(node);
    }
  }
  for (const node of record.addedNodes) {
    if (node.parentNode !== record.target) continue;
    if (record.target === holding) {
      /** Back in holding (the renderer moved it before a marker there): its own place now, not its stand-in's. */
      if (STAND.has(node)) {
        PLACED.delete(node);
        unstand(node);
      }
      continue;
    }
    if (PLACED.get(node) !== undefined && !STAND.has(node)) continue;
    const next = record.nextSibling;
    const previous = record.previousSibling;
    const ahead = next === null ? undefined : (STAND.get(next) ?? (next.parentNode === holding ? next : undefined));
    const behind = previous === null ? undefined : (STAND.get(previous) ?? (previous.parentNode === holding ? previous : undefined));
    if (ahead === undefined && behind === undefined) {
      settleIn(light, node);
      continue;
    }
    const place = ahead ?? behind!.nextSibling;
    /** A run's node moved within the page: its place in the run moves. New to the run: it joins it, at that place. */
    holding.insertBefore(STAND.get(node) ?? node, place);
  }
};

/** A captured host that turned out to have a shadow root: its children go back, in light order, for the platform. */
const release = (light: Light) => {
  for (const unit of light.units) {
    if (unit.a === unit.z) {
      light.host.appendChild(unit.a);
      continue;
    }
    for (let node = unit.a.nextSibling; node !== null && node !== unit.z; ) {
      const next = node.nextSibling;
      light.host.appendChild(REAL.get(node) ?? node);
      node = next;
    }
  }
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
  light = { host, units: [], holding, recs: [], dirty: false, fresh: false };
  HOSTS.set(host, light);
  lights.add(light);
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
  for (const child of [...host.childNodes]) {
    if (statics === undefined || statics.has(child)) {
      close();
      light.units.push({ a: child, z: child });
    } else (run ??= []).push(child);
  }
  close();
  light.dirty = true;
  light.fresh = true;
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
      light = { host: root as Element, units: [], holding, recs: [], dirty: false, fresh: false };
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
    for (const node of lightOf(light)) {
      if (PLACED.get(node) !== rec) continue;
      const stand = STAND.get(node);
      if (stand !== undefined) {
        light.holding.insertBefore(node, stand);
        unstand(node);
        PLACED.delete(node);
      } else {
        light.holding.insertBefore(node, light.holding.lastChild);
        PLACED.set(node, null);
      }
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
    return lightOf(light).filter((node) => slotNameOf(node) === name);
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
  /**
   * **After every render** — the renderer says when one finishes (`_$done$`, off-chain like `$t`), and what it did to a
   * light host's children is distributed before anything reads them.
   */
  (registry: Map<string, unknown[]>) => {
    (registry as unknown as { _$done$?: () => void })._$done$ = flush;
  },
];

/** `wire([renderer, slots])`. */
export const slots = [slotDiscovery, serve];
