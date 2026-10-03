/**
 * **`@verajs/renderer/hydration` — adopt server-rendered DOM.** `wire([renderer, hydration])`.
 *
 * One renderer: this module plugs into it through the hand-off the renderer sets at `connect` (`$H` — a separately
 * bundled module cannot import the renderer's internals, and production mangles their names), and asks to be told of
 * every container's FIRST render that finds children already there. It adopts them as the server's output of the same
 * template: node identity kept, listeners attached, updates mutating the adopted nodes. Server HTML carries no framework
 * comments; the client puts in the anchors it needs.
 *
 * **Verify, then commit.** Phase 1 walks the container READING ONLY — statics byte for byte, element names, text
 * boundaries, nested templates and lists — and runs no user code but the one text conversion a client render would run
 * anyway, recorded and reused. Only when the whole container matches does phase 2 walk it again for real: anchors put
 * in, hooks told, bindings committed in client order. So a container that does not match is rendered fresh with NOTHING
 * of the client's run against the server's nodes: no setter, no `create`, no ref, no listener, no applier. (The one
 * exception is the platform's: a server custom element already defined upgrades on parse and runs its own setup before
 * any hydration starts — `tests/hydration-walk.test.mjs` pins it.)
 *
 * **The renderer's commit never asks "am I hydrating?".** Where the server's attribute already says what the client
 * would write, the walk SEEDS the binding's committed value and calls the base commit — which runs every sink check as
 * always (a `javascript:` URL is refused and removed exactly as on a fresh render) and then skips the write on its own
 * `value === committed` fast path. Form state is recorded, never written: the server's default, and anything the user
 * typed before the script arrived, stand.
 *
 * A mismatch — or a renderer speaking another hand-off protocol — never breaks the page: the container renders fresh,
 * and the console says so once per cause.
 */
import { CONTENT_PROPERTY } from '@verajs/shared-utils';
import {
  ADOPT,
  ATTR,
  BOOLEAN,
  EVENT,
  IGNORED,
  LIST,
  LIVE,
  NODE,
  PROPERTY,
  REF,
  SELECT,
  SELECT_INDEX,
  SELECT_REF,
  SOLE,
  TEMPLATE,
  TEXT,
} from './kinds.js';
import type { ChildPart, Instance, Item, KeyedResult, Slot, Template } from './renderer.js';
import type { TemplateResult } from './types.js';

/** The hand-off protocol this module speaks — the renderer's `$V` must equal it. */
const PROTOCOL = 1;

/** What the renderer hands over (`renderer.ts`, `connect`). */
type Handoff = {
  $V: number;
  $G: (result: TemplateResult) => Template;
  $C: new (start: Comment | null, end: Comment | null) => ChildPart;
  $I: new (template: Template, strings: TemplateStringsArray, root: Node, bindings: unknown[]) => Instance;
  $S: new (element: Element) => Slot;
  $Z: object;
  $W: object;
  $M: (template: Template, bindings: unknown[], i: number, kind: number, values: unknown[]) => void;
  $A: (root: Node | null, part: ChildPart, value: unknown, home?: Node | null) => void;
  $U: (instance: Instance, root: Node, adopted: boolean) => void;
  $Q: (template: Template, parent: Node) => Template;
  $O: WeakMap<Node, ChildPart>;
  $T: (value: unknown) => string;
  $E: () => void;
  $Y: (adopt: (result: unknown, container: Node) => boolean) => void;
};
type Registry = { get(name: string): unknown[] | undefined; $H?: Handoff; $t?: Untracked };
type Untracked = <A extends unknown[], R>(fn: (...args: A) => R, ...args: A) => R;
type Applies = { _$apply$: (element: Element, key: object, run: Untracked, adopting?: boolean) => void };
type ValueHandler = (part: object, value: unknown) => boolean | void;

let H: Handoff;
let registry: Registry;
let untracked: Untracked;

/* ── the warning: the only signal a fallback gives, once per cause ───────────────────────────────── */

const warned = new Set<string>();
/**
 * Said once per CAUSE per hydration pass, in every build: a page of 500 containers that disagree for one reason, adopted
 * in one pass, says it once. The record clears at the next microtask, so a later pass that meets the cause again says it.
 */
