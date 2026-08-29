/**
 * The server's DOM nodes: an element, a shadow root, a fragment, and the container they share.
 *
 * These hold their children as a **string**. Nothing in this package parses HTML, so queries answer
 * emptily and `insertBefore`/`cloneNode` are deliberately absent — they need a tree, and faking them
 * would misplace content silently. Everything else a real node exposes is either here or listed in
 * `tests/dom-surface.mjs` as out of scope with a reason, and both directions are enforced: the code
 * that runs on this DOM is *user* code, and for years every missing member was found by someone
 * tripping over it.
 */
import { randomUUID } from 'node:crypto';
import { interfaceFor } from './reflections.js';
import { escapeHtml, escapeStyleText, RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from './escaping.js';
import { parseFragment } from './parse.js';
import { addListener, removeListener, dispatch } from './events.js';
import * as select from './select.js';
import { datasetView, styleView, tokenListView } from './views.js';
import { StyleSheetShim } from './stylesheets.js';
import { registry } from './registry.js';

/**
 * The HTML namespace, which is what `createElement` produces and what almost everything here is.
 *
 * It is load-bearing rather than decorative: **an HTML element folds tag and attribute names to
 * lower case, and an element in any other namespace does not.** `svg.setAttribute('viewBox', …)`
 * has to keep its capital B or the viewport is ignored, while `div.setAttribute('Data-Flag', …)`
 * has to lose its capitals or the `getAttribute('data-flag')` beside it reads `null`.
 */
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * The characters that make a name unusable, checked so the shim refuses what the platform refuses.
 *
 * **Deliberately the engines' rule and not jsdom's.** jsdom implements the XML `Name` production and
 * rejects `a(b)`, `a|b`, `a?b` and about fifty other shapes that every real engine accepts —
 * `tests/browser/spread-names.test.js` records that the engines refuse exactly `a b`, `a>b`, `a=b`
 * and `a/b`, and `CLAUDE.md` records the false finding that came of trusting jsdom here. So this is
 * whitespace, `>`, `=`, `/` and controls, plus the empty string: strictly the set that cannot survive
 * being written into a tag, and nothing invented on top.
 */
const UNUSABLE_IN_A_NAME = /[\0-\x20/>=\x7f]/;

/**
 * A tag name is checked slightly harder, because a quote or a `<` inside one **does** break the
 * markup where the same character inside an attribute name does not.
 */
const UNUSABLE_IN_A_TAG = /[\0-\x20"'<>/=\x7f]/;

/**
 * Declarative shadow DOM can carry more than the mode, and the extras are **not recoverable on the
 * client**: `attachShadow` reuses a declarative root and ignores the options it is handed, so a
 * component asking for `delegatesFocus: true` over server-rendered markup that omitted it keeps
 * `delegatesFocus === false` for the life of the page. Measured in Chromium. Focus delegation is an
 * accessibility behaviour, so losing it silently under SSR is the kind of difference that never gets
 * reported — it just works worse.
 *
 * `slotAssignment` has no declarative form at all; a component that needs it cannot be faithfully
 * server-rendered, and the README says so rather than pretending.
 */
const SHADOW_ATTRIBUTES = [
  ['delegatesFocus', 'shadowrootdelegatesfocus'],
  ['clonable', 'shadowrootclonable'],
  ['serializable', 'shadowrootserializable'],
];

/**
 * What an element and a shadow root both are: something that holds children as markup and can be
 * appended to, queried and listened to.
 *
 * Shared because they kept drifting. `ShadowRootShim` was built for the renderer and `ElementShim`
 * for core, so each was short of a different set of members — the router threw on
 * `shadowRoot.addEventListener`, component code threw on `element.dataset`, and every gap was found
 * by probing rather than by the two being one thing. Anything a container does belongs here.
 *
 * Queries answer emptily because this holds a **string**, not a tree; nothing in this package parses
 * HTML. `insertBefore` and `cloneNode` are deliberately absent for the same reason — they need a
 * tree, and faking them would misplace content silently.
 *
 * Events come from Node's own `EventTarget`, so `once`, `handleEvent`, `event.target`,
 * `stopImmediatePropagation` and the return value of `dispatchEvent` are all correct without this
 * package implementing any of them. They used to be no-ops that reported every event delivered, so
 * anything a component decided from its own event — a control reading back its change, a callback
 * dispatched at mount, a `preventDefault` deciding whether to proceed — took one branch here and
 * the other in a browser. **Bubbling is still absent**: with children held as a string there is no
 * ancestor chain to walk, so an event reaches its own element's listeners and stops.
 */
/**
 * One entry's markup. A retained node serialises itself **at output time**, which is the entire
 * point of keeping it: a mutation made after `appendChild` is still on the node when this runs.
 * The expression is the one `appendChild` used to inline, unchanged, so the bytes are identical.
 */
export const serializeElement = (element) =>
  VOID_ELEMENTS.has(element.localName)
    ? element.openTag()
    : element.openTag() + element.innerHTML + (element._sourceCloseTag ?? `</${element.localName}>`);

const serializeEntry = (entry) =>
  typeof entry === 'string'
    ? entry
    : typeof entry?.markup === 'function'
      ? entry.markup()
      : (entry?.innerHTML ?? '');

/**
 * The attribute list, with the `NamedNodeMap` methods on it. A free function taking the element so
 * nothing has to alias `this`, and one cast because the methods are added to an array.
 *
 * @param {any} element
 */
const namedNodeMap = (element) => {
  const list = /** @type {any} */ (
    [...element._attributes].map(([name, value]) => ({
      name,
      value,
      localName: name,
      namespaceURI: null,
      ownerElement: element,
    }))
  );
  list.getNamedItem = (name) => list.find((entry) => entry.name === `${name}`.toLowerCase()) ?? null;
  list.getNamedItemNS = (_namespace, name) => list.getNamedItem(name);
  list.item = (index) => list[index] ?? null;
  list.setNamedItem = (attribute) => {
    const previous = list.getNamedItem(attribute?.name);
    element.setAttribute(attribute.name, attribute.value);
    return previous;
  };
  list.removeNamedItem = (name) => {
    const previous = list.getNamedItem(name);
    if (!previous)
      throw new DOMException(
        `Failed to execute 'removeNamedItem' on 'NamedNodeMap': No item with name '${name}' was found.`,
        'NotFoundError'
      );
    element.removeAttribute(name);
    return previous;
  };
  return list;
};

/** A node this DOM keeps by reference, rather than inlining its markup — see `appendChild`. */
const isNode = (value) => typeof value?.markup === 'function';

/**
 * The slot a node asks for. Text has no attributes, so it can only take the default slot.
 * A free function so neither caller has to alias `this` — see `equalNodes` for the same reason.
 *
 * @param {any} node
 */
const slotNameOf = (node) => (node.nodeType === 1 ? (node.getAttribute('slot') ?? '') : '');

/**
 * **What a `<slot>` projects.** A slot shows the host's light-DOM children whose `slot` attribute
 * names it — the default slot taking everything unnamed. That is answerable on a server: the host,
 * its children and their names are all here. It answered nothing, so a component inspecting what it
 * had been given found an empty list and rendered its fallback content, on the server only.
 *
 * `flatten` falls back to the slot's own children when nothing is assigned, which is what makes it
 * the useful form: it answers "what will actually be shown here".
 *
 * @param {any} slot @param {{flatten?: boolean}} [options]
 */
const assignedTo = (slot, options) => {
  const root = slot.getRootNode();
  const host = root?._host;
  if (!host) return options?.flatten ? nodesOf(slot) : [];
  const name = slot.getAttribute('name') ?? '';
  const assigned = nodesOf(host).filter((node) => slotNameOf(node) === name);
  return assigned.length || !options?.flatten ? assigned : nodesOf(slot);
};

/**
 * **`before`, `after` and `replaceWith`** — the `ChildNode` trio, which every one of these classes
 * needs and none can inherit from the other: text and comments extend `EventTarget` directly rather
 * than the container. Written once here and delegated to, rather than three times over.
 *
 * A plain string becomes a text node, which is what the spec says and what makes
 * `node.after('some text')` do the obvious thing instead of nothing.
 *
 * @param {any} node @param {Array<any>} inserted @param {'before' | 'after' | 'replace'} where
 */
const insertAround = (node, inserted, where) => {
  const parent = node._parent;
  if (!parent) return;
  const reference = where === 'after' ? node.nextSibling : node;
  for (const one of inserted)
    parent.insertBefore(typeof one === 'string' ? new TextShim(one) : one, reference);
  if (where === 'replace') parent.removeChild(node);
};

/**
 * **Structural equality, as the spec defines it** — type, name, attributes as a set, and children
 * pairwise. `isEqualNode` used to compare identity, which is what `isSameNode` is for, so two
 * elements built identically reported themselves different.
 *
 * A free function rather than a method so neither node has to be `this`: a shadow root and a
 * fragment are containers with no attributes and no `nodeName` of their own, and reaching for those
 * through `this` needs a cast that the lint rules and the type-checker disagree about.
 *
 * @param {any} a @param {any} b
 */
const equalNodes = (a, b) => {
  if (a === b) return true;
  if (!b || b.nodeType !== a.nodeType || b.nodeName !== a.nodeName) return false;
  const mine = a._attributes ?? new Map();
  const theirs = b._attributes ?? new Map();
  if (mine.size !== theirs.size) return false;
  for (const [name, value] of mine) if (theirs.get(name) !== value) return false;
  const ours = nodesOf(a);
  const others = nodesOf(b);
  if (ours.length !== others.length) return false;
  return ours.every((child, index) => child.isEqualNode(others[index]));
};

/**
 * **Walks the tree**, as `textContent` is defined to. It used to strip tags out of the serialised
 * markup with a regular expression and undo the numeric escapes, which answered `a &amp; b` for an
 * element holding the text `a & b` — the entity spellings this package does not itself emit came
 * back raw. A comment contributes nothing, which is what the platform says.
 *
 * A chunk of markup this DOM could not parse has no nodes to walk, so it keeps the old treatment.
 */
const textOf = (container) => {
  parseChunks(container);
  let out = '';
  for (const entry of container._entries) {
    if (typeof entry === 'string')
      out += entry.replace(/<[^>]*>/gu, '').replace(/&#(\d+);/gu, (_, code) => String.fromCharCode(Number(code)));
    else if (entry.nodeType === 8) continue;
    else out += entry.textContent;
  }
  return out;
};

/** Warned once per container, so a component that queries in a loop says it once. */
const warnedAboutMarkup = /* @__PURE__ */ new WeakSet();

/**
 * The retained nodes among the entries.
 *
 * **Markup supplied as a string is not nodes**, and this is where that shows. Until the parser
 * arrives (step 2 of `internal/docs/PLAN-ssr-node-retention.md`) a container filled by `innerHTML`
 * or by the `children:` option has markup and no node view, so asking for one answers emptily —
 * which is a wrong answer, and says so rather than being discovered later as a defect.
 */
/**
 * **Parse the markup chunks, but only keep the result if it reproduces them exactly.**
 *
 * The parse is discarded unless re-serialising it is byte-identical to the string it came from, so
 * reading `children` can never change what the page renders — the worst case is the behaviour that
 * was there before, plus a warning. That check is also what makes a parser defect cheap: a wrong
 * tree that does not round-trip is thrown away rather than served.
 */
const parseChunks = (container) => {
  if (container._parsed) return;
  container._parsed = true;
  const entries = [];
  let gained = false;
  for (const entry of container._entries) {
    if (typeof entry !== 'string') {
      entries.push(entry);
      continue;
    }
    const parsed = parseFragment(entry, {
      element: (name) => build(name),
      text: (data) => new TextShim(data),
      comment: (data) => new CommentShim(data),
    });
    let round = '';
    if (parsed) for (const node of parsed) round += serializeEntry(node);
    if (!parsed || round !== entry) {
      entries.push(entry);
      continue;
    }
    for (const node of parsed) if (typeof node !== 'string') node._parent = container;
    entries.push(...parsed);
    gained = true;
  }
  if (gained) container._entries = entries;
};

/** **Elements only** — what `children` and every element-wise accessor mean. */
const elementsOf = (container) => nodesOf(container).filter((node) => node.openTag);

const nodesOf = (container) => {
  parseChunks(container);
  const nodes = container._entries.filter((entry) => typeof entry !== 'string');
  if (
    !nodes.length &&
    !warnedAboutMarkup.has(container) &&
    container._entries.some((entry) => typeof entry === 'string' && entry.trim())
  ) {
    warnedAboutMarkup.add(container);
    console.warn(
      `[vera] ssr: this element has markup but no child nodes, so children/querySelector answer ` +
        `emptily. Markup assigned as a string is not parsed on the server. Build children with ` +
        `createElement/appendChild if a component needs to read them back.`
    );
  }
  return nodes;
};

/**
 * **Text and comments are nodes.**
 *
 * They were not: `createTextNode` returned an object literal with an `innerHTML` string, so it had
 * no identity, no parent and no `nodeType`, and appending one inlined its markup and lost the node.
 * `childNodes` therefore reported `1` for `text <b>bold</b> tail`, where every browser says `3`.
 *
 * Like an element, a parsed one keeps **the exact bytes it came from** so re-serialising reproduces
 * the input — `&amp;` stays `&amp;` rather than becoming this package's `&#38;` — and falls back to
 * escaping its data the moment somebody writes to it.
 */
class CharacterDataShim extends EventTarget {
  constructor(data) {
    super();
    this._data = `${data}`;
    this._source = /** @type {string | null} */ (null);
    this._parent = /** @type {any} */ (null);
    this.isConnected = true;
  }
  /**
   * Registered here rather than on the platform's `EventTarget`; see `events.js`.
   * @override
   */
  addEventListener(type, callback, options) {
    addListener(this, type, callback, options);
  }
  /** @override */
  removeEventListener(type, callback, options) {
    removeListener(this, type, callback, options);
  }
  /** @override */
  dispatchEvent(event) {
    return dispatch(this, event);
  }
  get data() {
    return this._data;
  }
  set data(value) {
    this._data = `${value}`;
    this._source = null;
  }
  get nodeValue() {
    return this._data;
  }
  set nodeValue(value) {
    this.data = value;
  }
  get textContent() {
    return this._data;
  }
  set textContent(value) {
    this.data = value;
  }
  get length() {
    return this._data.length;
  }
  get parentNode() {
    return this._parent;
  }
  get parentElement() {
    return this._parent?.openTag ? this._parent : null;
  }
  get childNodes() {
    return [];
  }
  get firstChild() {
    return null;
  }
  get lastChild() {
    return null;
  }
  hasChildNodes() {
    return false;
  }
  get ownerDocument() {
    return globalThis.document ?? null;
  }
  get nextSibling() {
    return this._siblingAt(1);
  }
  get previousSibling() {
    return this._siblingAt(-1);
  }
  /** @param {number} step @param {(container: any) => Array<any>} view */
  _siblingAt(step, view = nodesOf) {
    if (!this._parent) return null;
    const siblings = view(this._parent);
    const index = siblings.indexOf(this);
    return index === -1 ? null : (siblings[index + step] ?? null);
  }
  remove() {
    this._parent?.removeChild(this);
  }
  before(...nodes) {
    insertAround(this, nodes, 'before');
  }
  after(...nodes) {
    insertAround(this, nodes, 'after');
  }
  replaceWith(...nodes) {
    insertAround(this, nodes, 'replace');
  }
  isSameNode(node) {
    return node === this;
  }
  isEqualNode(node) {
    /** `nodeType` is the subclass's — this base is never instantiated on its own. */
    return node?.nodeType === /** @type {any} */ (this).nodeType && node?.data === this._data;
  }
  contains(node) {
    return node === this;
  }
  getRootNode() {
    if (!this._parent) return this;
    let root = this._parent;
    while (root._parent) root = root._parent;
    return root;
  }
  appendData(value) {
    this.data = this._data + `${value}`;
  }
  substringData(offset, count) {
    return this._data.substr(offset, count);
  }
}

export class TextShim extends CharacterDataShim {
  get nodeType() {
    return 3;
  }
  get nodeName() {
    return '#text';
  }
  get wholeText() {
    return this._data;
  }
  markup() {
    return this._source ?? escapeHtml(this._data);
  }
  cloneNode() {
    const copy = new TextShim(this._data);
    copy._source = this._source;
    return copy;
  }
  /** Splits at `offset`, leaving this node with the first half and inserting the second after it. */
  splitText(offset) {
    const tail = new TextShim(this._data.slice(offset));
    this.data = this._data.slice(0, offset);
    if (this._parent) this._parent.insertBefore(tail, this.nextSibling);
    return tail;
  }
}

export class CommentShim extends CharacterDataShim {
  get nodeType() {
    return 8;
  }
  get nodeName() {
    return '#comment';
  }
  markup() {
    return this._source ?? `<!--${this._data}-->`;
  }
  cloneNode() {
    const copy = new CommentShim(this._data);
    copy._source = this._source;
    return copy;
  }
}

export class ContainerShim extends EventTarget {
  constructor() {
    super();
    /**
     * **Children are entries, not one string.** Each entry is either a retained node or a chunk of
     * raw markup. Serialisation happens when `innerHTML` is *read*, not when a child is appended —
     * appending used to serialise immediately and drop the node, so `appendChild(kid)` followed by
     * `kid.textContent = 'x'` rendered `<b></b>` and lost the text with no diagnostic.
     */
    this._entries = [];
    this._parent = null;
    /** A server-rendered node is in the document being built, so it is connected. */
    this.isConnected = true;
  }
  /**
   * Registered here rather than on the platform's `EventTarget`; see `events.js`.
   * @override
   */
  addEventListener(type, callback, options) {
    addListener(this, type, callback, options);
  }
  /** @override */
  removeEventListener(type, callback, options) {
    removeListener(this, type, callback, options);
  }
  /** @override */
  dispatchEvent(event) {
    return dispatch(this, event);
  }
  get innerHTML() {
    let out = '';
    for (const entry of this._entries) out += serializeEntry(entry);
    return out;
  }
  set innerHTML(markup) {
    for (const entry of this._entries) if (typeof entry !== 'string') entry._parent = null;
    const text = `${markup}`;
    this._entries = text === '' ? [] : [text];
    /** New markup has not been looked at yet, whatever was true of the markup it replaced. */
    this._parsed = false;
  }
  appendChild(node) {
    /**
     * **Not a node is a `TypeError`, as it is in a browser.** `appendChild(null)` was a silent no-op
     * here and throws in every engine, so `this.appendChild(maybeMissing)` — ordinary code —
     * rendered a server page with the child quietly absent and then crashed the client.
     */
    if (node === null || typeof node !== 'object')
      throw new TypeError(
        `Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.`
      );
    /**
     * A registered component that has not rendered is marked, so the scan over this markup renders
     * this instance instead of a new one built from the tag it wrote. See `pendingInstances`.
     */
    if (node?.openTag && registry.has(node.localName) && !node._rendered) {
      node.setAttribute(INSTANCE_ATTRIBUTE, String(++instanceCount));
      pendingInstances.set(String(instanceCount), node);
    }
    /**
     * **A node cannot contain itself.** Retaining nodes makes this reachable where inlining markup
     * never could: appending an ancestor into its own descendant would recurse forever the next
     * time anything read `innerHTML`. Every engine throws `HierarchyRequestError`.
     */
    let contains = node === this;
    for (let above = this._parent; above && !contains; above = above._parent)
      if (above === node) contains = true;
    if (contains)
      throw new DOMException(
        `Failed to execute 'appendChild' on 'Node': The new child element contains the parent.`,
        'HierarchyRequestError'
      );
    /**
     * A node with no tag of its own — a fragment — contributes its markup exactly as it did before.
     * Moving a fragment's children into this parent is the platform's behaviour and is deliberately
     * *not* step 1: it changes what `appendChild(fragment)` leaves behind.
     */
    /**
     * **A fragment hands over its children and is left empty**, which is what a browser does and the
     * whole point of the type. Its markup used to be inlined instead, so the fragment still reported
     * the children it had supposedly given away.
     */
    if (node?.nodeType === 11) {
      for (const entry of node._entries) {
        if (isNode(entry)) entry._parent = this;
        this._entries.push(entry);
      }
      node._entries = [];
      return node;
    }
    if (!isNode(node)) {
      this._entries.push(node?.innerHTML ?? '');
      return node;
    }
    node._parent?._detach(node);
    this._entries.push(node);
    node._parent = this;
    return node;
  }
  /**
   * **Position a node among the children**, which needed a tree and now has one. `reference` of
   * `null` appends, as the platform says, and a reference that is not a child is a `NotFoundError`
   * rather than a silent append — the difference between "put it at the end" and "you asked about
   * a node I do not have" is exactly the kind of thing a server should not paper over.
   */
  insertBefore(node, reference) {
    if (node === null || typeof node !== 'object')
      throw new TypeError(
        `Failed to execute 'insertBefore' on 'Node': parameter 1 is not of type 'Node'.`
      );
    if (reference === null || reference === undefined) return this.appendChild(node);
    if (this._entries.indexOf(reference) === -1)
      throw new DOMException(
        `Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be ` +
          `inserted is not a child of this node.`,
        'NotFoundError'
      );
    let contains = node === this;
    for (let above = this._parent; above && !contains; above = above._parent)
      if (above === node) contains = true;
    if (contains)
      throw new DOMException(
        `Failed to execute 'insertBefore' on 'Node': The new child element contains the parent.`,
        'HierarchyRequestError'
      );
    if (!isNode(node)) {
      this._entries.splice(this._entries.indexOf(reference), 0, node?.innerHTML ?? '');
      return node;
    }
    node._parent?._detach(node);
    /** Re-found after the detach: moving a node forwards within one parent shifts the index. */
    this._entries.splice(this._entries.indexOf(reference), 0, node);
    node._parent = this;
    return node;
  }
  /**
   * **`moveBefore` is `insertBefore` with a precondition**: the node must already have a parent.
   * Measured on Chromium and Firefox, which agree on all of it (WebKit does not implement it yet):
   * an unparented node is a `HierarchyRequestError`, and a *parented* node with a reference that is
   * not a child here is a `NotFoundError` — a different error from the same call depending on which
   * argument is wrong, and checked in that order.
   *
   * The point of the API in a browser is moving a node without tearing down its state. There is no
   * state to preserve on a server, so this is a move; having it means code written for the browser
   * runs here rather than hitting a missing method.
   */
  moveBefore(node, reference) {
    if (node === null || typeof node !== 'object')
      throw new TypeError(`Failed to execute 'moveBefore' on 'Node': parameter 1 is not of type 'Node'.`);
    if (!node._parent)
      throw new DOMException(
        `Failed to execute 'moveBefore' on 'Node': The node to be moved has no parent.`,
        'HierarchyRequestError'
      );
    if (reference !== null && reference !== undefined && this._entries.indexOf(reference) === -1)
      throw new DOMException(
        `Failed to execute 'moveBefore' on 'Node': The node before which the new node is to be ` +
          `inserted is not a child of this node.`,
        'NotFoundError'
      );
    return this.insertBefore(node, reference ?? null);
  }
  replaceChild(node, old) {
    if (node === null || typeof node !== 'object')
      throw new TypeError(
        `Failed to execute 'replaceChild' on 'Node': parameter 1 is not of type 'Node'.`
      );
    if (this._entries.indexOf(old) === -1)
      throw new DOMException(
        `Failed to execute 'replaceChild' on 'Node': The node to be replaced is not a child of this node.`,
        'NotFoundError'
      );
    node._parent?._detach(node);
    this._entries.splice(this._entries.indexOf(old), 1, isNode(node) ? node : (node?.innerHTML ?? ''));
    if (isNode(node)) node._parent = this;
    old._parent = null;
    return old;
  }
  /**
   * **Where each node sits relative to another**, as the spec's bit field. Two nodes with no common
   * root are `DISCONNECTED | IMPLEMENTATION_SPECIFIC` plus a direction the spec leaves to the
   * implementation, so only the disconnected bit is worth comparing across implementations.
   */
  compareDocumentPosition(other) {
    if (other === this) return 0;
    if (this.contains(other)) return 16 + 4;
    if (other.contains?.(this)) return 8 + 2;
    const chain = (node) => {
      const out = [];
      for (let current = node; current; current = current._parent) out.unshift(current);
      return out;
    };
    const mine = chain(this);
    const theirs = chain(other);
    if (mine[0] !== theirs[0]) return 1 + 32 + 2;
    let depth = 0;
    while (mine[depth] === theirs[depth]) depth++;
    const siblings = nodesOf(mine[depth - 1]);
    return siblings.indexOf(mine[depth]) < siblings.indexOf(theirs[depth]) ? 4 : 2;
  }
  /** Remove a node from this container's entries without touching its own parent pointer. */
  _detach(node) {
    const index = this._entries.indexOf(node);
    if (index !== -1) this._entries.splice(index, 1);
  }
  /**
   * **Absent until nodes were retained**, so `host.removeChild(kid)` was a `TypeError` — there was
   * nothing to remove, the child having been flattened into a string at append time.
   */
  removeChild(node) {
    const index = this._entries.indexOf(node);
    if (index === -1)
      throw new DOMException(
        `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`,
        'NotFoundError'
      );
    this._entries.splice(index, 1);
    node._parent = null;
    return node;
  }

  /**
   * What a node with no tree above or below it answers — shared, because an element and a shadow
   * root answer these identically and two copies is how they came to disagree in the first place.
   *
   * Every one is the truthful answer rather than a placeholder: a detached node has no parent, no
   * siblings and no box, and a browser returns exactly these. They are here because their
   * *absence* was a `TypeError` that took the whole render down — `this.parentElement && …` is
   * ordinary defensive code and it crashed.
   */
  get parentNode() {
    return this._parent;
  }
  /** `null` when the parent is not an element — a shadow root is a parent and not an element. */
  get parentElement() {
    return this._parent?.openTag ? this._parent : null;
  }
  get firstChild() {
    return nodesOf(this)[0] ?? null;
  }
  get lastChild() {
    return nodesOf(this).at(-1) ?? null;
  }
  get lastElementChild() {
    return elementsOf(this).at(-1) ?? null;
  }
  /**
   * **The siblings are real now.** These answered `null` unconditionally, which was truthful while a
   * child was flattened into its parent's markup and became a lie the moment nodes were retained —
   * `element.nextSibling` on the middle of three children reported nothing at all. There are no text
   * nodes in this DOM, so the element-wise and node-wise spellings answer the same list.
   */
  get nextSibling() {
    return this._siblingAt(1);
  }
  get previousSibling() {
    return this._siblingAt(-1);
  }
  get nextElementSibling() {
    return this._siblingAt(1, elementsOf);
  }
  get previousElementSibling() {
    return this._siblingAt(-1, elementsOf);
  }
  /** @param {number} step */
  /** @param {number} step @param {(container: any) => Array<any>} view */
  _siblingAt(step, view = nodesOf) {
    if (!this._parent) return null;
    const siblings = view(this._parent);
    const index = siblings.indexOf(this);
    return index === -1 ? null : (siblings[index + step] ?? null);
  }
  /**
   * **The slot this node is projected into**, which needs the host's shadow root and the node's own
   * `slot` name — both of which are here. It answered `null` for every node, so a component asking
   * where its light DOM had landed was told "nowhere".
   */
  get assignedSlot() {
    const root = this._parent?._shadowRoot;
    if (!root) return null;
    const name = slotNameOf(this);
    return (
      root
        .querySelectorAll('slot')
        .find((slot) => (slot.getAttribute('name') ?? '') === name) ?? null
    );
  }
  get offsetParent() {
    return null;
  }
  get childElementCount() {
    return elementsOf(this).length;
  }
  hasChildNodes() {
    return nodesOf(this).length > 0;
  }
  get nodeValue() {
    return null;
  }
  get baseURI() {
    return globalThis.location?.href ?? '';
  }
  get namespaceURI() {
    return HTML_NS;
  }
  get prefix() {
    return null;
  }
  get ownerDocument() {
    return globalThis.document;
  }
  /**
   * **Walks the parent chain**, as the platform does. It compared identity only, so
   * `host.contains(child)` was `false` for a child the host plainly held — ordinary defensive code
   * reading as "this is not mine".
   */
  contains(node) {
    for (let current = node; current; current = current._parent) if (current === this) return true;
    return false;
  }
  /** The `ChildNode` trio, shared with text and comments through `insertAround`. */
  before(...nodes) {
    insertAround(this, nodes, 'before');
  }
  after(...nodes) {
    insertAround(this, nodes, 'after');
  }
  replaceWith(...nodes) {
    insertAround(this, nodes, 'replace');
  }
  isSameNode(node) {
    return node === this;
  }
  /**
   * **Structural equality, not identity** — that is what `isSameNode` is for, and this answered the
   * same thing, so two elements built identically reported themselves different. The spec compares
   * type, name, attributes as a set, and children pairwise.
   */
  isEqualNode(node) {
    return equalNodes(this, node);
  }
  /**
   * **Merges adjacent text and drops the empty**, which is what it is for. It was a no-op because
   * there were no text nodes to merge — appending two of them left two entries a browser would have
   * joined into one, so `childNodes.length` disagreed after the most ordinary DOM building there is.
   */
  normalize() {
    parseChunks(this);
    const merged = [];
    for (const entry of this._entries) {
      const previous = merged[merged.length - 1];
      if (entry?.nodeType === 3 && entry.data === '') continue;
      if (entry?.nodeType === 3 && previous?.nodeType === 3) {
        previous.data += entry.data;
        entry._parent = null;
        continue;
      }
      merged.push(entry);
    }
    this._entries = merged;
    for (const entry of merged) if (isNode(entry) && entry.nodeType === 1) entry.normalize();
  }
  /**
   * The furthest ancestor, which is the shadow root for anything a component rendered into one —
   * unless `composed` is asked for, which keeps going out through the root's host as a browser does.
   */
  getRootNode(options) {
    if (!this._parent) return this;
    let root = this._parent;
    for (;;) {
      while (root._parent) root = root._parent;
      if (!options?.composed || !root._host) return root;
      root = root._host;
    }
  }
  /** Needs layout, which a string does not have; a browser with no box returns nothing either. */
  elementFromPoint() {
    return null;
  }
  elementsFromPoint() {
    return [];
  }
  getSelection() {
    return null;
  }
  /** `append` takes several nodes, and strings as text — the modern spelling of `appendChild`. */
  /**
   * A string is markup to escape and keep as a chunk. It used to go through `innerHTML +=`, which
   * now reads every retained node back into text and writes it as one chunk — flattening the tree
   * this class exists to keep. Pushing the chunk is the same bytes and keeps the nodes.
   */
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._entries.push(escapeHtml(node));
        this._parsed = false;
      }
      else this.appendChild(node);
    }
  }
  replaceChildren(...nodes) {
    this.innerHTML = '';
    this.append(...nodes);
  }
  /** Splices the entries rather than concatenating markup, for the reason `append` gives. */
  prepend(...nodes) {
    const existing = this._entries;
    this._entries = [];
    this.append(...nodes);
    this._entries.push(...existing);
  }
  /**
   * **Answers from the node view**, which markup assigned as a string now has. Every query used to
   * return nothing whatever was asked, so a component branched the wrong way with nothing said.
   * A selector this DOM cannot answer honestly throws rather than answering `null` — see
   * `select.js`.
   */
  querySelector(selector) {
    parseChunks(this);
    return select.querySelector(this, selector);
  }
  querySelectorAll(selector) {
    parseChunks(this);
    return select.querySelectorAll(this, selector);
  }
  getElementById(id) {
    parseChunks(this);
    return select.querySelector(this, `[id="${`${id}`.replace(/"/gu, '\\"')}"]`);
  }
  /**
   * **Only retained nodes.** Every entry this DOM holds as an element *is* an element, so `children`
   * and `childNodes` answer the same list — there are no text nodes to separate them, and markup
   * kept as a string is not nodes at all (`nodesOf` says so).
   */
  get children() {
    return elementsOf(this);
  }
  get childNodes() {
    return nodesOf(this);
  }
  get firstElementChild() {
    return elementsOf(this)[0] ?? null;
  }
}

