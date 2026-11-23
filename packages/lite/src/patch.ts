/**
 * **The lite tier's renderer: values patched in place.** A template is prepared once per call site (its `strings`
 * array): its HTML with a marker per hole, parsed into a `<template>`, walked once for where each hole is. Each instance
 * clones it and binds one part per hole; a render writes only what changed. Holes: text, attribute (whole or partial),
 * `?bool`, `.prop`, `!live`, `@event`, a nested template, an array (unkeyed, reused by index). The full tier's (`@verajs/core` + `@verajs/renderer`) template semantics,
 * with core's refusals (`markup.ts`); keyed lists, spread, refs and hydration are core's alone.
 */
import { JSON_BLOCK, SCRIPT_URL, SHARED, checkForeign, closedRawText, landing, misuse } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { IN_TAG, RAW, SCRIPT_START, TEXT_MARK, TEXT_MARKS, TEXT_ONLY, VALUE_MARK, WRITTEN_NAME, genuine, onlyCore, refusedName, sayAttributeValue, sayBooleanChild, sayListener, sayRefused, sayScriptUrl, urlCheck } from './markup.js';
import type { TemplateResult, LiteRoot } from './types.js';

/**
 * Development: lite's sentence in the wrong-namespace advice (`checkForeign`), on another way to the right namespace —
 * there is none here but the tag (core's renderer can parse a template where it lands).
 */
const RETAG = ' (lite parses a template by its tag alone)';
/** A hole's name for a hole that is its element's only child (`solePart`). */
const SOLE = '';
/** A hole's name for a text-only element's content (`textPart`): `title`, `textarea`, `style`, a JSON data block. */
const TEXT = '\u0003';

/** A part: commits the value(s) starting at `at`. */
type Part = (values: readonly unknown[], at: number) => void;
/**
 * A hole: the PATH to its node from the template's root (per level, how many `nextSibling` hops after `firstChild`), its
 * attribute name as written (`null` for a range, `SOLE` for an only child), its statics, the index of its first value.
 */
type Hole = [path: number[], name: string | null, statics: string[] | null, at: number];
/**
 * A prepared template: the root every instance clones, its holes, whether it holds no custom element (`plain`), and
 * whether the root is the `<template>` element itself (`wrapped`: the server's DOM, which has no template content).
 */
type Prepared = [root: Node, holes: Hole[], plain: boolean, wrapped: boolean];
/**
 * A list item: its first and last nodes, which stay for its life, and what it shows — a template instance (its strings,
 * parts and holes), a text node (neither; `_value` is the value it last wrote), or a nested list (a range between two
 * comments of its own).
 */
type Item = { _first: Node; _last: Node; _strings?: TemplateStringsArray; _parts?: Part[]; _holes?: Hole[]; _range?: Part; _value?: unknown };

/**
 * Module state: each call site's prepared template, by its `strings` array, built once. Shared because every component
 * rendering a call site reuses its preparation; weak, so a call site's module unloading frees it.
 */
const prepared = new WeakMap<TemplateStringsArray, Prepared>();

/** The path from `root` to `node`: per level down, the hops from the parent's first child. */
const pathTo = (node: Node, root: Node) => {
  const path: number[] = [];
  for (; node !== root; node = node.parentNode!) {
    let hops = 0;
    for (let sibling = node.previousSibling; sibling !== null; sibling = sibling.previousSibling) hops++;
    path.unshift(hops);
  }
  return path;
};

const refuse = () => {
  throw new TypeError(misuse('html', 'tier-hole-position', __DEV__ && PROSE['tier-hole-position']()));
};

/**
 * Lands hole `at`: once, and of its kind (`text`, a text hole's marker; else a value hole's), or the template is refused —
 * an author's marker-shaped text standing in for a hole the parser lost is a duplicate, out of range, or the wrong kind.
 * `written[at]` is `null` exactly for a text hole (`prepare`).
 */