const warn = (cause: string, message: string) => {
  if (warned.has(cause)) return;
  if (warned.size === 0) queueMicrotask(() => warned.clear());
  warned.add(cause);
  console.warn(`[vera] ${message}`);
};

/* ── the walk's state, per hydration ─────────────────────────────────────────────────────────────── */

/** Phase 1: read only. Every mutation and every commit below is guarded by it. */
let dry = false;
/**
 * Each text value's string, converted ONCE in phase 1 and reused in phase 2, in walk order — so keyed by binding
 * POSITION: one object bound at two text positions is converted twice, as a client render converts it twice.
 */
let texts: string[] = [];
let textAt = 0;
/** Each iterable list value, materialized ONCE (a generator iterates once); phase 2 adopts from the same array. */
let lists = new WeakMap<object, unknown[]>();
/** The first place the two renders disagreed — for the warning. */
let why = '';

/** Why adoption stops: thrown, caught at the container, never escapes. */
const MISMATCH = {};
const mismatch = (reason: () => string): never => {
  why = reason();
  throw MISMATCH;
};

/** A live node as a person would name it. */
const describe = (node: Node | null) =>
  node === null
    ? 'nothing'
    : node.nodeType === 1
      ? `<${(node as Element).localName}>`
      : node.nodeType === 3
        ? `the text ${JSON.stringify((node as Text).data.slice(0, 30))}`
        : node.nodeType === 8
          ? 'a comment'
          : `a ${node.nodeName} node`;

/** A value's text, converted once (phase 1) and replayed (phase 2) — the base's own conversion. */
const textOf = (value: unknown) => {
  if (dry && textAt === texts.length) texts.push(H.$T(value));
  return texts[textAt++];
};
/** An iterable's items, materialized once. */
const itemsOf = (value: Iterable<unknown>) => {
  if (Array.isArray(value)) return value;
  let items = lists.get(value as object);
  if (items === undefined) lists.set(value as object, (items = [...value]));
  return items;
};

const isTemplateResult = (value: object): value is TemplateResult => (value as TemplateResult).strings !== undefined;

/* ── where the walk stands ───────────────────────────────────────────────────────────────────────── */

/**
 * **Which bindings each canonical node carries**, built once per template the first time one is adopted: every
 * binding's node located through its path on the pristine canonical content, as `instantiate` locates it on a clone.
 */
const plans = new WeakMap<Template, Map<Node, number[]>>();
const planOf = (template: Template) => {
  let plan = plans.get(template);
  if (plan === undefined) {
    plans.set(template, (plan = new Map()));
    const kinds = template.$K;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === IGNORED) continue;
      let node = template.$R;
      for (const step of template.$P[i]) {
        node = node.firstChild!;
        for (let hops = step; hops > 0; hops--) node = node.nextSibling!;
      }
      const owned = plan.get(node);
      if (owned === undefined) plan.set(node, [i]);
      else owned.push(i);
    }
  }
  return plan;
};

/**
 * Where the walk stands among a live parent's children: a node, and an offset into it when it is text — server text
 * runs arrive MERGED (`a${x}b` is one text node), so a static and a value share a node until phase 2 splits them.
 * Phase 1 never splits: it moves the offset.
 */
type Cursor = { parent: Node; node: Node | null; offset: number };

/** A comment carries no content: adoption neither matches nor requires one, at a node boundary. */
const passComments = (cursor: Cursor) => {
  while (cursor.offset === 0 && cursor.node !== null && cursor.node.nodeType === 8) cursor.node = cursor.node.nextSibling;
};

/** Puts the cursor on a node boundary (splitting the text it stands in) and returns the node there. Phase 2 only. */
const boundary = (cursor: Cursor) => {
  if (cursor.offset > 0) {
    cursor.node = (cursor.node as Text).splitText(cursor.offset);
    cursor.offset = 0;
  }
  return cursor.node;
};

/** Inserts at the cursor — phase 2 only. */
const insertHere = (cursor: Cursor, node: Node) => {
  if (!dry) cursor.parent.insertBefore(node, boundary(cursor));
};