/**
 * A fragment is a container and nothing more.
 *
 * Its own class rather than a reused `ElementShim`, so `instanceof DocumentFragment` answers `false`
 * for an element — a check the renderer makes, and one that a shared class would have made true for
 * everything.
 */
export class FragmentShim extends ContainerShim {
  get nodeType() {
    return 11;
  }
  get nodeName() {
    return '#document-fragment';
  }
}

export class ShadowRootShim extends ContainerShim {
  constructor(init) {
    super();
    this.mode = init.mode ?? 'open';
    this._init = init;
    /** Set by `attachShadow`; a shadow root's `host` is part of the contract the router reads. */
    this._host = null;
    this.innerHTML = '';
    this._styles = [];
  }
  /** `shadowrootmode` plus whatever else the root was opened with, as the parser expects them. */
  templateAttributes() {
    let out = ` shadowrootmode="${this.mode}"`;
    for (const [option, attribute] of SHADOW_ATTRIBUTES) if (this._init[option]) out += ` ${attribute}=""`;
    return out;
  }
  /**
   * A `<style>` joins the stylesheet collection; anything else is content.
   *
   * Every append used to be treated as a stylesheet, on the assumption that only `adoptStyles`
   * would ever reach here. A component appending an element to its own shadow root — ordinary DOM
   * code — therefore had that element silently turned into CSS and its markup lost.
   *
   * @override
   */
  appendChild(node) {
    if (node?.localName === 'style') {
      this._styles.push(node.innerHTML);
      return node;
    }
    return super.appendChild(node);
  }
  /** A shadow root's `host` is part of the contract `@verajs/router` reads. */
  get host() {
    return this._host;
  }
  /**
   * The options it was opened with, readable the way a browser exposes them.
   *
   * These are already serialized into the declarative template — they have to be, because
   * `attachShadow` reuses a declarative root and ignores the options it is handed. A component
   * that *reads* them back, to decide whether to manage focus itself, saw `undefined`.
   */
  get delegatesFocus() {
    return !!this._init.delegatesFocus;
  }
  get clonable() {
    return !!this._init.clonable;
  }
  get serializable() {
    return !!this._init.serializable;
  }
  get slotAssignment() {
    return this._init.slotAssignment ?? 'named';
  }
  get nodeType() {
    return 11;
  }
  get nodeName() {
    return '#document-fragment';
  }
  /** Nothing is focused on a server, and nothing is in a top layer. */
  get activeElement() {
    return null;
  }
  get fullscreenElement() {
    return null;
  }
  get pointerLockElement() {
    return null;
  }
  get pictureInPictureElement() {
    return null;
  }
  /** `<style>` elements appended here; the constructed ones are `adoptedStyleSheets`. */
  get styleSheets() {
    return this._styles.map((cssText) => Object.assign(new StyleSheetShim(), { cssText }));
  }
  /** A shadow root's text is its content's text, and setting it replaces the content. */
  get textContent() {
    return textOf(this);
  }
  set textContent(value) {
    this.innerHTML = escapeHtml(value);
  }
  /**
   * Constructed sheets land here; serialized alongside string styles.
   *
   * **Checked, because the platform checks.** A browser raises `TypeError` for a value that is not
   * a sequence and for an entry that is not a `CSSStyleSheet`, and taking anything meant that
   * `root.adoptedStyleSheets = sheet` — the single missing `[…]`, and the most likely way to get
   * this wrong — was accepted here and threw in the browser, after the server had already rendered.
   */
  set adoptedStyleSheets(sheets) {
    if (!Array.isArray(sheets))
      throw new TypeError(
        `Failed to set the 'adoptedStyleSheets' property: the provided value cannot be converted to a sequence.`
      );
    for (const sheet of sheets)
      if (!(sheet instanceof StyleSheetShim))
        throw new TypeError(
          `Failed to set the 'adoptedStyleSheets' property: the provided value is not of type 'CSSStyleSheet'.`
        );
    this._adopted = sheets;
  }
  get adoptedStyleSheets() {
    return this._adopted ?? [];
  }
  /**
   * The `<style>` tags, kept separate from the content.
   *
   * They used to be concatenated here and the whole string handed to the nested-component scan,
   * which then read the stylesheet as markup: CSS containing a registered tag name — a
   * `content: "<some-comp>"` is enough — had that component **rendered inside the stylesheet**.
   * A scan for elements has no business reading a raw-text element.
   */
  styleTags() {
    const sheets = (this._adopted ?? []).map((sheet) => sheet.cssText ?? '');
    /**
     * **Text first, adopted sheets last — because that is the order the browser cascades them in.**
     *
     * A shadow root's own `<style>` elements are its tree-order sheets, and `adoptedStyleSheets`
     * apply *after* them: measured in Chromium, a constructed rule beats an identical-specificity
     * rule from a `<style>` in the same root no matter which appears first in the markup. Here both
     * are `<style>` elements, so the cascade is document order and whichever is written last wins.
     *
     * Emitting sheets first therefore inverted it. `static styles = [sheet, '.plain { … }']` — a
     * legal shape this package serializes on purpose — had the string win on the server and lose in
     * the browser, so the page changed appearance as it hydrated, in the one direction nothing
     * compares: markup, node identity and property values all matched.
     */
    return [...this._styles, ...sheets]
      .filter(Boolean)
      .map((css) => `<style vera-styles>${escapeStyleText(css)}</style>`)
      .join('');
  }
}