const land = (at: number, seen: boolean[], written: (string | null)[], text: boolean) => {
  if (seen[at] !== false || (written[at] === null) !== text) refuse();
  seen[at] = true;
  return at;
};

/**
 * `data` split by its markers (`marks` captures each hole's index), in one pass: every hole landed (`land`), and the
 * statics around them with the first hole's index (-1: none).
 */
const mark = (data: string, marks: RegExp, seen: boolean[], written: (string | null)[]): [statics: string[], first: number] => {
  const pieces = data.split(marks);
  const statics: string[] = [];
  let first = -1;
  for (let i = 0; i < pieces.length; i++)
    if (i % 2 === 0) statics.push(pieces[i]!);
    else {
      const at = land(+pieces[i]!, seen, written, marks === TEXT_MARKS);
      if (first === -1) first = at;
    }
  return [statics, first];
};

/** A hole found while checking: its node, its name (`null` a range, `SOLE`, `TEXT`, or an attribute's), its statics, its first value. */
type Found = [node: Node, name: string | null, statics: string[] | null, at: number];

/**
 * **Checks every hole under `parent`, the template's first parse only** — each must land EXACTLY ONCE where it can be
 * filled (a comment holding exactly its marker; an attribute's value; a text-only element's text), or it is left unseen
 * and the template refused. A sigil binding (`@`, `.`, `!`, `?`) keeps its name AS WRITTEN (the parser lowercases), and
 * that name, lowercased, must be the parser's: a rough-scan naming error refuses the template rather than binding the
 * wrong property or event (the name backstop). Answers whether it met a custom element (a template holding one is
 * imported, not cloned: `instantiate`).
 */
const check = (parent: Node, seen: boolean[], found: Found[], written: (string | null)[], data: boolean): boolean => {
  let custom = false;
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === 1) {
      const element = node as Element;
      if (element.localName.includes('-') || element.hasAttribute('is')) custom = true;
      /** False once `.innerHTML` or `.textContent` makes the content the author's value: a hole inside would be lost. */
      let walk = true;
      /** A script's type as the parser read it — the element that OPENED it, never a search of the text. */
      const type = element.localName === 'script' ? (element.getAttribute('type') ?? '') : '';
      /** Whether a value is bound on this element itself (a JSON block carrying one is refused, below). */
      let carries = false;
      for (const { name, value } of [...element.attributes]) {
        const [statics, at] = mark(value, VALUE_MARK, seen, written);
        if (at === -1) continue;
        carries = true;
        let bound = name;
        /**
         * A sigil binding, or `on` + a capital (`onClick=${fn}`, React muscle memory): core's rule, the renderer's own test
         * on the WRITTEN name, an event named by the rest, lowercased (Brian, 2026-11-17; parity rows in tests/lite.test.mjs).
         */
        if (/^[@.!?]/.test(name) || /^on[A-Z]/.test(written[at]!)) {
          bound = written[at]!;
          if (bound.toLowerCase() !== name) refuse();
          if (bound[0] === 'o') bound = `@${name.slice(2)}`;
          if (bound === '.innerHTML' || bound === '.textContent') walk = false;
        }
        element.removeAttribute(name);
        if (__DEV__) sayRefused(element, bound);
        found.push([node, bound, statics, at]);
      }
      if (!walk) continue;
      /**
       * A JSON block carrying a binding of its own is refused (2026-11-18): `?type=${false}`, `.type`, `!type` change the
       * type after it was judged here, and a page saved from the DOM then runs the value. Left unseen, so refused.
       */
      if (TEXT_ONLY.test(element.localName) || (element.localName === 'script' && data && !carries && JSON_BLOCK.test(type))) {
        /**
         * Its content as one string (in HTML RCDATA a marker is literal text, in SVG a comment); an element child stops it,
         * and so does the END marker (the template ends with the element open: a `<style/>` slip): left unseen.
         */
        let content = '';
        let textual = true;
        for (let child = element.firstChild; child !== null; child = child.nextSibling)
          if (child.nodeType === 3) content += (child as Text).data;
          else if (child.nodeType === 8) content += TEXT_MARK.test((child as Comment).data) ? `<!--${(child as Comment).data}-->` : '';
          else textual = false;
        if (textual && !content.includes(`<!--\u0001${seen.length - 1}-->`)) {
          const [statics, at] = mark(content, TEXT_MARKS, seen, written);
          if (at !== -1) {
            element.textContent = '';
            found.push([node, TEXT, statics, at]);
          }
        }
      } else if (!RAW.test(element.localName) && check(node, seen, found, written, data)) custom = true;
    } else if (node.nodeType === 8) {
      const hole = TEXT_MARK.exec((node as Comment).data);
      if (hole !== null) found.push([node, null, null, land(+hole[1]!, seen, written, true)]);
    }
  }
  return custom;
};