/** Consumes exactly `text`, a static; anything else is a mismatch. Reads only. */
const expectText = (cursor: Cursor, text: string) => {
  while (text !== '') {
    passComments(cursor);
    const node = cursor.node;
    if (node === null || node.nodeType !== 3) return mismatch(() => `expected the text ${JSON.stringify(text)} and found ${describe(node)}`);
    const data = (node as Text).data;
    const take = Math.min(data.length - cursor.offset, text.length);
    if (data.slice(cursor.offset, cursor.offset + take) !== text.slice(0, take))
      return mismatch(() => `expected the text ${JSON.stringify(text)} and found ${JSON.stringify(data.slice(cursor.offset, cursor.offset + 30))}`);
    text = text.slice(take);
    cursor.offset += take;
    if (cursor.offset === data.length) {
      cursor.node = node.nextSibling;
      cursor.offset = 0;
    }
  }
};

/**
 * Claims a text node holding exactly `text`, a value — split out of the run it arrived in (phase 2), or stepped over
 * (phase 1). `''` has no server counterpart: phase 2 puts in a fresh empty node as its anchor.
 */
const claimText = (cursor: Cursor, text: string): Text => {
  if (text === '') {
    if (dry) return null as unknown as Text;
    const anchor = cursor.parent.ownerDocument!.createTextNode('');
    insertHere(cursor, anchor);
    return anchor;
  }
  passComments(cursor);
  const node = cursor.node;
  if (node === null || node.nodeType !== 3)
    return mismatch(() => `expected a text node holding an interpolated value and found ${describe(node)}`);
  const data = (node as Text).data;
  const at = cursor.offset;
  if (!data.startsWith(text, at))
    return mismatch(
      () =>
        `an interpolated value reads ${JSON.stringify(text)} here and the markup says ${JSON.stringify(data.slice(at, at + text.length))} ` +
        `— a value that stringifies differently on the server (a Date? locale formatting?) disagrees here`
    );
  if (dry) {
    if (at + text.length < data.length) cursor.offset = at + text.length;
    else {
      cursor.node = node.nextSibling;
      cursor.offset = 0;
    }
    return null as unknown as Text;
  }
  const own = boundary(cursor) as Text;
  if (own.data.length > text.length) own.splitText(text.length);
  cursor.node = own.nextSibling;
  return own;
};

/** Claims the element named `name` at the cursor. Reads only. */
const claimElement = (cursor: Cursor, name: string): Element => {
  passComments(cursor);
  const node = cursor.offset > 0 ? null : cursor.node;
  if (node === null || node.nodeType !== 1 || (node as Element).localName !== name)
    return mismatch(() => `expected <${name}> and found ${cursor.offset > 0 ? describe(cursor.node) : describe(node)}`);
  cursor.node = node.nextSibling;
  return node as Element;
};

/** The walk has consumed everything the template describes here: whatever is left is a mismatch. */
const finish = (cursor: Cursor, top = false) => {
  passComments(cursor);
  if (cursor.offset > 0 || cursor.node !== null)
    mismatch(() =>
      !top && cursor.parent.nodeType === 1
        ? `<${(cursor.parent as Element).localName}> contains ${describe(cursor.node)}, which the template does not describe`
        : `${describe(cursor.node)} follows everything the template describes`
    );
};

/* ── the walk ────────────────────────────────────────────────────────────────────────────────────── */

/** One instance being adopted. */
type Adoption = { template: Template; bindings: unknown[]; values: unknown[]; plan: Map<Node, number[]> };

/** Adopts the canonical siblings from `canonical` on, against the live cursor. */
const walk = (canonical: Node | null, cursor: Cursor, into: Adoption) => {
  for (let node = canonical; node !== null; node = node.nextSibling) {
    const type = node.nodeType;
    if (type === 8) continue;
    const owned = into.plan.get(node);
    if (type === 3) {
      if (owned !== undefined) adoptChild(into, owned[0], cursor);
      else expectText(cursor, (node as Text).data);
    } else adoptElement(node as Element, claimElement(cursor, (node as Element).localName), into, owned);
  }
};

/** A form control's state the user may have changed before the script arrived: recorded, never written. */
const FORM_STATE = /^(?:value|checked|selected)$/;
/** A value whose conversion to text runs no user code. */
const primitive = (value: unknown) => value === null || (typeof value !== 'object' && typeof value !== 'function');