/**
 * Properties that are a **view of an attribute**, and the attribute each one reflects.
 *
 * `this.id = 'x'`, `this.className = 'a b'`, `this.ariaLabel = 'Close'`, `this.hidden = true` are
 * all ordinary component code, and every one of them was a plain property here: the assignment
 * stuck to the object and never reached the markup, so the server and the client disagreed about
 * the element's own attributes. Generated from a table rather than written out, because there are
 * sixty of them and the ARIA half is pure repetition — the list is the specification, and adding
 * one is adding a name.
 *
 * `booleans` are present/absent (`hidden`), the rest carry their value. `role` and the `aria-*`
 * family are ordinary string reflections; `tabIndex` is a number that still round-trips as text.
 */
const dashedAria = (name) => `aria-${name.slice(4).toLowerCase()}`;

/** Plain strings: the attribute's value, or `''` when it is absent. */
const REFLECTED = {
  id: 'id',
  className: 'class',
  title: 'title',
  lang: 'lang',
  dir: 'dir',
  slot: 'slot',
  nonce: 'nonce',
  accessKey: 'accesskey',
  role: 'role',
  autocorrect: 'autocorrect',
};

/** The reflected strings declared `DOMString?`, which answer `null` rather than `''`. */
const NULLABLE_REFLECTED = new Set(['role']);