/**
 * **A call site prepared, once:** its static text written with a marker per hole (the rough scan, `IN_TAG`, picks each
 * marker's form), one more after the end, parsed in a `<template>` (the server's DOM parses into the template itself) —
 * inside an `<svg>` or `<math>` root for an `svg` or `mathml` template (`type`) — every hole checked (`check`), then the
 * shape every instance clones.
 */
const prepare = (strings: TemplateStringsArray, doc: Document, type: number): Prepared => {
  let source = strings[0]!;
  /** Per hole, its attribute name as written (`''` in a tag where none reads), or `null` for a text hole; the end marker's too. */
  const written: (string | null)[] = [];
  for (let i = 1; i < strings.length; i++) {
    const tag = IN_TAG.exec(source);
    written.push(tag ? (WRITTEN_NAME.exec(source)?.[1] ?? '') : null);
    /**
     * An unquoted value followed by `/>` would absorb the slash (`<circle r=${r}/>` gives `r="5/"` to the parser): a
     * space keeps it out, as core's renderer writes one — for every such hole (core's own scan, for an attribute's first).
     */
    source += (tag ? `\u0002${i - 1}\u0002${tag[1] || !strings[i]!.startsWith('/>') ? '' : ' '}` : `<!--\u0001${i - 1}-->`) + strings[i];
  }
  written.push(null);
  const template = doc.createElement('template');
  /**
   * An `svg` or `mathml` template parses inside its root element, as core's renderer parses it; one more marker after
   * the end (inside that root): a template ending inside a tag, a comment or raw text swallows it.
   */
  const wrap = ['', '', 'svg', 'math'][type];
  const endMark = `<!--\u0001${strings.length - 1}-->`;
  template.innerHTML = wrap ? `<${wrap}>${source}${endMark}</${wrap}>` : source + endMark;
  /** The server's DOM has no template content: its parse lands in the template itself (`instantiate` unwraps it). */
  const content: DocumentFragment | HTMLTemplateElement = template.content ?? template;
  /**
   * The root removed and EVERYTHING the parser made kept, in place: an HTML element written in foreign content breaks
   * out of it, and lands after it (core's rule — the template shows what the parser made, never less).
   */
  if (wrap) (content.firstChild as Element).replaceWith(...content.firstChild!.childNodes);
  /**
   * No script is a data block when any script start tag in the statics holds an `&` (matched whole, quote-aware): the
   * server reads the RAW type and refuses a character reference there (`dataBlock`), so the client refuses it too.
   */
  let data = true;
  for (const [tag] of strings.join('').matchAll(SCRIPT_START)) if (tag.includes('&')) data = false;
  const seen: boolean[] = new Array(strings.length).fill(false);
  const found: Found[] = [];
  const custom = check(content, seen, found, written, data);
  /** A hole missing; else the END marker swallowed: the template ends inside a tag, a comment or raw text. */
  const missing = seen.indexOf(false);
  if (missing !== -1) {
    if (missing < strings.length - 1) refuse();
    throw new TypeError(misuse('html', 'unfinished-tag', __DEV__ && SHARED.unfinishedTag()));
  }
  /**
   * The end marker has done its work: removed, so no instance carries it. It is the LAST hole found — the last text in
   * the source, and holes are found in document order — and anything else in that place refuses the template, so a
   * broken assumption can only refuse, never remove a node that is not the marker.
   */
  const [marker, , , last] = found.pop()!;
  if (last !== strings.length - 1) refuse();
  (marker as Comment).remove();
  /** An empty template still has a first node, so an instance of it can be a list item (bounded by its own nodes). */
  if (content.firstChild === null) content.append(doc.createTextNode(''));
  /**
   * A range is "after its boundary": a template that STARTS with a hole gets an empty comment as that boundary, since an
   * instance's first node has no stable node before it once inserted.
   */
  const first = content.firstChild!;
  if (first.nodeType === 8 && TEXT_MARK.test((first as Comment).data)) content.prepend(doc.createComment(''));
  /**
   * A hole that is its ELEMENT's only child needs no range: its marker becomes an empty text node IN THE TEMPLATE, so
   * every instance is cloned holding it and a render only sets its data (`solePart`).
   */
  for (let i = 0; i < found.length; i++) {
    const [node, name, , at] = found[i]!;
    if (name === null && node.parentNode !== content && node.parentNode!.childNodes.length === 1) {
      const parent = node.parentNode!;
      (node as Comment).replaceWith(doc.createTextNode(''));
      found[i] = [parent, SOLE, null, at];
    }
  }
  /** A template that is ONE element clones that element: one node to clone and to insert, no fragment (core's root). */
  const root = content.childNodes.length === 1 && content.firstChild!.nodeType === 1 ? content.firstChild! : content;
  return [root, found.map(([node, name, statics, at]) => [pathTo(node, root), name, statics, at]), !custom, root === template];
};

