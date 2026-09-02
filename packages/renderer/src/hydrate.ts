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
 * container (preserving `<style vera-styles>` tags) and the caller renders fresh — correctness
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
  renderInto as baseRender,
  renderer as baseRenderer,
} from './renderer.js';
import type { Template, Part, Item, TemplateResult, KeyedResult } from './renderer.js';

export { hold } from './renderer.js';
export type { TemplateResult } from './renderer.js';

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

type Cursor = { parent: Node; node: Node | null; offset: number };

/** Splits mid-text cursors onto a node boundary and returns the node now at the cursor. */
const cursorSplit = (cursor: Cursor): Node | null => {
  if (cursor.offset > 0) {
    cursor.node = (cursor.node as Text).splitText(cursor.offset);
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
    cursor.node = cursor.node.nextSibling;
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
      cursor.node = node.nextSibling;
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
      cursor.node = node.nextSibling;
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
    cursor.parent.insertBefore(primed, at);
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
  cursor.node = node.nextSibling;
  cursor.offset = 0;
  return node;
};

/** Per-template canonical node list (ELEMENT | TEXT order), cached — adoption of a 100-row list
 * hits the same template 100 times. */
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

  const inner: Cursor = { parent: live, node: live.firstChild, offset: 0 };
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

  cursor.node = live.nextSibling;
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
  cursor.parent.insertBefore(start, cursorSplit(cursor));
  const part = new ChildPart(start, null);

  if (value == null) {
    /** Nothing rendered server-side; the part starts EMPTY. */
  } else if (isTemplateResult(value)) {
    part._instance = adoptInstance(getTemplate(value), value.values, cursor);
    part._shape = value.strings;
    part._mode = TEMPLATE;
  } else if ((value as Node).nodeType !== undefined) {
    /**
     * A DOM node is client-only by construction — the server has no document to have built one, so
     * it rendered nothing here and there is nothing to adopt. Inserting it at the cursor (which has
     * not moved, because no server node was claimed) puts it exactly where the end marker is about
     * to go, and leaves the part in the same state a client-side commit would.
     */
    cursor.parent.insertBefore(value as Node, cursorSplit(cursor));
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
  cursor.parent.insertBefore(end, cursorSplit(cursor));
  part._end = end;
  out.push(part);
};

/** Adopts one list item — element mode for single-root templates, markered otherwise. */
const adoptItem = (cursor: Cursor, value: unknown): Item => {
  if (value !== null && typeof value === 'object' && (value as TemplateResult).strings !== undefined) {
    const result = value as TemplateResult;
    const template = getTemplate(result);
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
    cursor.parent.insertBefore(start, cursorSplit(cursor));
    const instance = adoptInstance(template, result.values, cursor);
    const end = comment();
    cursor.parent.insertBefore(end, cursorSplit(cursor));
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
  return instance;
};

/**
 * Attempts to adopt a container's existing (server-rendered) children for `result`. Returns the
 * root part on success; null on any mismatch, leaving the caller to clean-render. Leading
 * `<style vera-styles>` tags (the SSR style serialization) are skipped and preserved.
 */
const tryAdopt = (result: TemplateResult, container: Node): ChildPart | null => {
  /** Only the SSR-serialized style tags are skipped — templates may legitimately start with
   * whitespace or even their own static `<style>`, which must align against the canonical walk. */
  let first = container.firstChild;
  while (first !== null && first.nodeType === 1 && (first as Element).hasAttribute('vera-styles')) {
    first = first.nextSibling;
  }
  if (__DEV__) why = '';
  const start = comment();
  container.insertBefore(start, first);
  try {
    const cursor: Cursor = { parent: container, node: start.nextSibling, offset: 0 };
    const instance = adoptInstance(getTemplate(result), result.values, cursor);
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
    if (!(node.nodeType === 1 && (node as Element).hasAttribute('vera-styles'))) container.removeChild(node);
    node = next;
  }
};

/**
 * The hydrating `render`: a drop-in for the base entry's. The first render into a container that
 * already has children adopts them; any mismatch clears (keeping `<style vera-styles>`) and falls
 * through to a clean base render. After the first render, this IS the base render.
 */
export const renderInto = (result: unknown, container: Node) => {
  if (
    !rootParts.has(container) &&
    container.firstChild !== null &&
    result !== null &&
    typeof result === 'object' &&
    isTemplateResult(result as object)
  ) {
    const part = tryAdopt(result as TemplateResult, container);
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
     * `<style vera-styles>`, which is the whole reason that function exists.
     */
    if (__DEV__)
      console.warn(
        `[vera] hydration fell back to a client render: ${why}. This container's server markup was ` +
          `discarded and rebuilt (its SSR <style> is kept), so the page is correct but the server's ` +
          `work on this part of it was wasted. Other containers on the page hydrate independently ` +
          `and are unaffected. The two renders have to agree exactly — check for markup the template ` +
          `does not describe, or state settled after the server render.`
      );
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
