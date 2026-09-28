/**
 * @verajs/renderer/hydrate — markerless adoption of server-rendered DOM.
 *
 * Importing this module (once, anywhere) arms hydration: the renderer's first render into a
 * container that already has children adopts them as server output of the same template. Without
 * this import the renderer never carries adoption code — non-SSR apps pay nothing.
 *
 * The server serializer (@verajs/ssr) emits the SAME static strings the renderer parses into
 * its canonical template, so server DOM and canonical fragment diverge only at value slots — and
 * at adoption time the values are known. Adoption walks both trees in lockstep: statics must
 * match byte-for-byte (else bail), and at each slot the live text is split so the renderer's own
 * anchors (primed texts, marker comments) are installed into the adopted DOM. Server HTML stays
 * free of framework comments; the client repairs its anchors in. Any mismatch clears the
 * container (preserving `<style data-vm-sheet="styles">` tags) and the caller renders fresh — correctness
 * never depends on the server markup.
 *
 * This entry re-exports the public API, so a CDN importmap can point `@verajs/renderer` at the
 * hydrate bundle and nothing else changes.
 */
import {
  getTemplate,
  Instance,
  TextPart,
  ChildPart,
  AttrPart,
  IGNORED_PART,
  IGNORED,
  TEMPLATE,
  LIST,
  NODE,
  comment,
  doc,
  toText,
  isTemplateResult,
  instanceWalker,
  rootParts,
  slotSeam,
  sayShape,
  renderInto as baseRender,
  renderer as baseRenderer,
  declareRemovalWork,
} from './renderer.js';
import type { Template, Item, KeyedResult } from './renderer.js';

/** Hydration adopts IN PLACE, so a position's parent is always live — no scope needed. */
const at = (template: Template, parent: Node): Template => template._$at$?.(parent) ?? template;
import type { InstanceHook, Part, TemplateResult } from './types.js';

export { hold } from './renderer.js';
export type { TemplateResult } from './types.js';

/** Internal bail signal — never escapes `tryAdopt`. */
const MISMATCH = {};

/**
 * Why the last adoption gave up, for the development warning below. Written at every `throw
 * MISMATCH` inside an `if (__DEV__)`, so a production bundle carries neither the strings nor the
 * assignments — the branches fold away with `__DEV__` and the helper goes with them.
 */
let why = '';

/** A live node as a person would name it, for that message. */
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

/**
 * Where the walk stands. Over a parent's children as the DOM has them — or, for the light children of
 * a nested light host, over the SEQUENCE the server stated (`_$light$`), which are not siblings: they
 * sit in that host's slots. `after` is that sequence, node to next, so a step stays O(1).
 */
type Cursor = { parent: Node; node: Node | null; offset: number; after?: Map<Node, Node | null> };

/** The node after `node` in the cursor's walk. */
const next = (cursor: Cursor, node: Node): Node | null =>
  cursor.after !== undefined ? (cursor.after.get(node) ?? null) : node.nextSibling;

/** Inserts at the cursor — before `ref` in ITS parent, which in a sequence is not always `cursor.parent`. */
const insertAt = (cursor: Cursor, node: Node, ref: Node | null) => (ref?.parentNode ?? cursor.parent).insertBefore(node, ref);

/** Splits mid-text cursors onto a node boundary and returns the node now at the cursor. */
const cursorSplit = (cursor: Cursor): Node | null => {
  if (cursor.offset > 0) {
    const head = cursor.node as Text;
    cursor.node = head.splitText(cursor.offset);
    if (cursor.after !== undefined) {
      cursor.after.set(cursor.node, cursor.after.get(head) ?? null);
      cursor.after.set(head, cursor.node);
    }
    cursor.offset = 0;
  }
  return cursor.node;
};

/**
 * **A comment carries no rendered content, so hydration neither matches nor requires one.**
 *
 * `instanceWalker` is `ELEMENT | TEXT`, and the part indices in `_parts` are numbered by that same
 * walker — so a comment in a template's statics is structurally invisible to this walk, and cannot
 * be made visible without renumbering every part the client renderer relies on. The live DOM,
 * however, still has it: `html`<p>a<!-- note -->b</p>`` adopts as text/comment/text where the walk
 * wanted one run of text, and `<p>lead<!-- tail --></p>` leaves a child the walk never asked for.
 * Both read as a disagreement, so **every template containing an HTML comment lost hydration** —
 * the server's markup discarded and re-rendered, for markup the client had itself produced. Nothing
 * failed, because the page is correct either way; that is what the fallback is for, and why this
 * went unnoticed. What it cost was the first paint the server render was paid for.
 *
 * Stepping over them is sound rather than merely convenient: the invisibility is symmetric, so a
 * comment can differ in either direction and neither direction can change what a reader sees. This
 * is only safe because hydration is markerless — the adopted markup carries no framework comments,
 * so there is nothing here whose position is load-bearing.
 *
 * Not folded into `cursorSplit`, which also answers "where do I insert?" — moving an insertion point
 * past a comment would put a slot's content on the wrong side of it.
 */