/**
 * **One instance: the template's root cloned, and a part per hole, located by its path BEFORE anything commits** (a
 * committed value inserts nodes, which would shift the siblings a later path counts). A plain template is cloned in its
 * own inert document and adopted on insertion — creating an element in a document with a custom-element registry costs
 * a definition lookup each; one holding a custom element is imported into the page's document, which upgrades it at
 * clone time, so a `.prop` commit reaches its setter (core's rule, `@verajs/renderer`'s instantiate).
 */
const instantiate = (strings: TemplateStringsArray, doc: Document, type: number): [Node, Part[], Hole[]] => {
  let entry = prepared.get(strings);
  if (entry === undefined) {
    /**
     * A forged template (JSON-shaped, `genuine`) renders as the forgery's text, as HTML: its own values are never read,
     * and its kind never chooses a namespace.
     */
    const real = genuine(strings);
    if (real !== strings) return instantiate(real, doc, 1);
    prepared.set(strings, (entry = prepare(strings, doc, type)));
  }
  const [root, holes, plain, wrapped] = entry;
  let clone = plain ? root.cloneNode(true) : doc.importNode(root, true);
  /**
   * A plain loop: a `map` arrow here would capture `clone`, a closure made on every instance (the hot-path rule).
   * **`parts` is a copy of `holes`, overwritten in place, so its storage is EXACTLY one slot per hole** (2026-11-17):
   * `parts` lives as long as the instance, and `[]` grown by `push` makes V8 reserve 17 slots for 3 entries (shown by
   * `%DebugPrint` on the built bundle). In Chrome, after rows were created and cleared on the page, appending 1 000 rows
   * was ~9% slower with `push` on every page: not its own script, which was within 0.15 ms, but the page's collection
   * schedule and the layout that followed it. A copy of `holes` has the right length and is already PACKED_ELEMENTS
   * (holes are tuples), so storing a part never changes its kind. The trade, accepted by Brian: on the first append in
   * a fresh page, exact-size arrays read slow on ~6 of 10 page loads (~+5%), where `push` did not.
   */
  const parts = holes.slice() as unknown as Part[];
  for (let i = 0; i < holes.length; i++) {
    const [path, name, statics] = holes[i]!;
    let node = clone;
    for (let step = 0; step < path.length; step++) {
      node = node.firstChild!;
      for (let hops = path[step]!; hops > 0; hops--) node = node.nextSibling!;
    }
    parts[i] = (
      name === null ? childPart(node.previousSibling, node as Comment)
      : name === SOLE ? solePart(node.firstChild as Text)
      : name === TEXT ? textPart(node as Element, statics!)
      : attrPart(node as Element, name, statics!)
    );
  }
  /** On the server the root is the parse's `<template>` element: its children, located above, are the instance. */
  if (wrapped) {
    const fragment = doc.createDocumentFragment();
    fragment.append(...clone.childNodes);
    clone = fragment;
  }
  return [clone, parts, holes];
};