/**
 * **Enumerated reflections answer a *state*, not the attribute's text.** `inputmode="bogus"` reads
 * back as `''` in every engine, not `'bogus'`, and an absent attribute has its own answer that is
 * often different again — `autocapitalize` is `''` when missing and `'sentences'` when invalid. The
 * markup is unaffected either way (the attribute is stored verbatim, which is also what the engines
 * do), so this is only visible to a component that *reads* the property server-side — and that is
 * exactly the divergence that surfaces later as a hydration mismatch with nothing left to explain it.
 *
 * Every value here was measured on Chromium, Firefox and WebKit rather than read off a spec; all
 * three agree on all of it. `tests/browser/reflected-enumerations.test.js` records the measurement.
 * Two deliberate omissions:
 *
 * - **`spellcheck` is not here** — the engines genuinely disagree (an invalid value reads `true` in
 *   Chromium and WebKit, `false` in Firefox), so there is no single answer to match.
 * - **`autocorrect` is not here** for the same reason: Chromium does not implement it at all, and
 *   Firefox and WebKit answer a boolean rather than a string.
 *
 * `popover: 'hint'` is treated as known because the spec and two engines say so; WebKit does not
 * implement that state yet and clamps it to `'manual'`. Following the majority is the lesser wrong,
 * and it cannot affect markup.
 */