/**
 * **One element binding, adopted** (phase 2). The seedable kinds are ATTR and BOOLEAN — ONLY those: their server DOM can
 * be compared to the client value without running user code, and seeding anything else (an EVENT's handler, a
 * setter) would skip work the client must do. Seeded with the CLIENT value, and only on exact equality.
 */
const commitBinding = (into: Adoption, i: number, kind: number, live: Element) => {
  const { template, bindings, values } = into;
  const slot = i * 2;
  const name = template.$N[i];
  bindings[slot] = kind >= EVENT && kind <= ADOPT ? new H.$S(live) : live;
  bindings[slot + 1] = H.$Z;
  const raw = values[i];
  /** Recorded, never written: a selection, a `!name`, a form control's value. */
  if (kind === SELECT || kind === SELECT_INDEX || kind === LIVE || (kind === PROPERTY && FORM_STATE.test(name))) {
    bindings[slot + 1] = raw;
    return;
  }
  /** An element-position value applying itself is told it is adopting — a form control the user typed in stands. */
  if ((kind === REF || kind === SELECT_REF) && raw != null && typeof (raw as Applies)._$apply$ === 'function') {
    bindings[slot + 1] = raw;
    H.$E();
    (raw as Applies)._$apply$(live, bindings[slot] as Slot, untracked, true);
    return;
  }
  if (kind === ATTR) {
    const parts = template.$J[i];
    let text: string | null;
    if (parts === null) text = primitive(raw) ? (raw == null ? null : H.$T(raw)) : undefined!;
    else {
      text = parts[0];
      for (let p = 1; p < parts.length; p++) {
        const v = values[i + p - 1];
        if (!primitive(v)) {
          text = undefined!;
          break;
        }
        text += H.$T(v) + parts[p];
      }
    }
    if (text !== undefined) {
      const server = live.getAttribute(name);
      /** Equal: the client value itself is seeded, and the base's fast path skips the write after its sink checks. */
      if (server === text) bindings[slot + 1] = parts === null ? raw : text;
      /** The client writes nothing and the server wrote something: a non-UNSET seed so the base REMOVES it. */ else if (text === null && server !== null)
        bindings[slot + 1] = server;
    }
  } else if (kind === BOOLEAN && live.hasAttribute(name) === !!raw) bindings[slot + 1] = raw;
  H.$M(template, bindings, i, kind, values);
};

/**
 * An element's own bindings commit when the walk reaches it — before its content, in document pre-order, as a client
 * render commits them (phase 2) — then its content is adopted: as one SOLE value, or as canonical children.
 */
const adoptElement = (canonical: Element, live: Element, into: Adoption, owned: number[] | undefined) => {
  let sole = -1;
  /** A content property (`.innerHTML`, `.textContent`…) writes this element's children itself — see below. */
  let content = false;
  if (owned !== undefined)
    for (const i of owned) {
      const kind = into.template.$K[i];
      if (kind === SOLE) sole = i;
      else {
        if ((kind === PROPERTY || kind === LIVE) && CONTENT_PROPERTY.test(into.template.$N[i])) content = true;
        if (!dry) commitBinding(into, i, kind, live);
      }
    }
  const inner: Cursor = { parent: live, node: live.firstChild, offset: 0 };
  if (sole >= 0) adoptSole(into, sole, live, inner);
  /**
   * Content the template does not describe that is not the template's to describe: a `<textarea>`'s server content is
   * its default value, a custom element's children — when the template writes none — are that component's OWN render,
   * which it adopts itself, and a content property's element holds what that binding writes.
   */ else if (
    canonical.firstChild === null &&
    (content || live.localName === 'textarea' || live.localName.includes('-') || live.hasAttribute('is'))
  )
    return;
  else walk(canonical.firstChild, inner, into);
  finish(inner);
};

/** A value is TEXT at a child position when the base would write it as text. */
const isText = (value: unknown) => value != null && typeof value !== 'object';

/** A part for phase 1, which builds nothing: fields written on it are thrown away. */
const scratch = () => ({}) as ChildPart;