const commit = (parts: Part[], holes: Hole[], values: readonly unknown[]) => {
  for (let i = 0; i < parts.length; i++) parts[i]!(values, holes[i]![3]);
};

/** Removes `first` and every node after it, up to and with `last`. */
const removeRun = (first: Node, last: Node) => {
  /** Every node here is a child node (an element, text or a comment), so it has `remove`. */
  for (let node = first as ChildNode; ; ) {
    const next = node.nextSibling!;
    node.remove();
    if (node === last) return;
    node = next;
  }
};

/**
 * **Core's child rule for a list** (2026-11-19, the tier suites: a `Set` rendered `[object Set]`): an array, or any other
 * iterable OBJECT that is not a node — a `Set`, a `Map`'s entries, a generator — renders its items; a string (iterable
 * too, but a primitive) is one text, and a `<select>` or `<form>` (iterable nodes) is placed, never listed. Asked after
 * the template check, so a template or an array pays nothing for it.
 */
const isList = (value: unknown): boolean =>
  Array.isArray(value) ||
  (value !== null && typeof value === 'object' && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined);

/**
 * A value's text at a child position. An object holding `strings` is template-SHAPED — a forgery (`JSON.parse`) or a
 * wrapper only core's `hold`/`tag` build — and never a template here: it renders as the constant text any object renders
 * as, NEVER converted (its own `toString` may be data, and a string there throws), as core renders a forgery.
 */
const childText = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' && (value as { strings?: unknown }).strings !== undefined ? FORGED : `${value}`;
const FORGED = `${{}}`;

/** Never a value: what an attribute part last wrote before its first write (core's `UNSET`). */
const UNSET = {};

/**
 * **A new list item from `list[i]`, inserted into `parent` before `before`** — no comment of its own unless it needs one:
 * a template instance is bounded by its own first and last nodes (a one-element template is that element; one that
 * starts with a hole has a boundary comment; one that ends with a hole ends at that hole's comment), and a text value is
 * its text node. Anything else (a nested list) is a range between two comments, since nothing else bounds it.
 */
const makeItem = (source: readonly unknown[], at: number, parent: Node, before: Node | null): Item => {
  const value = source[at];
  const doc = parent.ownerDocument!;
  if ((value as TemplateResult | null)?._$litType$) {
    const { strings, values, _$litType$: type } = value as TemplateResult;
    const [clone, parts, holes] = /*@__NOINLINE__*/ instantiate(strings, doc, type);
    commit(parts, holes, values);
    const fragment = clone.nodeType === 11;
    const item: Item = { _first: fragment ? clone.firstChild! : clone, _last: fragment ? clone.lastChild! : clone, _strings: strings, _parts: parts, _holes: holes };
    /** Development: an element placed where its namespace does not render (a list's batch is checked where it lands). */
    if (__DEV__ && parent.nodeType !== 11) checkForeign('lite', parent, landing(clone), RETAG);
    parent.insertBefore(clone, before);
    return item;
  }
  if (isList(value)) {
    const first = doc.createComment('');
    const last = doc.createComment('');
    parent.insertBefore(first, before);
    parent.insertBefore(last, before);
    const range = childPart(first, last);
    range(source, at);
    return { _first: first, _last: last, _range: range };
  }
  if (__DEV__) onlyCore(value);
  if (__DEV__) sayBooleanChild(value);
  const text = doc.createTextNode(childText(value));
  parent.insertBefore(text, before);
  return { _first: text, _last: text, _value: value };
};