const ENUMERATED = {
  popover: [['auto', 'manual', 'hint'], null, 'manual'],
  autocapitalize: [['none', 'off', 'on', 'sentences', 'words', 'characters'], '', 'sentences'],
  enterKeyHint: [['enter', 'done', 'go', 'next', 'previous', 'search', 'send'], '', ''],
  inputMode: [['none', 'text', 'tel', 'url', 'email', 'numeric', 'decimal', 'search'], '', ''],
  writingSuggestions: [['true', 'false'], 'true', 'true'],
  virtualKeyboardPolicy: [['auto', 'manual'], '', ''],
};

/** The attribute each of them reflects. */
const ENUMERATED_ATTRIBUTES = {
  popover: 'popover',
  autocapitalize: 'autocapitalize',
  enterKeyHint: 'enterkeyhint',
  inputMode: 'inputmode',
  writingSuggestions: 'writingsuggestions',
  virtualKeyboardPolicy: 'virtualkeyboardpolicy',
};

/** `contentEditable` is enumerated too, and is the only one whose setter validates. */
const CONTENT_EDITABLE_STATES = ['true', 'false', 'plaintext-only'];

/** Present or absent. */
const REFLECTED_PRESENCE = { hidden: 'hidden', autofocus: 'autofocus', inert: 'inert' };

/**
 * A boolean in JavaScript, the words `true`/`false` in the markup — **each with its own default**,
 * because they do not share one. With the attribute absent a browser reports `draggable` as `false`
 * and `spellcheck` as `true`. One shared rule gave both `true`, so `draggable` was wrong on every
 * element that had not set it, and `spellcheck` was right by accident.
 */
const REFLECTED_TRUE_FALSE = { draggable: ['draggable', false], spellcheck: ['spellcheck', true] };

/** The one that spells its booleans differently. */
const REFLECTED_YES_NO = { translate: 'translate' };

/** A number in JavaScript, its digits in the markup. */
const REFLECTED_NUMBERS = { tabIndex: 'tabindex' };

/**
 * The tags that are focusable without a `tabindex`, and so report `tabIndex === 0` rather than `-1`.
 *
 * `tabIndex` had no default at all — every element answered `0`, which says "in the tab order" about
 * a `<div>` that is not in it. `element.tabIndex < 0` is the ordinary way to ask whether something
 * can be focused, so the server answered the opposite of the browser for the common case.
 *
 * `a` and `area` need an `href` to be focusable, and `audio`/`video` need `controls`. jsdom reports
 * `0` for a bare `<a>`, so a differential run against it will flag that one cell — the browsers are
 * right and jsdom is loose, which is the usual direction.
 */
const FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'details', 'iframe', 'summary']);
const CONDITIONALLY_FOCUSABLE = { a: 'href', area: 'href', audio: 'controls', video: 'controls' };

/**
 * `Node`'s numeric constants, and the measurements a box that was never laid out reports.
 *
 * Zero is what a browser returns for a detached element, so these are accurate rather than
 * convenient. `currentCSSZoom` is 1 for the same reason.
 */
export const NODE_CONSTANTS = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12,
  DOCUMENT_POSITION_DISCONNECTED: 1,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
};

const LAYOUT_ZEROS = [
  'clientWidth', 'clientHeight', 'clientLeft', 'clientTop',
  'offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop',
  'scrollWidth', 'scrollHeight', 'scrollLeftMax', 'scrollTopMax',
];

/**
 * Installs the generated accessors onto the shim's prototype.
 *
 * @param {typeof ElementShim} Shim
 */
const defineReflections = (Shim) => {
  for (const name of LAYOUT_ZEROS) Object.defineProperty(Shim.prototype, name, { value: 0, writable: true, configurable: true });
  /** Scroll offsets are writable and read back, which is what a scroll-restoring component does. */
  for (const name of ['scrollLeft', 'scrollTop'])
    Object.defineProperty(Shim.prototype, name, { value: 0, writable: true, configurable: true });
  Object.defineProperty(Shim.prototype, 'currentCSSZoom', { value: 1, configurable: true });
  /**
   * **It follows the `contentEditable` *state*, not the attribute's text.** Comparing the raw
   * attribute to `'true'` answered `false` for `plaintext-only`, for an empty attribute and for
   * `TRUE` — all three of which are editable in Chromium and Firefox whether the element is in the
   * document or not, and in WebKit once it is.
   *
   * WebKit's answer for a *detached* element is unstable — it flips depending on whether an
   * attached editable element happens to exist elsewhere in the document — so it is not evidence
   * about the mapping. The mapping itself is unanimous.
   */
  Object.defineProperty(Shim.prototype, 'isContentEditable', {
    get() {
      const state = this.contentEditable;
      return state === 'true' || state === 'plaintext-only';
    },
    configurable: true,
  });
  for (const [property, attribute] of Object.entries(REFLECTED)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        /**
         * **`role` and `popover` are nullable and the rest are not.** Both are declared `DOMString?`,
         * so a browser answers `null` when the attribute is absent where `id` and `title` answer
         * `''`. Returning `''` for `role` made `element.role === null` false on every element that
         * had never been given one — a test a component writes to mean "this has no explicit role".
         */
        return this.getAttribute(attribute) ?? (NULLABLE_REFLECTED.has(property) ? null : '');
      },
      set(value) {
        this.setAttribute(attribute, value);
      },
      configurable: true,
    });
  }
  for (const [property, attribute] of Object.entries(ENUMERATED_ATTRIBUTES)) {
    const [known, missing, invalid] = ENUMERATED[property];
    Object.defineProperty(Shim.prototype, property, {
      get() {
        const raw = this.getAttribute(attribute);
        if (raw === null) return missing;
        /** Enumerated attributes are ASCII case-insensitive and the getter answers canonically. */
        const state = raw.toLowerCase();
        return known.includes(state) ? state : invalid;
      },
      /** The setter writes what it is given; only the getter maps to a state. */
      set(value) {
        this.setAttribute(attribute, value);
      },
      configurable: true,
    });
  }
  /**
   * **`contentEditable` is the one whose setter validates.** Every engine throws a `SyntaxError`
   * for a value outside the three states, lowercases what it accepts, and treats `'inherit'` as
   * "remove the attribute" rather than a value to write. An empty string throws — it is not the
   * same as `'inherit'`, though the attribute *being* empty reads back as `'true'`.
   */
  Object.defineProperty(Shim.prototype, 'contentEditable', {
    get() {
      const raw = this.getAttribute('contenteditable');
      if (raw === null) return 'inherit';
      const state = raw.toLowerCase();
      if (state === '') return 'true';
      return CONTENT_EDITABLE_STATES.includes(state) ? state : 'inherit';
    },
    set(value) {
      const state = `${value}`.toLowerCase();
      if (state === 'inherit') {
        this.removeAttribute('contenteditable');
        return;
      }
      if (!CONTENT_EDITABLE_STATES.includes(state))
        throw new DOMException(
          `Failed to set the 'contentEditable' property on 'HTMLElement': The value provided ` +
            `('${value}') is not one of 'true', 'false', 'plaintext-only' or 'inherit'.`,
          'SyntaxError'
        );
      this.setAttribute('contenteditable', state);
    },
    configurable: true,
  });
  for (const [property, attribute] of Object.entries(REFLECTED_PRESENCE)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return this.hasAttribute(attribute);
      },
      set(value) {
        if (value) this.setAttribute(attribute, '');
        else this.removeAttribute(attribute);
      },
      configurable: true,
    });
  }
  for (const [words, table] of [
    [['true', 'false'], REFLECTED_TRUE_FALSE],
    [['yes', 'no'], REFLECTED_YES_NO],
  ]) {
    for (const [property, entry] of Object.entries(table)) {
      /** `['attribute', default]` where the default differs per property; a bare string means `true`. */
      const [attribute, fallback] = Array.isArray(entry) ? entry : [entry, true];
      Object.defineProperty(Shim.prototype, property, {
        get() {
          const written = this.getAttribute(attribute);
          return written === null ? fallback : written !== words[1];
        },
        set(value) {
          this.setAttribute(attribute, value ? words[0] : words[1]);
        },
        configurable: true,
      });
    }
  }
  for (const [property, attribute] of Object.entries(REFLECTED_NUMBERS)) {
    Object.defineProperty(Shim.prototype, property, {
      get() {
        const written = this.getAttribute(attribute);
        if (written !== null) return Number(written);
        const conditional = CONDITIONALLY_FOCUSABLE[this.localName];
        return FOCUSABLE.has(this.localName) || (conditional && this.hasAttribute(conditional)) ? 0 : -1;
      },
      set(value) {
        this.setAttribute(attribute, Number(value));
      },
      configurable: true,
    });
  }
  for (const property of ARIA_PROPERTIES) {
    const attribute = dashedAria(property);
    Object.defineProperty(Shim.prototype, property, {
      get() {
        return this.getAttribute(attribute);
      },
      set(value) {
        if (value == null) this.removeAttribute(attribute);
        else this.setAttribute(attribute, value);
      },
      configurable: true,
    });
  }
};