/** A CHILD binding: text split to the value, or a part between two markers put in around what it adopts. */
const adoptChild = (into: Adoption, i: number, cursor: Cursor) => {
  const value = into.values[i];
  if (isText(value)) {
    const node = claimText(cursor, textOf(value));
    if (!dry) {
      into.bindings[i * 2] = node;
      into.bindings[i * 2 + 1] = value;
    }
    return;
  }
  const part = dry ? scratch() : new H.$C(cursor.parent.ownerDocument!.createComment(''), cursor.parent.ownerDocument!.createComment(''));
  if (!dry) insertHere(cursor, part.$s!);
  adoptValue(part, value, cursor);
  if (!dry) {
    if (part.$e!.parentNode === null) insertHere(cursor, part.$e!);
    into.bindings[i * 2] = part;
    into.bindings[i * 2 + 1] = H.$W;
  }
};

/** A SOLE binding: its element's one text node, or a part that owns the element (no markers). */
const adoptSole = (into: Adoption, i: number, live: Element, inner: Cursor) => {
  const value = into.values[i];
  if (isText(value)) {
    const node = claimText(inner, textOf(value));
    if (!dry) {
      into.bindings[i * 2] = node;
      into.bindings[i * 2 + 1] = value;
    }
    return;
  }
  const part = dry ? scratch() : new H.$C(null, null);
  part.$w = live;
  adoptValue(part, value, inner);
  if (!dry) {
    into.bindings[i * 2] = part;
    into.bindings[i * 2 + 1] = H.$W;
  }
};

/** Adopts a template's instance at the cursor (phase 1 returns nothing: it builds nothing). */
const adoptInstance = (result: TemplateResult, cursor: Cursor): Instance => {
  let template = H.$G(result);
  /** Adoption is in place: an extension resolving the template (namespaces) is asked with the LIVE parent. */
  if (template.$X) template = H.$Q(template, cursor.parent);
  const into: Adoption = {
    template,
    bindings: dry ? [] : new Array(template.$K.length * 2 + (template.$X ? 1 : 0)),
    values: result.values,
    plan: planOf(template),
  };
  const root = template.$R;
  if (root.nodeType === 1) {
    const adopted = claimElement(cursor, (root as Element).localName);
    const instance = dry ? (null as unknown as Instance) : new H.$I(template, result.strings, adopted, into.bindings);
    /** Its instance hook meets it before its bindings commit, as a client instance does — told it was adopted. */
    if (!dry && template.$X) H.$U(instance, adopted, true);
    adoptElement(root as Element, adopted, into, into.plan.get(root));
    return instance;
  }
  walk(root.firstChild, cursor, into);
  return dry ? (null as unknown as Instance) : new H.$I(template, result.strings, cursor.parent.ownerDocument!.createDocumentFragment(), into.bindings);
};

/**
 * **A position a `'value'` handler claims** (phase 2, base precedence: templates first, then the handlers). The server
 * never asks handlers — it wrote the value as the renderer's own types, or as its text — so phase 1 matched that; here
 * the span it matched is measured by the same consume, run dry, and if a handler claims the value the span goes and the
 * handler renders client-side. Nothing claims: the cursor and the recorded texts rewind, and the span is adopted.
 */
const claimedByHandler = (part: ChildPart, value: unknown, cursor: Cursor, handlers: ValueHandler[]) => {
  const first = boundary(cursor);
  const mark = textAt;
  dry = true;
  try {
    adoptValue(scratch(), value, cursor);
  } finally {
    dry = false;
  }
  const end = boundary(cursor);
  const span: Node[] = [];
  for (let node = first; node !== null && node !== end; node = node.nextSibling) span.push(node);
  if (part.$e !== null && part.$e.parentNode === null) cursor.parent.insertBefore(part.$e, end);
  for (let i = 0; i < handlers.length; i++)
    if (handlers[i](part, value)) {
      for (const node of span) node.parentNode?.removeChild(node);
      return true;
    }
  cursor.node = first;
  cursor.offset = 0;
  textAt = mark;
  return false;
};

/**
 * Adopts `value` into `part` — the same decisions, in the same order, as the server's serializer made them (templates,
 * lists, appliers, nodes, and every other object as its text), so a position adopts as exactly what was written.
 */