const passComments = (cursor: Cursor) => {
  while (cursor.offset === 0 && cursor.node !== null && cursor.node.nodeType === 8) {
    cursor.node = next(cursor, cursor.node);
  }
};

/** Consumes exactly `text` from the live cursor; anything else is a mismatch. */
const expectText = (cursor: Cursor, text: string) => {
  let need = text;
  while (need.length > 0) {
    passComments(cursor);
    const node = cursor.node;
    if (node === null || node.nodeType !== 3) {
      if (__DEV__) why = `expected the text ${JSON.stringify(text)} and found ${describe(node)}`;
      throw MISMATCH;
    }
    const data = (node as Text).data;
    const available = data.length - cursor.offset;
    if (available === 0) {
      cursor.node = next(cursor, node);
      cursor.offset = 0;
      continue;
    }
    const take = available < need.length ? available : need.length;
    if (data.slice(cursor.offset, cursor.offset + take) !== need.slice(0, take)) {
      if (__DEV__)
        why = `expected the text ${JSON.stringify(need.slice(0, take))} and found ${JSON.stringify(data.slice(cursor.offset, cursor.offset + take))}`;
      throw MISMATCH;
    }
    need = need.slice(take);
    cursor.offset += take;
    if (cursor.offset === data.length) {
      cursor.node = next(cursor, node);
      cursor.offset = 0;
    }
  }
};

/** Claims the value's rendered text as a standalone node (splitting as needed) and returns it. */
const claimValueText = (cursor: Cursor, text: string): Text => {
  const at = cursorSplit(cursor);
  if (text === '') {
    /** Nothing was rendered — install a fresh primed anchor at the cursor. */
    const primed = doc.createTextNode('');
    insertAt(cursor, primed, at);
    return primed;
  }
  if (at === null || at.nodeType !== 3) {
    if (__DEV__) why = `expected a text node holding an interpolated value and found ${describe(at)}`;
    throw MISMATCH;
  }
  const node = at as Text;
  if (node.data.length > text.length) node.splitText(text.length);
  if (node.data !== text) {
    if (__DEV__) why = `an interpolated value reads ${JSON.stringify(text)} here and the markup says ${JSON.stringify(node.data)}`;
    throw MISMATCH;
  }
  cursor.node = next(cursor, node);
  cursor.offset = 0;
  return node;
};

/** Per-template canonical node list (ELEMENT | TEXT order), cached — adoption of a 100-row list
 * hits the same template 100 times. The order is `instanceWalker`'s, which is also the order the
 * template's construction walk numbers parts by — see `instanceWalker` in `renderer.ts`. */
const canonicalCache = new WeakMap<Template, Node[]>();

const canonicalNodes = (template: Template): Node[] => {
  let nodes = canonicalCache.get(template);
  if (nodes === undefined) {
    nodes = [];
    instanceWalker.currentNode = template._element.content;
    let node: Node | null;
    while ((node = instanceWalker.nextNode()) !== null) nodes.push(node);
    canonicalCache.set(template, nodes);
  }
  return nodes;
};

/** Walk state shared down the adoption recursion of one instance. */
type AdoptState = {
  _template: Template;
  _values: unknown[];
  _valueIndex: number;
  _partIndex: number;
  _nodeIndex: number;
  _out: Part[];
  /** Taken-over slot states — parked at teardown, never committed (kept OUT of `_parts`). */
  _slotStates?: import('./types.js').SlotSeamState[];
};

/** The light host being hydrated — every `<slot>` in the render projects it, set once in
 *  `tryAdopt` (the render container), null when no slot handler is wired. */
let _adoptHost: Element | null = null;
/** Slot names whose server content this adoption has placed — the first slot of a name takes it. */
let _takenNames = new Set<string>();
/**
 * Every slot binding this adoption attempt created. If the attempt BAILS, each is parked — which
 * returns the user's nodes to holding and unregisters the binding. Without it the abandoned
 * bindings stayed registered, so the clean render's own bindings ranked as later duplicates and
 * showed fallback while the user's content sat in the discarded tree: a hydration mismatch
 * silently DESTROYED slotted content, breaking this entry's promise that correctness never
 * depends on the server markup (measured).
 */