/**
 * The ARIA reflection family, named once. Each is `aria-` plus the rest, lowercased —
 * `ariaValueMax` is `aria-valuemax` — with no exceptions in the set a component uses.
 */
const ARIA_PROPERTIES = [
  'ariaAtomic', 'ariaAutoComplete', 'ariaBrailleLabel', 'ariaBrailleRoleDescription', 'ariaBusy',
  'ariaChecked', 'ariaColCount', 'ariaColIndex',
  'ariaColIndexText', 'ariaColSpan', 'ariaCurrent', 'ariaDescription', 'ariaDisabled',
  'ariaExpanded', 'ariaHasPopup', 'ariaHidden', 'ariaInvalid', 'ariaKeyShortcuts', 'ariaLabel',
  'ariaLevel', 'ariaLive', 'ariaModal', 'ariaMultiLine', 'ariaMultiSelectable', 'ariaOrientation',
  'ariaPlaceholder', 'ariaPosInSet', 'ariaPressed', 'ariaReadOnly', 'ariaRelevant', 'ariaRequired',
  'ariaRoleDescription', 'ariaRowCount', 'ariaRowIndex', 'ariaRowIndexText', 'ariaRowSpan',
  'ariaSelected', 'ariaSetSize', 'ariaSort', 'ariaValueMax', 'ariaValueMin', 'ariaValueNow',
  'ariaValueText',
];

/**
 * A component's own `attributeChangedCallback`, when it declared one.
 *
 * Read through a cast rather than declared as a field: a field in this base class would be an own
 * property set to `undefined`, which shadows the subclass's method and silently switches observed
 * attributes back off — the very thing this exists to deliver.
 *
 * @param {ElementShim} element
 * @return {((name: string, previous: string | null, value: string | null) => void) | undefined}
 */
const observerOf = (element) =>
  /** @type {{ attributeChangedCallback?: (name: string, previous: string | null, value: string | null) => void }} */ (
    element
  ).attributeChangedCallback;

export class ElementShim extends ContainerShim {
  constructor(localName = '', namespaceURI = HTML_NS) {
    super();
    this._ns = namespaceURI;
    this.localName = localName;
    this.isConnected = true;
    this._attributes = new Map();
    this.innerHTML = '';
    this._shadowRoot = null;
    /**
     * The bytes this element's own tags were parsed from, when it came from markup rather than
     * `createElement`. Declared here so every element has the same shape — and so a type-checker
     * knows about a field the parser is what assigns.
     */
    this._sourceOpenTag = /** @type {string | null} */ (null);
    this._sourceCloseTag = /** @type {string | null} */ (null);
  }
  /** @override */
  get namespaceURI() {
    return this._ns;
  }
  /**
   * An attribute name as this element stores it.
   *
   * A browser lower-cases the name inside `setAttribute` on an HTML element, so `setAttribute('Data-Flag', '1')`
   * and `getAttribute('data-flag')` are the *same* attribute. Storing the name as written made them two,
   * and a component that set one spelling and read another got `null` on the server and `'1'` in the
   * browser — a lifecycle divergence with no symptom until the two renders disagreed. Worse, an
   * attribute handed in as `{ 'User-ID': … }` never matched an `observedAttributes` entry, so
   * `attributeChangedCallback` simply did not fire.
   */
  _name(name) {
    /**
     * **Template coercion, not `String()`** — the difference is a symbol, which `String()` answers
     * `'Symbol(s)'` for and which every engine refuses with a `TypeError` (recorded across all
     * three in `tests/browser/dom-string-coercion.test.js`). Being the lenient one server-side
     * only moves the failure to the client with the context stripped off.
     */
    return this._ns === HTML_NS ? `${name}`.toLowerCase() : `${name}`;
  }
  /**
   * **`mode: 'closed'` means `element.shadowRoot` is `null`** — that is the entire difference between
   * the two modes, and it was not honoured: a closed root was handed straight back, so a component
   * guarding on `this.shadowRoot` took the branch the browser will not, and anything holding the
   * element could reach inside a root the platform hides. The root is kept on `_shadowRoot`, because
   * it still has to be serialized — declarative shadow DOM expresses `closed` perfectly well
   * (`<template shadowrootmode="closed">`) and the client's parser re-creates it just as hidden.
   */
  get shadowRoot() {
    return this._shadowRoot?.mode === 'closed' ? null : this._shadowRoot;
  }
  /**
   * Both refusals are the platform's. `mode` is a required member, and an element that already has
   * a root raises `NotSupportedError` rather than getting a second one — which matters here because
   * silently replacing the first root discards everything rendered into it, on the server only.
   * `@verajs/core` already guards against calling this twice *because* the browser throws; the shim
   * accepting it meant the server was the one place that guard was not being checked.
   */
  attachShadow(init = {}) {
    if (init.mode !== 'open' && init.mode !== 'closed')
      throw new TypeError("Failed to execute 'attachShadow' on 'Element': Failed to read the 'mode' property from 'ShadowRootInit': Required member is undefined.");
    if (this._shadowRoot)
      throw new DOMException(
        "Failed to execute 'attachShadow' on 'Element': Shadow root cannot be created on a host which already hosts a shadow tree.",
        'NotSupportedError'
      );
    this._shadowRoot = new ShadowRootShim(init);
    this._shadowRoot._host = this;
    return this._shadowRoot;
  }
  getAttribute(name) {
    name = this._name(name);
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }
  setAttribute(name, value) {
    name = this._name(name);
    /**
     * **A name the platform refuses is refused here**, because the alternative is worse than a
     * throw: `setAttribute('a b', v)` wrote `a b="v"` into the tag, which a parser reads back as
     * *two* attributes, so the server and the client disagreed about the element's own attributes
     * and the browser threw `InvalidCharacterError` on the same call anyway.
     */
    if (name === '' || UNUSABLE_IN_A_NAME.test(name))
      throw new DOMException(
        `Failed to execute 'setAttribute' on 'Element': '${name}' is not a valid attribute name.`,
        'InvalidCharacterError'
      );
    const previous = this.getAttribute(name);
    this._attributes.set(name, `${value}`);
    this._attributeChanged(name, previous);
  }
  hasAttribute(name) {
    return this._attributes.has(this._name(name));
  }
  /**
   * `force` decides, and when the attribute is already in the wanted state **nothing happens** —
   * no write, no callback. This used to reset the value to `''` on `toggleAttribute(name, true)`
   * for an attribute that was already there, which silently erased it.
   */
  toggleAttribute(name, force) {
    name = this._name(name);
    if (name === '' || UNUSABLE_IN_A_NAME.test(name))
      throw new DOMException(
        `Failed to execute 'toggleAttribute' on 'Element': '${name}' is not a valid attribute name.`,
        'InvalidCharacterError'
      );
    const present = this._attributes.has(name);
    const wanted = force ?? !present;
    if (wanted === present) return wanted;
    if (wanted) this._attributes.set(name, '');
    else this._attributes.delete(name);
    this._attributeChanged(name, wanted ? null : this.getAttribute(name));
    return wanted;
  }

  /**
   * Upgrade, the way the parser does it: `attributeChangedCallback` fires once per **present**
   * observed attribute, before `connectedCallback`, with a `null` old value.
   *
   * It never fired at all on the server. `attributeChangedCallback` is the only reactive-attribute
   * mechanism a plain custom element has, so a component that derives its state there rendered
   * its *initial* state into the page and then corrected itself on the client — a hydration
   * mismatch on every such component, and a flash of the wrong content for anyone without JS.
   */
  upgrade() {
    this._observed = /** @type {{ observedAttributes?: string[] }} */ (this.constructor).observedAttributes;
    this._upgraded = true;
    const changed = observerOf(this);
    if (!this._observed || !changed) return;
    for (const name of this._observed) {
      const value = this.getAttribute(name);
      if (value !== null) changed.call(this, name, null, value);
    }
  }

  /**
   * And it keeps firing afterwards, because a browser does: a component that changes its own
   * attribute during a render sees the callback on the client and must see it here.
   *
   * Guarded on `_upgraded` first, which is the common case for the renderer's attribute writes —
   * an element mid-upgrade has no observers yet, and one that observes nothing never reaches the
   * `includes`.
   */
  _attributeChanged(name, previous) {
    /**
     * **A written element stops being its source text.** A parsed element serves the bytes it came
     * from so a parse can reproduce the page exactly; the moment an attribute changes, those bytes
     * are stale and canonical output takes over. Every write — `setAttribute`, `removeAttribute`,
     * `toggleAttribute` — arrives here, which is why this is the only place it has to be said.
     */
    this._sourceOpenTag = null;
    if (!this._upgraded || !this._observed?.includes(name)) return;
    /**
     * Fired even when the value did not change, because a browser does: `setAttribute` runs the
     * attribute-change steps unconditionally. Only a *no-op* — removing what was not there,
     * toggling to the state it is already in — is silent, and those never reach here.
     */
    observerOf(this)?.call(this, name, previous, this.getAttribute(name));
  }
  /** Enough of a `NamedNodeMap` to iterate, which is what component code does with it. */
  /**
   * An array rather than a live `NamedNodeMap` — already a recorded difference, since there is
   * nothing to be live over in a single render pass. **The map's own methods are on it**, though:
   * `attributes.getNamedItem('x')` is how a good deal of existing code reads an attribute, and it
   * was simply missing, so that code got a `TypeError` on the server and worked in a browser.
   */
  get attributes() {
    return namedNodeMap(this);
  }
  getAttributeNames() {
    return [...this._attributes.keys()];
  }