/** Renders `source[at]` into `items[i]`: in place when it is the same kind, or a new item takes its place. */
const updateItem = (items: Item[], i: number, source: readonly unknown[], at: number) => {
  const item = items[i]!;
  const value = source[at];
  if ((value as TemplateResult | null)?._$litType$) {
    if (item._strings === (value as TemplateResult).strings) return commit(item._parts!, item._holes!, (value as TemplateResult).values);
  } else if (isList(value)) {
    if (item._range !== undefined) return item._range(source, at);
  } else if (item._strings === undefined && item._range === undefined) {
    /** Compared with the value it last WROTE, never read back from the DOM (a read is a call into the engine per item). */
    if (value !== item._value) {
      if (__DEV__) sayBooleanChild(value);
      (item._first as Text).data = childText((item._value = value));
    }
    return;
  }
  items[i] = makeItem(source, at, item._last.parentNode!, item._last.nextSibling);
  removeRun(item._first, item._last);
};

/**
 * **A range: the nodes after `start` (from its parent's first child when `start` is `null`) up to `end`**, a comment kept
 * while the part lives. Everything the part shows, and everything its nested parts show, however they changed since,
 * lies inside it — so clearing removes exactly the range, and a range that is its parent's whole content clears in one
 * call. A single value is ONE item and a list is one item per element (`makeItem`, `updateItem`), so a template instance
 * (filled BEFORE it is inserted: one insertion) and text are made the same way in both; new list items are rendered into
 * one fragment and inserted once.
 */
const childPart = (start: Node | null, end: Comment): Part => {
  /** What the range shows: one item for a single value, one per element for a list (`list`), nothing when `undefined`. */
  let items: Item[] | undefined;
  let list = false;
  const clear = () => {
    if (items === undefined) return;
    if (start === null && end.nextSibling === null) end.parentNode!.replaceChildren(end);
    else
      for (let node = start === null ? end.parentNode!.firstChild! : start.nextSibling!; node !== end; ) {
        const next = node.nextSibling!;
        node.remove();
        node = next;
      }
    items = undefined;
  };
  return (values, at) => {
    let value = values[at];
    /** A non-array list (core's rule, `isList`) renders as the array of its items, read once per render. */
    if (!Array.isArray(value) && !(value as TemplateResult | null)?._$litType$ && isList(value)) value = [...(value as Iterable<unknown>)];
    if (Array.isArray(value)) {
      if (!list || items === undefined || value.length === 0) {
        clear();
        items = [];
        list = true;
      }
      const had = items.length;
      if (had > value.length) {
        /** The dropped items are one run of nodes: the first dropped item's first to the last item's last. */
        removeRun(items[value.length]!._first, items[had - 1]!._last);
        items.length = value.length;
      }
      for (let i = 0; i < Math.min(had, value.length); i++) updateItem(items, i, value, i);
      if (had < value.length) {
        /** New items are built in one fragment and inserted once. */
        const batch = end.ownerDocument.createDocumentFragment();
        for (let i = had; i < value.length; i++) items.push(makeItem(value, i, batch, null));
        if (__DEV__) checkForeign('lite', end.parentNode!, landing(batch), RETAG);
        end.before(batch);
      }
    } else if (value == null) clear();
    else if (list || items === undefined) {
      clear();
      list = false;
      items = [makeItem(values, at, end.parentNode!, end)];
    } else updateItem(items, 0, values, at);
  };
};