const adoptValue = (part: ChildPart, value: unknown, cursor: Cursor): void => {
  if (value == null) return;
  if (typeof value !== 'object') {
    const node = claimText(cursor, textOf(value));
    if (!dry) {
      part.$l = node;
      part.$v = value;
      part.$o = TEXT;
    }
    return;
  }
  const held = (value as { $h?: TemplateResult }).$h;
  if (held !== undefined || isTemplateResult(value)) {
    const instance = adoptInstance(held ?? (value as TemplateResult), cursor);
    if (!dry) {
      part.$n = instance;
      part.$o = TEMPLATE;
    }
    return;
  }
  if (!dry) {
    const handlers = registry.get('value') as ValueHandler[] | undefined;
    if (handlers !== undefined && claimedByHandler(part, value, cursor, handlers)) return;
  }
  if (Array.isArray(value) || (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined)) {
    const list = itemsOf(value as Iterable<unknown>);
    const items: Item[] = [];
    for (let i = 0; i < list.length; i++) items.push(adoptItem(list[i], cursor));
    if (!dry) {
      part.$i = items;
      part.$o = LIST;
    }
    return;
  }
  const applyChild = (value as { _$child$?: (part: ChildPart, previous: unknown, adopting: boolean) => unknown })._$child$;
  if (applyChild !== undefined) {
    /** What the server wrote for an applier cannot be delimited except as a SOLE element's whole content. */
    if (part.$w != null && cursor.node !== null) {
      if (!dry) part.$o = NODE;
      cursor.node = null;
      cursor.offset = 0;
    }
    if (dry) return;
    if (part.$e !== null && part.$e.parentNode === null) insertHere(cursor, part.$e);
    part.$a = applyChild;
    part.$R = cursor.parent;
    if ((applyChild as { _$detach$?: unknown })._$detach$ !== undefined) H.$E();
    part.$z = applyChild.call(value, part, undefined, true);
    return;
  }
  /** A node the server could not have rendered: put in where it belongs, and adoption goes on around it. */
  if ((value as Node).nodeType !== undefined) {
    insertHere(cursor, value as Node);
    if (!dry) {
      part.$v = value;
      part.$o = NODE;
    }
    return;
  }
  /** Every other object, as the server wrote it: its text, converted once. */
  const node = claimText(cursor, textOf(value));
  if (!dry) {
    part.$l = node;
    part.$v = value;
    part.$o = TEXT;
  }
};

/** The root the template at this position will build — after an extension resolves it, as the base asks. */
const rootOf = (result: TemplateResult, cursor: Cursor) => {
  const template = H.$G(result);
  return (template.$X ? H.$Q(template, cursor.parent) : template).$R;
};

/** Adopts one list item — the same shapes the base builds. */
const adoptItem = (value: unknown, cursor: Cursor): Item => {
  if (value !== null && typeof value === 'object' && isTemplateResult(value) && rootOf(value, cursor).nodeType === 1) {
    const instance = adoptInstance(value, cursor);
    if (!dry) instance.$k = (value as KeyedResult).key;
    return instance;
  }
  const part = dry ? scratch() : new H.$C(cursor.parent.ownerDocument!.createComment(''), cursor.parent.ownerDocument!.createComment(''));
  if (!dry) insertHere(cursor, part.$s!);
  adoptValue(part, value, cursor);
  if (!dry) {
    if (part.$e!.parentNode === null) insertHere(cursor, part.$e!);
    part.$k = (value as TemplateResult | null)?.key;
  }
  return part;
};

/* ── the container ───────────────────────────────────────────────────────────────────────────────── */

/** A container's own SSR stylesheets lead its content and are not part of any template. */
const isSheet = (node: Node | null) => node !== null && node.nodeType === 1 && (node as Element).hasAttribute('data-vm-sheet');

/** Clears a container after a mismatch — every child but its SSR stylesheets. */
const clearPreservingStyles = (container: Node) => {
  for (let node = container.firstChild; node !== null; ) {
    const next: ChildNode | null = node.nextSibling;
    if (!isSheet(node)) container.removeChild(node);
    node = next;
  }
};