  /**
   * `this.dataset.x = 'y'` and `this.style.color = 'red'` both change the markup, so both write
   * through to the attribute they are a view of. A plain object would accept the assignment and
   * lose it.
   */
  get dataset() {
    return datasetView(this);
  }
  get style() {
    return styleView(this);
  }
  removeAttribute(name) {
    name = this._name(name);
    if (!this._attributes.has(name)) return;
    const previous = this.getAttribute(name);
    this._attributes.delete(name);
    this._attributeChanged(name, previous);
  }

  /**
   * The rest of the surface an ordinary custom element reaches for.
   *
   * The shim was built as "the smallest DOM core's server path touches", which is the wrong bar:
   * the code that runs here is *user* code, and a component that emits an event, reads its
   * `tagName`, or adds a class in `connectedCallback` is doing nothing unusual. Each of these threw
   * a `TypeError` that took the whole render down — measured: `dispatchEvent`, `ownerDocument`,
   * `tagName`, `children`, `classList`, `closest` and `getRootNode`, all of them.
   *
   * They answer the way a detached, childless element would, because that is what this is.
   */
  get tagName() {
    return this.localName.toUpperCase();
  }
  get nodeType() {
    return 1;
  }
  get nodeName() {
    return this.tagName;
  }
  /** Walks the real parent chain, which exists now that children are nodes. */
  closest(selector) {
    return select.closest(this, selector);
  }
  matches(selector) {
    return select.matches(this, selector);
  }
  /**
   * **A no-op until nodes were retained** — an appended child had been flattened into its parent's
   * markup, so there was no parent to ask and nothing to take out. It silently left the element on
   * the page.
   */
  remove() {
    this._parent?.removeChild(this);
  }
  /**
   * Backed by the `class` attribute, so a class added during `connectedCallback` reaches the
   * markup — which it now can, because the opening tag is written from these attributes rather
   * than copied from the source text.
   */
  get classList() {
    return tokenListView(this, 'class');
  }
  /** `[PutForwards=value]`, for the same reason as `part`. */
  set classList(value) {
    this.setAttribute('class', value);
  }

  /**
   * What a **detached, childless** element answers.
   *
   * Every one of these is the truthful answer for this element, not a placeholder: an element with
   * no parent has no siblings and no parent, an element outside a document has no box, and a
   * childless one contains nothing. A browser returns exactly these values for a detached element.
   * They are here because their *absence* was a `TypeError` that took the whole render down —
   * `this.parentElement && …` is ordinary defensive code and it crashed.
   */

  /** No layout on a server, and none for a detached element in a browser either. */
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  }
  getClientRects() {
    return [];
  }
  checkVisibility() {
    return false;
  }
  /**
   * **The collection queries answer from the tree.** Each returned an empty array whatever the tree
   * held — the same placeholder shape `querySelector` had, and just as silent. They are live
   * `HTMLCollection`s in a browser and plain arrays here, which is already recorded as a deliberate
   * difference: there is nothing to be live *over* while a render is a single pass.
   */
  getElementsByTagName(name) {
    parseChunks(this);
    const wanted = `${name}`.toLowerCase();
    return select.descendantsOf(this).filter((element) => wanted === '*' || element.localName === wanted);
  }
  getElementsByTagNameNS(namespace, name) {
    parseChunks(this);
    const wanted = `${name}`.toLowerCase();
    const ns = `${namespace}`;
    return select
      .descendantsOf(this)
      .filter(
        (element) =>
          (wanted === '*' || element.localName === wanted) && (ns === '*' || element.namespaceURI === ns)
      );
  }
  getElementsByClassName(names) {
    parseChunks(this);
    const wanted = `${names}`.split(/\s+/u).filter(Boolean);
    if (!wanted.length) return [];
    return select.descendantsOf(this).filter((element) => {
      const has = (element.getAttribute('class') ?? '').split(/\s+/u);
      return wanted.every((one) => has.includes(one));
    });
  }
  /**
   * Namespaces collapse to the plain attribute methods. This DOM serializes HTML, where an
   * `xml:lang` or `xlink:href` is one attribute with a colon in its name — which is how the
   * serializer already treats it, and how the markup reads it back.
   */
  getAttributeNS(_namespace, name) {
    return this.getAttribute(name);
  }
  setAttributeNS(_namespace, name, value) {
    this.setAttribute(name, value);
  }
  hasAttributeNS(_namespace, name) {
    return this.hasAttribute(name);
  }
  removeAttributeNS(_namespace, name) {
    this.removeAttribute(name);
  }
  hasAttributes() {
    return this._attributes.size > 0;
  }
  getAttributeNode(name) {
    return this.hasAttribute(name) ? { name, value: this.getAttribute(name) } : null;
  }
  getAttributeNodeNS(_namespace, name) {
    return this.getAttributeNode(name);
  }
  setAttributeNode(node) {
    this.setAttribute(node.name, node.value);
    return null;
  }
  setAttributeNodeNS(node) {
    return this.setAttributeNode(node);
  }
  removeAttributeNode(node) {
    this.removeAttribute(node.name);
    return node;
  }
  /** Aliases the engines still carry. */
  webkitMatchesSelector() {
    return false;
  }
  mozMatchesSelector() {
    return false;
  }
  /**
   * Interaction, which a server has none of — but the calls are ordinary and must not throw.
   *
   * `click()` is the exception: it *dispatches an event*, and now that listeners are real, a
   * component that clicks itself to seed its own state gets the same result on both sides.
   */
  focus() {}
  blur() {}
  click() {
    this.dispatchEvent(new globalThis.Event('click', { bubbles: true, cancelable: true, composed: true }));
  }
  scrollIntoView() {}
  scroll() {}
  scrollTo() {}
  scrollBy() {}

  /**
   * `insertAdjacent*` at the two positions that do not need a parent.
   *
   * `beforebegin` and `afterend` place content *beside* this element, which requires the parent
   * this element does not have. They are refused rather than silently dropped — putting content
   * nowhere is the failure this whole file keeps being audited for.
   *
   * **A markup sink, deliberately** (CODE-PRINCIPLES #8). It writes what it is given, exactly as
   * the DOM's own `insertAdjacentHTML` does, because a component calling it has already decided
   * that: the same call on the client is the same sink, and a server that escaped where the browser
   * does not would render one page and hydrate into another. `insertAdjacentText` escapes, which is
   * the difference between the two methods and the one to reach for with anything from a request.
   */
  insertAdjacentHTML(position, markup) {
    const where = `${position}`.toLowerCase();
    if (where === 'afterbegin' || where === 'beforeend') {
      if (where === 'afterbegin') this._entries.unshift(`${markup}`);
      else this._entries.push(`${markup}`);
      /** New markup has not been looked at yet. */
      this._parsed = false;
    }
    else if (where !== 'beforebegin' && where !== 'afterend')
      throw new DOMException(
        `Failed to execute 'insertAdjacentHTML' on 'Element': The value provided ` +
          `('${position}') is not one of 'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.`,
        'SyntaxError'
      );
    else
      throw new Error(
        `ssr: insertAdjacentHTML('${position}') needs a parent element, and a server-rendered ` +
          `component has none. Use 'afterbegin' or 'beforeend'.`
      );
  }
  insertAdjacentText(position, text) {
    this.insertAdjacentHTML(position, escapeHtml(text));
  }
  insertAdjacentElement(position, element) {
    this.insertAdjacentHTML(position, serializeElement(element));
    return element;
  }
  /** The element's own markup, which the serializer builds anyway. */
  get outerHTML() {
    return serializeElement(this);
  }
  /**
   * **Replaces this element in its parent with the given markup.** Assigning it used to be a
   * `TypeError` — there was no setter — so `element.outerHTML = '<p>x</p>'`, an ordinary way to swap
   * a node out, did nothing on the server and worked in the browser.
   *
   * **With no parent it returns silently**, which is what the spec says and what all three engines
   * do — measured, because the obvious guess was a `NoModificationAllowedError` and that is wrong:
   * the spec raises it only when the parent is a *Document*, not when there is no parent at all.
   */
  set outerHTML(markup) {
    const parent = this._parent;
    if (!parent) return;
    parent._entries.splice(parent._entries.indexOf(this), 1, `${markup}`);
    parent._parsed = false;
    this._parent = null;
  }
  get innerText() {
    return this.textContent;
  }
  /**
   * **A line break becomes a `<br>`, which is the whole difference from `textContent`.** Every
   * engine splits the assigned string on `\r\n`, `\r` and `\n` and joins the escaped pieces with
   * `<br>`; assigning through `textContent` instead left a literal newline, which collapses to a
   * single space when the page is laid out. So a component that set `innerText` rendered its lines
   * run together on the server and correctly broken on the client — a visible difference in the
   * markup itself, not merely in what a property reads back.
   *
   * Measured on Chromium, Firefox and WebKit, attached and detached, in
   * `tests/browser/inner-text.test.js`.
   */
  set innerText(value) {
    this.innerHTML = `${value}`.split(/\r\n|[\r\n]/u).map(escapeHtml).join('<br>');
  }
  /** `part` is a token list over the `part` attribute, exactly as `classList` is over `class`. */
  get part() {
    return tokenListView(this, 'part');
  }
  /**
   * **Assignable, because the IDL says `[PutForwards=value]`.** Both `part` and `classList` are
   * declared that way, so `element.part = 'a b'` is a legal operation in every engine and writes
   * the attribute. A getter with no setter made it a `TypeError` here instead — a server that
   * refuses what the browser performs, which is the same failure as being too permissive with the
   * direction reversed.
   */
  set part(value) {
    this.setAttribute('part', value);
  }

  /**
   * Form-associated custom elements.
   *
   * `attachInternals()` not existing meant `static formAssociated = true` — the standard way to
   * write a custom form control — threw during `connectedCallback` and took the page with it. None
   * of what internals carry reaches markup (form value, validity and implicit ARIA are all
   * internal state), so this is inert by design rather than by omission: the component runs, and
   * the client's real internals take over on hydration.
   */
  attachInternals() {
    /**
     * **Only a custom element has internals.** Every engine raises `NotSupportedError` for a plain
     * element, because `ElementInternals` is the mechanism by which a *defined* element joins a form
     * — there is nothing for a `<div>` to attach. Allowing it here meant a call that cannot work in
     * a browser worked on the server, which is the leniency this DOM exists not to have.
     */
    if (!registry.has(this.localName))
      throw new DOMException(
        `Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to non-custom elements.`,
        'NotSupportedError'
      );
    /** A second call raises `NotSupportedError` in every engine; returning the first set hid that. */
    if (internals.has(this))
      throw new DOMException(
        `Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the specified element was already attached.`,
        'NotSupportedError'
      );
    internals.set(this, {
      shadowRoot: this._shadowRoot,
      form: null,
      labels: [],
      willValidate: true,
      validity: { valid: true },
      validationMessage: '',
      states: new Set(),
      setFormValue: () => {},
      setValidity: () => {},
      checkValidity: () => true,
      reportValidity: () => true,
    });
    return internals.get(this);
  }

  /**
   * The element's own opening tag, written from the attributes it holds **now**.
   *
   * Copying the source text instead meant everything a component did to itself during
   * `connectedCallback` was thrown away: `setAttribute('role', 'button')`, a class, an `aria-*` —
   * present on the client after hydration, absent in the server markup, so the two disagreed on
   * every one.
   */
  /**
   * **A copy that shares nothing.** The reason this was out of scope was that a copy sharing the
   * markup string would alias it; entries are an array now, so a deep clone copies them. The source
   * text rides along, so a cloned subtree still reproduces the markup it was parsed from.
   */
  cloneNode(deep = false) {
    const copy = createElement(this.localName, this._ns);
    for (const [name, value] of this._attributes) copy.setAttribute(name, value);
    copy._sourceOpenTag = this._sourceOpenTag;
    copy._sourceCloseTag = this._sourceCloseTag;
    if (!deep) return copy;
    for (const entry of this._entries) {
      if (typeof entry === 'string') copy._entries.push(entry);
      else {
        const child = entry.cloneNode(true);
        child._parent = copy;
        copy._entries.push(child);
      }
    }
    copy._parsed = this._parsed;
    return copy;
  }
  /** This element's own markup, end tag included — the call every node kind answers. */
  /**
   * A `<slot>` shows the host's children that name it; see `assignedTo`.
   *
   * **Getters returning `undefined` off a slot**, because these live on `HTMLSlotElement` and this
   * DOM has one element class. Defining them as plain methods put them on every element, where
   * `typeof element.assignedNodes === 'function'` — the ordinary way to ask "is this a slot" —
   * answered yes for a `<div>`. Being present where the platform has nothing is the same kind of
   * divergence as answering wrongly, and it is the one a feature check walks straight into.
   */
  get assignedNodes() {
    if (this.localName !== 'slot') return undefined;
    return (options) => assignedTo(this, options);
  }
  get assignedElements() {
    if (this.localName !== 'slot') return undefined;
    return (options) => assignedTo(this, options).filter((node) => node.nodeType === 1);
  }
  markup() {
    return serializeElement(this);
  }
  openTag() {
    /**
     * **The bytes it was parsed from**, until something writes to it. That is what lets a parsed
     * tree reproduce its own markup exactly — quoting style, entity spelling, attribute order and
     * interior whitespace included — instead of normalising the page as a side effect of somebody
     * reading `children`.
     */
    if (this._sourceOpenTag) return this._sourceOpenTag;
    let out = `<${this.localName}`;
    for (const [name, value] of this._attributes) out += ` ${name}="${escapeHtml(value)}"`;
    return out + '>';
  }

  /**
   * Tags stripped and the escaping undone, so what goes in comes back out.
   *
   * Reading back what `textContent` had just written returned `&#60;b&#62;` for `<b>` — the setter
   * escapes and the getter did not decode, so the round trip a component may reasonably rely on was
   * broken. Only the numeric references the setter emits need undoing; anything else in there came
   * from author markup and is text as written.
   */
  get textContent() {
    return textOf(this);
  }
  /**
   * Escaped for an ordinary element, stored as-is for a raw-text one.
   *
   * `@verajs/styles` sets a `<style>` element's `textContent` to the stylesheet, and escaping it
   * turned every `>` into `&#62;` and every `"` into `&#34;`. A browser does not decode those inside
   * `<style>`, so a component with `static styles = '.a > .b { … }'` shipped a broken stylesheet —
   * every child selector, every attribute selector, every `content: "…"`. The client never had it:
   * there, `textContent` sets real text and the serializer of a raw-text element emits it verbatim.
   */
  /**
   * **`null` and `undefined` are the empty string, not their own names.** `textContent` is a
   * nullable `DOMString` with `[LegacyNullToEmptyString]`, and WebIDL converts `undefined` to `null`
   * for a nullable type — so both erase the content in every engine. This wrote the text `null`,
   * which meant `this.textContent = maybeMissing` put the word on the page server-side and nothing
   * client-side: a hydration mismatch produced by ordinary defensive code.
   */
  set textContent(value) {
    const text = value == null ? '' : value;
    this.innerHTML = RAW_TEXT_ELEMENTS.has(this.localName) ? String(text) : escapeHtml(text);
  }
}