let _adoptedSlots: { _$park$: () => void }[] = [];

/** How many values a template part consumes — for skipping the unrendered parts inside an
 *  assigned slot's fallback subtree. */
const partValueCount = (part: { _type: number; _statics?: string[] }): number =>
  part._type === 1 ? (part._statics!.length - 1) : 1;

/**
 * Account for (skip) the parts inside a canonical subtree whose DOM the server did NOT render —
 * an assigned slot's fallback. Advances the walk indices and value cursor without touching DOM,
 * so the parts AFTER the slot still line up. Walks the node's CHILDREN (the fallback), in the
 * same ELEMENT|TEXT order the walker numbers by.
 */
const accountSubtree = (node: Node, state: AdoptState) => {
  const parts = state._template._parts;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType !== 1 && child.nodeType !== 3) continue;
    state._nodeIndex++;
    while (state._partIndex < parts.length && parts[state._partIndex]._index === state._nodeIndex) {
      state._valueIndex += partValueCount(parts[state._partIndex]);
      state._partIndex++;
    }
    if (child.nodeType === 1) accountSubtree(child, state);
  }
};

/** Adopted slots park at teardown through the instance's hook fields, as a mounted one does: only `$q`
 *  is ever called, with the adopted slots' states as what was kept. */
const PARK_ADOPTED: InstanceHook = {
  $c: () => undefined,
  $m: () => undefined,
  $q: (kept) => (kept as { _$park$?: () => void }[]).forEach((slot) => slot._$park$?.()),
};

/**
 * Reconcile a canonical `<slot>` against server-distributed DOM. Named slots take the consecutive
 * cursor nodes carrying `slot="name"`; the default slot takes the host-count nodes
 * (`data-vm-slotted="N"`). Found nodes are wrapped in place as a live binding (identity/state preserved);
 * an unassigned slot adopts its server-rendered fallback children normally. The slots module's
 * `_$adopt$` (off the registered seam) does the registration.
 */
const adoptSlotElement = (canonicalSlot: Element, cursor: Cursor, state: AdoptState) => {
  const seamAdopt = (slotSeam() as unknown as {
    _$adopt$: (
      h: Element, n: string, a: Node[] | null, f: Node[], p: Node, b: Node | null, s?: Element
    ) => Part;
  })._$adopt$;
  /**
   * **The slot's OWN bindings, committed onto a per-instance element.** The server unwrapped the
   * `<slot>`, so there is no live element to adopt against — but the template's parts for it are
   * still in the parts array, and skipping them left every value after the slot reading the wrong
   * one. In practice that meant adoption failed and the whole container fell back to a client
   * render: any component whose slot carried `@slotchange`, `&ref` or `name=${…}` could not be
   * server-rendered at all.
   *
   * A shallow clone is the target rather than the canonical node, which is shared by every
   * instance of the template — committing onto that would attach one instance's listeners to all
   * of them. The clone then IS this instance's slot element, exactly as the clone in a client
   * render is, so `@slotchange` and `&ref` mean the same thing in both.
   */
  const ghost = canonicalSlot.cloneNode(false) as Element;
  const parts = state._template._parts;
  while (state._partIndex < parts.length && parts[state._partIndex]._index === state._nodeIndex) {
    const templatePart = parts[state._partIndex++];
    const attrPart = new AttrPart(ghost, templatePart._name!, templatePart._statics!, templatePart._present);
    state._out.push(attrPart);
    state._valueIndex = attrPart._commit(state._values, state._valueIndex, true);
    drainIgnored(state);
  }
  /** After the commit, so `<slot name=${…}>` is read as the name it actually has. */
  const name = ghost.getAttribute('name') ?? '';
  passComments(cursor);
  const parent = cursor.parent;

  /**
   * What the server put at this slot: its name's share of the host's light list (stated by the
   * server's marks, read at capture), at the FIRST slot of that name — the one the server filled.
   * Each node must stand exactly where the walk does; anything else is a disagreement like any other.
   */
  const assigned = _takenNames.has(name) ? [] : (slotSeam()?._$assigned$?.(_adoptHost!, name) ?? []);
  if (assigned.length > 0) _takenNames.add(name);
  for (const node of assigned) {
    if (cursorSplit(cursor) !== node) {
      if (__DEV__) why = `the <slot${name ? ` name="${name}"` : ''}> content is not where the server put it`;
      throw MISMATCH;
    }
    cursor.node = next(cursor, node);
  }

  if (assigned.length > 0) {
    /** Assigned: the fallback was NOT rendered, so its parts are accounted (skipped) and its
     *  nodes cloned from the canonical template for live re-fallback later. */
    const before = cursor.node;
    const fallback: Node[] = [];
    for (let c = canonicalSlot.firstChild; c !== null; c = c.nextSibling)
      if (c.nodeType === 1 || c.nodeType === 3) fallback.push(c.cloneNode(true));
    accountSubtree(canonicalSlot, state);
    const seam = seamAdopt(_adoptHost!, name, assigned, fallback, parent, before, ghost);
    _adoptedSlots.push(seam as unknown as { _$park$: () => void });
    (state._slotStates ??= []).push(seam as never);
    /** An adopted seam is removal work exactly as a mounted one is — without this, a page whose
     *  only seams were adopted never ran `_teardown`, and branch-away destroyed the user's
     *  server-adopted content instead of parking it. See `declareRemovalWork`. */
    declareRemovalWork();
  } else {
    /** Unassigned: the server rendered this slot's fallback children — adopt them in lockstep
     *  (they ARE the canonical children), then bind them as the shown fallback. */
    const fallbackStart = cursor.node;
    for (let c = canonicalSlot.firstChild; c !== null; c = c.nextSibling)
      if (c.nodeType === 1 || c.nodeType === 3) adoptNode(c, cursor, state);
    /** The fallback nodes now sit between fallbackStart and cursor.node. */
    const fallback: Node[] = [];
    for (let n = fallbackStart; n !== null && n !== cursor.node; n = next(cursor, n)) fallback.push(n);
    const seam = seamAdopt(_adoptHost!, name, null, fallback, parent, cursor.node, ghost);
    _adoptedSlots.push(seam as unknown as { _$park$: () => void });
    (state._slotStates ??= []).push(seam as never);
    /** Same as the assigned branch: an unassigned seam still unregisters and re-routes at park. */
    declareRemovalWork();
  }
};