/**
 * **A hole that is its element's only child** (`<td>${id}</td>`, every cell of a table): it sets the data of the text node
 * the template already holds there — no comment, no insertion — until a value that is not text arrives (a template, a
 * list), when a comment takes the text's place as the end of a range that takes over for good.
 */
const solePart = (text: Text): Part => {
  let range: Part | undefined;
  /** The value last written, compared instead of reading the DOM back; `undefined` matches the template's empty text. */
  let last: unknown;
  return (values, at) => {
    const value = values[at];
    if (range === undefined && (value == null || typeof value !== 'object')) {
      if (value !== last) {
        if (__DEV__) sayBooleanChild(value);
        text.data = (last = value) == null ? '' : `${value}`;
      }
    } else {
      if (range === undefined) {
        const end = text.ownerDocument.createComment('');
        text.replaceWith(end);
        range = childPart(null, end);
      }
      range(values, at);
    }
  };
};

/**
 * A value as text, for a text-only element's content — the rule every tier and the server follow: `null`/`undefined`
 * none, a list its items' text (nested lists flattened by the same rule), a TEMPLATE refused (`template-in-text`, as
 * `@verajs/ssr` refuses it), otherwise the value as a string. A forged template (strings not owning `raw`) is no
 * template: its string.
 */
const textOf = (value: unknown): string => {
  if (value == null) return '';
  if (Array.isArray(value)) {
    let text = '';
    for (const item of value) text += textOf(item);
    return text;
  }
  const strings = (value as TemplateResult)._$litType$ ? (value as TemplateResult).strings : undefined;
  if (Array.isArray(strings) && Object.hasOwn(strings, 'raw'))
    throw new TypeError(misuse('html', 'template-in-text', __DEV__ && SHARED.templateInText()));
  return `${value}`;
};

/**
 * **A text-only element's content** (`title`, `textarea`, `style`, a JSON data block): its statics and its holes' values
 * as text, written as `textContent` (never parsed) when they changed — compared with the text last written.
 */
const textPart = (element: Element, statics: string[]): Part => {
  let last: string | undefined;
  /**
   * An HTML `<style>`'s or JSON block's text is serialized VERBATIM by the browser, so written as it is, a value would
   * become markup the moment the page is saved through `innerHTML`/`outerHTML` and parsed again (2026-11-18, measured on
   * three engines). So the COMPOSED text — statics and values together, since a closer can form across a hole (a static
   * `<` before a value `/style>`) — is written closed (`closedRawText`), as the renderer and `@verajs/ssr` write it, byte
   * for byte. HTML elements only — the upper-case `tagName` of an HTML document: an SVG `<style>` or `<script>` is
   * serialized escaped like any text, as core and the server leave it. Title and textarea are RCDATA, which
   * serialization escapes already.
   */
  const raw = element.tagName === 'STYLE' ? 1 : element.tagName === 'SCRIPT' ? 2 : 0;
  return (values, at) => {
    let text = statics[0]!;
    for (let i = 1; i < statics.length; i++) text += textOf(values[at + i - 1]) + statics[i]!;
    if (text !== last) element.textContent = raw ? /*@__NOINLINE__*/ closedRawText((last = text), raw > 1) : (last = text);
  };
};