/**
 * `document.createElement('my-comp')` builds **the component**, not a blank element.
 *
 * A browser upgrades a known tag as it creates it, so the class's constructor runs and its field
 * initialisers are in place before anyone touches the element. This returned a bare `ElementShim`,
 * so a component created imperatively had none of its own state, and `instanceof` said no.
 */
/**
 * A fresh element carrying the properties its tag actually has — `input.disabled`, `a.href` — as
 * well as the ones every element shares. See `reflections.js`; without this an assignment to an
 * element-specific property became a plain JavaScript property that reached no markup at all.
 *
 * Only HTML elements get one. An SVG element's properties are a different interface again, and
 * guessing at them is what this whole file exists not to do.
 */
const build = (name, namespaceURI = HTML_NS) => {
  const Element = namespaceURI === HTML_NS ? interfaceFor(name, ElementShim) : ElementShim;
  return new Element(name, namespaceURI);
};

export const createElement = (localName, namespaceURI = HTML_NS) => {
  const name = namespaceURI === HTML_NS ? `${localName}`.toLowerCase() : `${localName}`;
  /**
   * **A tag name that cannot be written is refused**, as it is in every engine. Accepting one meant
   * `createElement('a b')` serialized `<a b>` — an element `a` with an empty attribute `b` once a
   * parser sees it — and `createElement('')` produced `<>`. Both render markup no browser would
   * have produced from the same call, which is the one thing this DOM exists not to do.
   */
  if (name === '' || UNUSABLE_IN_A_TAG.test(name))
    throw new DOMException(
      `Failed to execute 'createElement' on 'Document': The tag name provided ('${name}') is not a valid name.`,
      'InvalidCharacterError'
    );
  const Component = registry.get(name);
  if (!Component) return build(name, namespaceURI);
  const element = new Component();
  element.localName = name;
  element._ns = namespaceURI;
  return element;
};

/**
 * Instances handed to `appendChild` before they have rendered, so the scan renders **them** rather
 * than a fresh copy built from their markup.
 *
 * The nested-component scan reads emitted markup and instantiates what it finds, which is right for
 * a tag written in a template and wrong for an element the component built itself: everything
 * assigned to it — `kid.rows = data`, the ordinary way to hand structured data to a child — was
 * lost, because an attribute cannot carry it and a fresh instance never saw it. The marker attribute
 * is the handle, and `renderComponent` removes it as it renders.
 */
export const pendingInstances = new Map();

/**
 * The marker's **name** carries a per-process random token, because the markup it is written into is
 * not all ours.
 *
 * `children` and the string form of `attributes` are raw markup by design, so a caller passing
 * request data through either hands an attacker a way to write attributes into this document. With a
 * fixed name, injected markup could claim a component's prepared instance — and win, because it is
 * already in the markup when the real one is appended, and the scan reads in order. Demonstrated: an
 * injected `<x-y vera-ssr-instance="1">` rendered with the parent's data while the parent's own
 * child fell back to defaults. A name nothing outside this module can guess closes it, and
 * `renderComponent` also refuses a marker whose instance is not the tag being rendered.
 *
 * Import-time rather than per-render: an attacker cannot read either, and the output never contains
 * the marker, so nothing observable depends on it.
 */
export const INSTANCE_ATTRIBUTE = `vera-ssr-${randomUUID()}`;

let instanceCount = 0;

/** One `ElementInternals` per element, as `attachInternals` guarantees. */
const internals = new WeakMap();

/**
 * Installed once, here, because both are properties of *every* node of their kind rather than of any
 * one of them — and generating them beats sixty hand-written accessors that go stale.
 */
defineReflections(ElementShim);
/** `Node`'s constants are on every node, so they go on the shared base. */
Object.assign(ContainerShim.prototype, NODE_CONSTANTS);