/** Adopts one canonical node (and, for elements, its subtree) against the live cursor. */
const adoptNode = (canonical: Node, cursor: Cursor, state: AdoptState) => {
  state._nodeIndex++;
  const parts = state._template._parts;

  if (canonical.nodeType === 3) {
    /** A primed empty text is a child slot; any other text is a static to match. */
    let isSlot = false;
    while (state._partIndex < parts.length && parts[state._partIndex]._index === state._nodeIndex) {
      isSlot = true;
      state._partIndex++;
      adoptSlot(cursor, state._values[state._valueIndex++], state._out);
      drainIgnored(state);
    }
    if (!isSlot) expectText(cursor, (canonical as Text).data);
    return;
  }

  /** A `<slot>` in the canonical template maps to distributed content (or fallback) in the server
   *  DOM — reconciled specially — but only when a slot strategy is wired. */
  if ((canonical as Element).localName === 'slot' && slotSeam() !== undefined) {
    adoptSlotElement(canonical as Element, cursor, state);
    return;
  }

  /** Element: same tag, commit its attribute parts live, then descend children in lockstep. */
  passComments(cursor);
  const live = cursorSplit(cursor);
  if (live === null || live.nodeType !== 1) {
    if (__DEV__) why = `expected <${(canonical as Element).localName}> and found ${describe(live)}`;
    throw MISMATCH;
  }
  if ((live as Element).localName !== (canonical as Element).localName) {
    if (__DEV__)
      why = `expected <${(canonical as Element).localName}> and found <${(live as Element).localName}>`;
    throw MISMATCH;
  }

  while (state._partIndex < parts.length && parts[state._partIndex]._index === state._nodeIndex) {
    const templatePart = parts[state._partIndex++];
    const attrPart = new AttrPart(live as Element, templatePart._name!, templatePart._statics!, templatePart._present);
    state._out.push(attrPart);
    /** Attributes re-set (idempotent), listeners attached, refs fired — the server could only
     * mirror form state; the client wires behavior. The `true` marks this as adoption, which is
     * what keeps a form value the reader may already have changed (see `AttrPart._commit`). */
    state._valueIndex = attrPart._commit(state._values, state._valueIndex, true);
    drainIgnored(state);
  }

  /**
   * **A nested LIGHT host's children are walked as its light tree, not as its DOM.** The server has
   * already distributed them into that host's slots, so its DOM children are its own render; what
   * this template placed there is the light list the server stated (`_$light$`), in light order.
   */
  const light = (live as Element).hasAttribute?.('data-vm-light') ? slotSeam()?._$light$?.(live as Element) : undefined;
  let inner: Cursor;
  if (light != null) {
    const after = new Map<Node, Node | null>();
    for (let i = 0; i < light.length; i++) after.set(light[i], light[i + 1] ?? null);
    inner = { parent: live, node: light[0] ?? null, offset: 0, after };
  } else inner = { parent: live, node: live.firstChild, offset: 0 };
  let child = canonical.firstChild;
  while (child !== null) {
    if (child.nodeType === 1 || child.nodeType === 3) adoptNode(child, inner, state);
    child = child.nextSibling;
  }
  /**
   * The one place the server writes content the template does not describe: a `<textarea>`'s value
   * **is** its content, so `.value=${…}` has nowhere else to go and `@verajs/ssr` puts it there —
   * which is what shows the value to a reader with no JavaScript. The template's own statics say
   * the element is empty, so this read as foreign markup and abandoned adoption for the whole page,
   * silently: the container was cleared and re-rendered, the markup looked right, and everything
   * server rendering is for was gone.
   *
   * **Kept, not cleared.** It is the element's `defaultValue`, and it is also the only thing
   * holding the value: adoption deliberately does not write `.value` (see `AttrPart._commit`), so
   * clearing the content would empty the field it just adopted. A person who typed here before the
   * bundle landed has made the field dirty, and a dirty textarea ignores its content anyway — so
   * their text survives either way, and the server's stays as what `form.reset()` restores.
   *
   * **One of four respects in which a hydrated DOM is not byte-identical to a client-rendered one**,
   * and all four have the same cause: `@verajs/ssr` mirrors `.value`, `.checked` and `.selected` on
   * form elements into markup, because markup is the only way form state reaches the client at all.
   * The client sets those as properties and writes nothing, exactly as a browser does — so the
   * server's copy stays behind after adoption:
   *
   * | binding | hydrated | client-rendered |
   * | --- | --- | --- |
   * | `<input .value=${x}>` | `<input value="x">` | `<input>` |
   * | `<input .checked=${true}>` | `<input checked="">` | `<input>` |
   * | `<option .selected=${true}>` | `<option selected="">` | `<option>` |
   * | `<textarea .value=${x}>` | `<textarea>x</textarea>` | `<textarea></textarea>` |
   *
   * They are defaults rather than state — what `form.reset()` restores — so the *rendered* result is
   * the same and only a reset tells them apart. `tests/hydrate-parity.test.mjs` records the list,
   * because "the one respect" was written here when there was one, and a reader comparing a hydrated
   * DOM against a client-rendered one needs to know which differences are meant.
   */
  if (
    inner.node !== null &&
    inner.node.nodeType === 3 &&
    inner.node.nextSibling === null &&
    canonical.firstChild === null &&
    (live as Element).localName === 'textarea'
  ) {
    inner.node = null;
  }

  /** Leftover live children the template does not account for = not our markup. */
  passComments(inner);
  if (inner.node !== null && !(inner.node.nodeType === 3 && (inner.node as Text).data === '' && inner.node.nextSibling === null)) {
    if (__DEV__)
      why = `<${(live as Element).localName}> contains ${describe(inner.node)}, which the template does not describe`;
    throw MISMATCH;
  }

  cursor.node = next(cursor, live);
  cursor.offset = 0;
};