/** One attribute hole: `@event`, `.prop`, `!live`, `?bool`, or an attribute, whole or with statics around its holes. */
const attrPart = (element: Element, name: string, statics: string[]): Part => {
  const prefix = name[0];
  const real = name.slice(1);
  const target = element as unknown as Record<string, unknown>;
  /** The value last written; a sentinel at first, so a first `undefined` is WRITTEN as core writes it (2026-11-19). */
  let last: unknown = UNSET;
  if (prefix === '@') {
    let handler: unknown;
    /** One listener per hole, registered once; a new handler only replaces what it calls. `this` is the element (core's). */
    element.addEventListener(real, {
      handleEvent(event: Event) {
        if (typeof handler === 'function') handler.call(element, event);
        else (handler as EventListenerObject | null)?.handleEvent?.(event);
      },
    });
    return (values, at) => {
      if (__DEV__) sayListener(element, real, values[at], handler == null);
      handler = values[at];
    };
  }
  if (prefix === '?')
    return (values, at) => {
      if (!!values[at] !== last) element.toggleAttribute(real, (last = !!values[at]));
    };
  /** `.prop` and `!live` write a property; anything else an attribute, by its parser name. */
  const property = prefix === '.' || prefix === '!';
  const key = property ? real : name;
  const check = /*@__NOINLINE__*/ urlCheck(key);
  /**
   * Refused, as core refuses them: `.__proto__` would replace the element's prototype; a bound inline handler or `srcdoc`
   * attribute would run its value as code or markup; a `<script>`'s URL (`src`; SVG's `href`) chooses the code it runs, and
   * it takes no `.`/`!` binding at all (its properties include its code; each has an attribute form), a JSON block's too;
   * a `<base>`'s URL (`href`) chooses where every later script loads from.
   * Kept a CALL, never pasted in (CLAUDE.md, the one-caller rule): as this function's only caller, the minifier would
   * substitute it here as an arrow made and invoked on every call — every attribute hole created (both checks).
   */
  if ((property ? real === '__proto__' : /*@__NOINLINE__*/ refusedName(name)) || (element.localName === 'script' && (check === SCRIPT_URL || property)) || (element.localName === 'base' && check === SCRIPT_URL)) return () => {};
  /** A component's URL-named property is its own business (often an object): only a string is checked there (core's). */
  const custom = property && element.localName.includes('-');
  const whole = statics.length === 2 && !statics[0] && !statics[1];
  /** Development: the script URL last refused, so a refusal is said each time the value changes (core's rule). */
  let refused: unknown;
  return (values, at) => {
    /** The statics and values joined by a plain loop: a `reduce` arrow here would capture `values` and `at` on every commit. */
    let value: unknown = values[at];
    if (!whole) {
      let joined = statics[0]!;
      for (let i = 1; i < statics.length; i++) joined += `${values[at + i - 1] ?? ''}${statics[i]}`;
      value = joined;
    }
    /**
     * A script URL is refused on the JOINED value and its attribute removed, as core does, for an attribute and a property
     * alike. Converted ONCE, so the string checked is the string written: an object whose `toString` answers differently
     * each time cannot pass as `https:` and be written as `javascript:`.
     */
    if (check !== null && value != null && (!custom || typeof value === 'string')) {
      value = `${value}`;
      if (check.test(value as string)) {
        if (__DEV__ && value !== refused) sayScriptUrl(element, key);
        if (__DEV__) refused = value;
        element.removeAttribute(key);
        last = UNSET;
        return;
      }
    }
    /** A LIVE property is compared against the element's current value (what was typed), as core's `!name`. */
    if (prefix === '!') {
      if (target[key] !== value) target[key] = value;
    } else if (value !== last) {
      last = value;
      if (property) target[key] = value;
      else if (value == null) element.removeAttribute(key);
      else {
        if (__DEV__ && whole) sayAttributeValue(element, key, values[at]);
        element.setAttribute(key, value as string);
      }
    }
  };
};

/** Paints `result` into `root`: the first paint clears what was there (served markup included) and anchors one range. */
export const patch = (result: unknown, root: LiteRoot) => {
  if (root._$t$ === undefined) {
    const end = root.ownerDocument.createComment('');
    root.replaceChildren(end);
    root._$t$ = childPart(null, end);
  }
  root._$t$([result], 0);
};