/**
 * **A container's first render, with children already there** — the renderer asks (`$Y`). Adopts them and answers
 * true, or answers false having cleared them, and the renderer renders fresh.
 */
const adopt = (result: unknown, container: Node): boolean => {
  if (result === null || typeof result !== 'object' || !isTemplateResult(result as object)) return false;
  let first: Node | null = container.firstChild;
  while (isSheet(first)) first = first!.nextSibling;
  texts = [];
  textAt = 0;
  lists = new WeakMap();
  /** PHASE 1 — read only. A mismatch here has run nothing of the client's against the server's nodes. */
  dry = true;
  try {
    const cursor: Cursor = { parent: container, node: first, offset: 0 };
    adoptValue(scratch(), result, cursor);
    finish(cursor, true);
  } catch (error) {
    if (error !== MISMATCH) throw error;
    dry = false;
    /** The whole story in development; production says the cause and the fix in one line — it warns in every build. */
    warn(
      why,
      __DEV__
        ? `hydration fell back to a client render: ${why}. This container's server markup was discarded and rebuilt (its ` +
            `SSR <style> is kept), so the page is correct but the server's work on it was wasted. Its children are taken ` +
            `as server output of this template — if they were a client-side placeholder instead, empty the container ` +
            `first (\`container.replaceChildren()\`) or render the placeholder with vera. Otherwise the two renders have ` +
            `to agree exactly: check for markup the template does not describe, or state settled after the server ` +
            `render. Other containers on the page hydrate independently and are unaffected.`
        : `hydration fell back to a client render: ${why} (a placeholder? \`container.replaceChildren()\` first).`
    );
    clearPreservingStyles(container);
    return false;
  } finally {
    dry = false;
  }
  /** PHASE 2 — for real, inside the renderer's own render bracket (a stand-in part), in client order. */
  textAt = 0;
  const doc = container.ownerDocument ?? (container as Document);
  const start = doc.createComment('');
  container.insertBefore(start, first);
  const end = container.appendChild(doc.createComment(''));
  const part = new H.$C(start, end);
  const walkInto = {
    $p: () => {
      const cursor: Cursor = { parent: container, node: first, offset: 0 };
      adoptValue(part, result, cursor);
      finish(cursor, true);
    },
  } as unknown as ChildPart;
  try {
    H.$A(container, walkInto, undefined, container);
  } catch (error) {
    /** Phase 2 makes phase 1's decisions again, by the same code: disagreeing is a bug, never a page's fault. */
    if (error === MISMATCH) throw new Error(`[vera] hydration: the commit pass disagreed with the check pass (${why}) — a bug in hydration; please report it.`);
    throw error;
  }
  H.$O.set(container, part);
  return true;
};

/** `wire([renderer, hydration])` — after the renderer, whose `connect` sets the hand-off. */
export const hydration = (given: Registry) => {
  const handoff = given.$H;
  if (handoff === undefined) {
    console.warn('[vera] hydration: no renderer to hydrate — wire it after the renderer, `wire([renderer, hydration])`.');
    return;
  }
  /**
   * **Another release's renderer: the page still works, rendered fresh** (Brian, 2026-10-02). `$V` and `$Y` are the
   * hand-off's FROZEN pair — the same in every protocol — so even a mismatched renderer can be asked to clear a
   * container's server markup before its first render; nothing else of the hand-off is read. Without that, the base
   * renderer keeps what a container holds and the server's markup would stand beside the client's.
   */
  if (handoff.$V !== PROTOCOL) {
    warn(
      'protocol',
      __DEV__
        ? `hydration: this @verajs/renderer speaks hand-off protocol ${handoff.$V} and this hydration ${PROTOCOL} — they ` +
            `are from different releases. Pages render fresh (correct, without adopting the server's markup); update both ` +
            `together.`
        : `hydration: this @verajs/renderer speaks hand-off protocol ${handoff.$V} and this hydration ${PROTOCOL} — update both together.`
    );
    handoff.$Y((_result, container) => {
      clearPreservingStyles(container);
      return false;
    });
    return;
  }
  H = handoff;
  registry = given;
  untracked = given.$t ?? (((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args)) as Untracked);
  handoff.$Y(adopt);
};