const drainIgnored = (state: AdoptState) => {
  const parts = state._template._parts;
  while (state._partIndex < parts.length && parts[state._partIndex]._type === IGNORED) {
    state._out.push(IGNORED_PART);
    state._valueIndex++;
    state._partIndex++;
  }
};

/** Adopts one child slot's rendered content, producing the part that will own it. */
const adoptSlot = (cursor: Cursor, rawValue: unknown, out: Part[]) => {
  const heldResult = (rawValue as { $h?: TemplateResult } | null)?.$h;
  const value = heldResult !== undefined ? heldResult : rawValue;

  /**
   * Anything the client commits as text claims text here — which is every value that is not a
   * template, a node, or an iterable. `String(value)` is what `_set` falls through to, so a `Date`,
   * an object with a `toString`, a `Promise` or a plain object all produce text on the client, and
   * `@verajs/ssr` produces the same text on the server.
   *
   * The object cases used to be a deliberate mismatch, because the server emitted nothing for them
   * and the two could not be reconciled. Once the server started matching the client, the mismatch
   * was the only thing left disagreeing.
   */
  const isText =
    value != null &&
    (typeof value !== 'object' ||
      (!isTemplateResult(value) &&
        (value as Node).nodeType === undefined &&
        typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function'));

  if (isText) {
    /** Claim its text and bind the fast TextPart, committed state included. */
    const textPart = new TextPart(claimValueText(cursor, toText(value)));
    textPart._value = value;
    out.push(textPart);
    return;
  }

  /** Structured content gets a markered ChildPart wrapped around whatever it rendered. */
  const start = comment();
  insertAt(cursor, start, cursorSplit(cursor));
  const part = new ChildPart(start, null);

  if (value == null) {
    /** Nothing rendered server-side; the part starts EMPTY. */
  } else if (isTemplateResult(value)) {
    part._instance = adoptInstance(at(getTemplate(value), cursor.parent), value.values, cursor);
    part._shape = value.strings;
    part._mode = TEMPLATE;
  } else if ((value as Node).nodeType !== undefined) {
    /**
     * A DOM node is client-only by construction — the server has no document to have built one, so
     * it rendered nothing here and there is nothing to adopt. Inserting it at the cursor (which has
     * not moved, because no server node was claimed) puts it exactly where the end marker is about
     * to go, and leaves the part in the same state a client-side commit would.
     */
    insertAt(cursor, value as Node, cursorSplit(cursor));
    part._value = value;
    part._mode = NODE;
  } else {
    /** Everything left is an array or another iterable — text and nodes were handled above. */
    const list: unknown[] = Array.isArray(value) ? value : [...(value as Iterable<unknown>)];
    const items: Item[] = [];
    for (const entry of list) items.push(adoptItem(cursor, entry));
    part._items = items;
    /**
     * The same predicate `_commitList` uses — the presence of a strategy, not of a `key`. Two
     * spellings of "is this list keyed" would drift, and disagreeing about one list destroys it:
     * a mode change is what tells the renderer to throw the adopted DOM away and start over.
     */
    part._keyedList = list.length > 0 && (list[0] as KeyedResult)?.$r !== undefined;
    part._mode = LIST;
  }

  const end = comment();
  insertAt(cursor, end, cursorSplit(cursor));
  part._end = end;
  out.push(part);
};

/** Adopts one list item — element mode for single-root templates, markered otherwise. */
const adoptItem = (cursor: Cursor, value: unknown): Item => {
  if (value !== null && typeof value === 'object' && (value as TemplateResult).strings !== undefined) {
    const result = value as TemplateResult;
    const template = at(getTemplate(result), cursor.parent);
    const content = template._element.content;
    const root = content.firstChild;
    if (root !== null && root.nodeType === 1 && root.nextSibling === null) {
      const liveRoot = cursorSplit(cursor);
      const instance = adoptInstance(template, result.values, cursor);
      return {
        $k: result.key,
        _element: liveRoot as Element,
        _instance: instance,
        _shape: result.strings,
        _part: null,
      };
    }
    const start = comment();
    insertAt(cursor, start, cursorSplit(cursor));
    const instance = adoptInstance(template, result.values, cursor);
    const end = comment();
    insertAt(cursor, end, cursorSplit(cursor));
    const part = new ChildPart(start, end);
    part._instance = instance;
    part._shape = result.strings;
    part._mode = TEMPLATE;
    return { $k: result.key, _element: null, _instance: null, _shape: null, _part: part };
  }
  /** Non-template item: markered part adopting its content like a nested slot. */
  const out: Part[] = [];
  adoptSlot(cursor, value, out);
  return { $k: (value as TemplateResult)?.key, _element: null, _instance: null, _shape: null, _part: out[0] as ChildPart };
};

/** Builds an Instance whose parts are bound to LIVE nodes, consuming them from the cursor. */
const adoptInstance = (template: Template, values: unknown[], cursor: Cursor): Instance => {
  if (__DEV__) sayShape(template);
  const instance: Instance = Object.create(Instance.prototype);
  instance._parts = [];
  instance._fragment = doc.createDocumentFragment();
  const state: AdoptState = {
    _template: template,
    _values: values,
    _valueIndex: 0,
    _partIndex: 0,
    _nodeIndex: -1,
    _out: instance._parts,
  };
  drainIgnored(state);
  /** Cached walk exists for repeated templates; the recursion itself visits in the same
   * ELEMENT | TEXT document order the instance walker uses. */
  canonicalNodes(template);
  let child = template._element.content.firstChild;
  while (child !== null) {
    if (child.nodeType === 1 || child.nodeType === 3) adoptNode(child, cursor, state);
    child = child.nextSibling;
  }
  drainIgnored(state);
  if (state._partIndex !== template._parts.length) {
    if (__DEV__) why = 'the markup ran out before the template did';
    throw MISMATCH;
  }
  /** Adopted slots park at teardown exactly as mounted ones do — through `$q`. */
  const adopted = state._slotStates;
  if (adopted !== undefined) {
    instance.$h = PARK_ADOPTED;
    instance.$k = adopted;
  }
  return instance;
};

/**
 * Attempts to adopt a container's existing (server-rendered) children for `result`. Returns the
 * root part on success; null on any mismatch, leaving the caller to clean-render. Leading
 * `<style data-vm-sheet="styles">` tags (the SSR style serialization) are skipped and preserved.
 */
const tryAdopt = (result: TemplateResult, container: Node): ChildPart | null => {
  /** Only the SSR-serialized style tags are skipped — templates may legitimately start with
   * whitespace or even their own static `<style>`, which must align against the canonical walk. */
  let first = container.firstChild;
  while (first !== null && first.nodeType === 1 && (first as Element).hasAttribute('data-vm-sheet')) {
    first = first.nextSibling;
  }
  if (__DEV__) why = '';
  const start = comment();
  container.insertBefore(start, first);
  /** The container is the light host every slot in this render projects. */
  _adoptHost = container.nodeType === 1 ? (container as Element) : null;
  _takenNames = new Set();
  _adoptedSlots = [];
  try {
    const cursor: Cursor = { parent: container, node: start.nextSibling, offset: 0 };
    const instance = adoptInstance(at(getTemplate(result), container), result.values, cursor);
    passComments(cursor);
    if (cursor.node !== null) {
      if (__DEV__) why = `${describe(cursor.node)} follows everything the template describes`;
      throw MISMATCH;
    }
    const part = new ChildPart(start, null);
    part._instance = instance;
    part._shape = result.strings;
    part._mode = TEMPLATE;
    return part;
  } catch (error) {
    if (error !== MISMATCH) throw error;
    /**
     * Undo every slot this attempt adopted BEFORE the container is cleared: parking returns the
     * user's nodes to holding and unregisters the binding, so the clean render that follows
     * redistributes them instead of ranking behind an abandoned binding and showing fallback.
     */
    for (const seam of _adoptedSlots) seam._$park$();
    _adoptedSlots = [];
    start.remove();
    return null;
  }
};


/** Mismatch cleanup lives here, not in the slim renderer: clear all but the SSR style tags. */
const clearPreservingStyles = (container: Node) => {
  let node = container.firstChild;
  while (node !== null) {
    /** `nextSibling` already yields `ChildNode | null`; annotating it `Node` widened it and broke
     * the assignment back into `node`, which `firstChild` typed as `ChildNode | null`. */
    const next: ChildNode | null = node.nextSibling;
    if (!(node.nodeType === 1 && (node as Element).hasAttribute('data-vm-sheet'))) container.removeChild(node);
    node = next;
  }
};

/**
 * **A component the server did not render is not hydrated.** With slots wired, the server states the
 * light tree on EVERY component host it renders (`data-vm-light`, empty when there is none), so a
 * custom element without the statement was not server output as a component: it was created on the
 * client — by a template (`<x-card>` in a client render), by the user (`innerHTML`), or inside
 * `serializeTemplate` markup, which renders no components. Its children are its LIGHT children, and
 * trying to adopt them as its render failed, fell back, and discarded them with the stale markup —
 * measured: every such component under an app-wide hydrate renderer lost all its content. It gets
 * the client first render it is. A plain container (a `serializeTemplate` root) carries no statement
 * either way, so it is adopted as before.
 */
const clientHost = (seam: ReturnType<typeof slotSeam>, container: Node) =>
  seam?._$b$ !== undefined &&
  container.nodeType === 1 &&
  (container as Element).localName.includes('-') &&
  !(container as Element).hasAttribute('data-vm-light');

/**
 * The hydrating `render`: a drop-in for the base entry's. The first render into a container that
 * already has children adopts them; any mismatch clears (keeping `<style data-vm-sheet="styles">`) and falls
 * through to a clean base render. After the first render, this IS the base render.
 */
export const renderInto = (result: unknown, container: Node) => {
  const seam = slotSeam();
  if (
    !rootParts.has(container) &&
    !clientHost(seam, container) &&
    container.firstChild !== null &&
    result !== null &&
    typeof result === 'object' &&
    isTemplateResult(result as object)
  ) {
    /**
     * **Hydration is a first render that ADOPTS instead of creating** — so it does what a client
     * first render does for slots: every light container is captured (its children are the server's
     * render, so none are taken; the light ones are recovered where the server put them), and the
     * adoption is bracketed, so what it writes is credited to this container like any render's.
     * Without either, a host whose server state had no `<slot>` was never watched, and a node the
     * adoption itself inserted read as the user's.
     */
    /** Read before capture strips it — the fallback warning below says something different without it. */
    const stated =
      __DEV__ &&
      container.nodeType === 1 &&
      ((container as Element).hasAttribute('data-vm-light') ||
        (container as Element).querySelector('[data-vm-light],[data-vm-slotted]') !== null);
    if (seam?._$b$ !== undefined && container.nodeType === 1) seam._$capture$?.(container as Element, undefined, true);
    seam?._$b$?.(container);
    let part: ChildPart | null;
    try {
      part = tryAdopt(result as TemplateResult, container);
    } finally {
      seam?._$e$?.();
    }
    if (part !== null) {
      rootParts.set(container, part);
      return;
    }
    /**
     * **Falling back has to say so.** The page is correct either way — that is what the fallback is
     * for — but the server's markup has just been thrown away, which means every byte the server
     * spent rendering it was wasted and the one thing server rendering exists to deliver did not
     * happen. Nothing observable changes, so without this the only symptom is a slower first paint
     * that nobody attributes to anything.
     *
     * The `<textarea>` case a few screens up is the proof: adoption was abandoned *for the whole
     * page* by one element whose content the template did not describe, and the markup still looked
     * right afterwards. It was found by reading the code. React and lit both report a mismatch;
     * this said nothing at all.
     *
     * `__DEV__`-only, and the reason comes from the check that failed, so it names the first place
     * the two renders disagreed rather than announcing that they did.
     *
     * **Scoped to this container, because that is what happened.** This function runs once per
     * container, and a mismatch clears exactly one — measured: three containers, one carrying markup
     * the template does not describe, and the other two adopt their server nodes unchanged while one
     * warning prints. The message used to say "nothing the server rendered was used", which reads as
     * a page-wide failure and sends the reader looking for a page-wide cause: a bad doctype, a broken
     * handoff, state that differs everywhere. The truth is narrower and the message already names the
     * element, so the advice can be local.
     *
     * It also said the markup was discarded, full stop; `clearPreservingStyles` keeps
     * `<style data-vm-sheet="styles">`, which is the whole reason that function exists.
     */
    if (__DEV__) {
      /**
       * **"The page is correct" is a promise this message must not make blindly.** The bail rescue
       * returns the host's light list, which the server STATES (`data-vm-light`) — complete for real
       * server output, named and unnamed and bare text alike. A component host without the statement
       * never gets here (`clientHost`); a plain container carrying no statement anywhere in it may
       * hold client-side children, which cannot be told apart from the stale markup being discarded,
       * so they go with it — and the message says so instead of promising a correct page.
       */
      const unmarked = container.nodeType === 1 && !stated;
      console.warn(
        `[vera] hydration fell back to a client render: ${why}. This container's server markup was ` +
          `discarded and rebuilt (its SSR <style> is kept), ` +
          (unmarked
            ? `and it carried none of the marks server output of a light host carries. If its ` +
              `children were CLIENT-side markup rather than this template's server output, they ` +
              `cannot be told apart from the stale markup and were discarded with it — hydrate adopts existing children ` +
              `AS server output; render client-only containers with @verajs/renderer's renderInto ` +
              `instead. `
            : `so the page is correct but the server's work on this part of it was wasted. `) +
          `Other containers on the page hydrate independently and are unaffected. The two renders ` +
          `have to agree exactly — check for markup the template does not describe, or state ` +
          `settled after the server render.`
      );
    }
    /**
     * **Un-distribute before discarding.** A light host's slotted content lives INSIDE the markup
     * about to be thrown away, so clearing destroyed it: the slots fell back and the user's nodes
     * were gone from the page permanently, under a warning that said the page was still correct.
     * The host has owned its light list since the capture above, so the slots module returns the
     * whole list to holding (`_$rescue$`) — and the clean render below finds a captured host with
     * nothing shown and fills its slots as any render does, with no special case anywhere.
     */
    if (container.nodeType === 1) slotSeam()?._$rescue$?.(container as Element);
    clearPreservingStyles(container);
  }
  baseRender(result, container);
};

/** Same wire-misuse guard the base entry puts on its raw function — see renderer.ts. */
if (__DEV__) (renderInto as unknown as { $module?: string }).$module = 'renderer';

/**
 * This entry's `renderer` module, bound to the **hydrating** `renderInto`.
 *
 * It used to be a bare re-export of the base entry's descriptor, whose `fn` is the base,
 * non-adopting render — so the natural `import { renderer } from '@verajs/renderer/hydrate';
 * wire([renderer])` wired a renderer that never hydrated. The page still looked right (a first
 * render into a full container clears it and renders fresh), which made the failure silent: every
 * byte of server work discarded, nothing on screen to say so. The header's promise — point the
 * importmap at this bundle "and nothing else changes" — is only true now that the descriptor
 * carries this entry's own function. `connect` and the rest are shared deliberately: they operate
 * on this bundle's copy of the renderer's module state, which both functions read.
 */
export const renderer = { ...baseRenderer, fn: renderInto as never };
