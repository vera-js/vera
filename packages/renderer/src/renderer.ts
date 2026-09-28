/**
 * @verajs/renderer — a template-identity renderer.
 *
 * A tagged template's `strings` array is interned per call site, so it keys a parsed `<template>`.
 * An instance clones it and binds the expression positions; every later render of the same shape
 * commits only the values that changed. Lists reconcile by index here, by key through
 * `@verajs/renderer/keyed`.
 *
 * Contracts the speed pays for:
 * - The renderer owns its container below the mount point: a part that owns a whole parent clears it
 *   with one `textContent = ''`.
 * - Do not `normalize()` rendered content — child anchors are text nodes.
 * - A string renders as text, never as markup. There is no `innerHTML` sink.
 *
 * Internal members are `_`-prefixed because the production build mangles `/^_[a-z]/`. `$`-named
 * members cross bundle boundaries (keyed, spread, slots) and survive mangling by not matching it.
 */

import type { TemplateResult } from './types.js';

export type { TemplateResult } from './types.js';

/** Unique per module load, so user text can never collide with it. */
// eslint-disable-next-line no-bitwise -- >>> 0 is the integer truncation, not arithmetic
const MARKER = '$v' + ((Math.random() * 1e9) >>> 0).toString(36) + '$';
/** `<?xyz>` parses as a bogus comment whose data is `?xyz`. */
const MARKER_COMMENT_DATA = '?' + MARKER;

const doc = document;
const comment = () => doc.createComment('');

/** One walker for every template construction, re-aimed through `currentNode`. ELEMENT | TEXT | COMMENT. */
const markerWalker = doc.createTreeWalker(doc, 133);

/**
 * Elements whose children the parser reads as TEXT, so a marker inside one arrives as characters
 * rather than a comment. The scan writes a text marker there and construction turns it back into a
 * marker comment; both sides read this one rule. (`noscript` because Firefox parses it as raw text in
 * a template and Chromium and WebKit do not — listed, it is safe in both parses.)
 */
const RAW_TEXT_TAGS = /^(?:script|style|textarea|title|iframe|noscript)$/i;
const ATTR_NAME_DELIMITER = /[\s"'>=/]/;

/** What the scan found at an expression position. */
const SPEC_CHILD = 0;
const SPEC_ATTRIBUTE = 1;
const SPEC_IGNORED = 2; // consumed, nothing rendered (inside a comment, a junk position)
type Spec = { _type: 0 | 2 } | { _type: 1; _name: string };

/** Scanner states. */
const IN_TEXT = 0;
const IN_TAG = 1;
const IN_QUOTED_VALUE = 2; // a static quoted attribute value, no binding yet
const IN_COMMENT = 3;
const IN_RAW_TEXT = 4;
const IN_BOUND_VALUE = 5; // collecting a bound attribute's statics

/**
 * One pass over the template strings: parseable markup with markers, and the ordered specs. A small
 * state machine rather than regexes, because `>` inside quoted values and comments must not end a tag
 * and raw-text elements swallow markup. Runs once per template shape.
 *
 * A bound attribute becomes ONE marker attribute named `<spec index><MARKER>` whose value carries its
 * statics joined by the marker — read back from the parsed attribute, entities arrive decoded. The
 * index in the name makes pairing ADDRESSED: an element the parser drops takes only its own binding
 * with it, and never shifts a later value onto another element (a security property — see
 * `tests/dropped-element-bindings.test.mjs`).
 */
const scan = (strings: TemplateStringsArray) => {
  const specs: Spec[] = [];
  let markup = '';
  let state = IN_TEXT;
  let quote = '';
  let quoteStart = 0;
  let rawTag = '';
  let tagNameStart = 0;
  let isClosing = false;
  let attrName = '';
  let statics: string[] = [];
  let pending = '';

  /** The attribute name ending at `end` (exclusive); '' when malformed. */
  const attrNameBefore = (end: number) => {
    let at = end;
    while (at > 0 && !ATTR_NAME_DELIMITER.test(markup[at - 1])) at--;
    return markup.slice(at, end);
  };

  for (let i = 0; i < strings.length; i++) {
    const segment = strings[i];
    let pos = 0;
    while (pos < segment.length) {
      const ch = segment[pos];
      if (state === IN_BOUND_VALUE) {
        if (ch === quote || (quote === '' && /[ \t\n\r>/]/.test(ch))) {
          statics.push(pending);
          const quoteChar = quote || '"';
          markup += ` ${specs.length}${MARKER}=${quoteChar}${statics.join(MARKER)}${quoteChar}`;
          specs.push({ _type: SPEC_ATTRIBUTE, _name: attrName });
          state = IN_TAG;
          if (quote !== '') pos++; // consume the closing quote; an unquoted terminator is re-read IN_TAG
          continue;
        }
        pending += ch;
        pos++;
      } else if (state === IN_TEXT) {
        if (ch === '<') {
          if (segment.startsWith('!--', pos + 1)) {
            state = IN_COMMENT;
            markup += '<!--';
            pos += 4;
            continue;
          }
          isClosing = segment[pos + 1] === '/';
          tagNameStart = markup.length + (isClosing ? 2 : 1);
          state = IN_TAG;
        }
        markup += ch;
        pos++;
      } else if (state === IN_TAG) {
        if (ch === '"' || ch === "'") {
          quote = ch;
          quoteStart = markup.length;
          state = IN_QUOTED_VALUE;
        } else if (ch === '>') {
          const tagName = markup.slice(tagNameStart).match(/^[a-zA-Z][^\s/>]*/)?.[0] ?? '';
          if (!isClosing && RAW_TEXT_TAGS.test(tagName) && !markup.endsWith('/')) {
            rawTag = tagName.toLowerCase();
            state = IN_RAW_TEXT;
          } else state = IN_TEXT;
        }
        markup += ch;
        pos++;
      } else if (state === IN_QUOTED_VALUE) {
        if (ch === quote) state = IN_TAG;
        markup += ch;
        pos++;
      } else if (state === IN_COMMENT) {
        if (ch === '-' && segment.startsWith('->', pos + 1)) {
          markup += '-->';
          pos += 3;
          state = IN_TEXT;
          continue;
        }
        markup += ch;
        pos++;
      } else {
        // IN_RAW_TEXT: only this element's own end tag leaves it
        if (
          ch === '<' &&
          segment.slice(pos + 1, pos + 2 + rawTag.length).toLowerCase() === '/' + rawTag &&
          (pos + 2 + rawTag.length >= segment.length || /[\s/>]/.test(segment[pos + 2 + rawTag.length]))
        ) {
          isClosing = true;
          tagNameStart = markup.length + 2;
          state = IN_TAG;
        }
        markup += ch;
        pos++;
      }
    }

    // ── the expression boundary ──
    if (i === strings.length - 1) break;
    if (state === IN_TEXT) {
      markup += `<?${MARKER}>`;
      specs.push({ _type: SPEC_CHILD });
    } else if (state === IN_RAW_TEXT) {
      markup += MARKER; // a comment cannot be parsed here — construction turns this back into one
      specs.push({ _type: SPEC_CHILD });
    } else if (state === IN_COMMENT) {
      specs.push({ _type: SPEC_IGNORED });
    } else if (state === IN_BOUND_VALUE) {
      statics.push(pending); // the attribute spans another expression
      pending = '';
    } else if (state === IN_QUOTED_VALUE) {
      const name = markup[quoteStart - 1] === '=' ? attrNameBefore(quoteStart - 1) : '';
      if (name) {
        attrName = name;
        statics = [markup.slice(quoteStart + 1)];
        pending = '';
        markup = markup.slice(0, quoteStart - 1 - name.length); // cut `name="` back out
        state = IN_BOUND_VALUE;
      } else specs.push({ _type: SPEC_IGNORED });
    } else {
      // IN_TAG: `name=${x}` unquoted, or an element-position expression (marked like an attribute named `&`)
      const name = markup.endsWith('=') ? attrNameBefore(markup.length - 1) : '';
      if (name) {
        attrName = name;
        statics = [''];
        pending = '';
        quote = '';
        markup = markup.slice(0, markup.length - 1 - name.length);
        state = IN_BOUND_VALUE;
      } else {
        markup += ` ${specs.length}${MARKER}="${MARKER}"`;
        specs.push({ _type: SPEC_ATTRIBUTE, _name: '&' });
      }
    }
  }
  return { markup, specs };
};

/**
 * A binding's kind, resolved once per template. `CHILD` is anchored on a primed empty text node the
 * template carries; `SOLE` is a child position that is its element's only content, so the template
 * carries nothing and the first commit writes `textContent` (the text node is created with its value
 * rather than cloned empty and written again).
 */
const IGNORED = 0;
const CHILD = 1;
const SOLE = 2;
const ATTR = 3;
const PROPERTY = 4;
const BOOLEAN = 5;
const EVENT = 6;

/** A binding slot's value before its first commit — never equal to a user value. */
const UNSET = {};
/** The value slot of a child binding that holds a `ChildPart` in its node slot. */
const UPGRADED = {};

class Template {
  /** What an instance clones: the single root element, or the whole content fragment. */
  _root: Node;
  /** No element in it can be custom — see `instantiate`. */
  _plain: boolean;
  _kinds: number[] = [];
  _names: string[] = [];
  /** The statics around a bound attribute's values; `null` for one full-value expression. */
  _statics: (string[] | null)[] = [];
  /** Child-index hops from `_root` to each binding's node. */
  _paths: number[][] = [];
  /** The template statically writes the attribute too, so a first nullish commit must still remove it. */
  _present: boolean[] = [];

  constructor(result: TemplateResult) {
    const type = result._$litType$ ?? 1;
    const { markup, specs } = scan(result.strings);
    const element = doc.createElement('template');
    /** svg/mathml fragments only parse inside their root: wrap, then unwrap. */
    element.innerHTML = type === 2 ? `<svg>${markup}</svg>` : type === 3 ? `<math>${markup}</math>` : markup;
    const content = element.content;
    if (type !== 1) {
      const wrapper = content.firstChild!;
      while (wrapper.firstChild) content.insertBefore(wrapper.firstChild, wrapper);
      content.removeChild(wrapper);
    }

    /**
     * Pair specs with the parsed tree in document order: each marker attribute names its spec, and each
     * marker comment becomes a primed empty text node. A marker that never arrived (its element dropped
     * by the parser) leaves its spec IGNORED, and nothing after it moves.
     */
    const nodes: (Node | null)[] = [];
    const kinds = this._kinds;
    const names = this._names;
    const staticsList = this._statics;
    const present = this._present;
    for (let s = 0; s < specs.length; s++) {
      nodes.push(null);
      kinds.push(IGNORED);
      names.push('');
      staticsList.push(null);
      present.push(false);
    }
    let specIndex = 0;
    const skipIgnored = () => {
      while (specIndex < specs.length && specs[specIndex]._type === SPEC_IGNORED) specIndex++;
    };
    skipIgnored();
    markerWalker.currentNode = content;
    let node: Node | null;
    while (specIndex < specs.length && (node = markerWalker.nextNode()) !== null) {
      if (node.nodeType === 1) {
        const el = node as Element;
        if (el.hasAttributes()) {
          for (const attributeName of el.getAttributeNames()) {
            if (!attributeName.endsWith(MARKER)) continue;
            const index = parseInt(attributeName, 10);
            specIndex = index + 1;
            const name = (specs[index] as { _name: string })._name;
            const statics = el.getAttribute(attributeName)!.split(MARKER);
            el.removeAttribute(attributeName);
            skipIgnored();
            const first = name[0];
            /** `&` (element refs) and `!` (live properties) arrive with their pieces. */
            if (first === '&' || first === '!') continue;
            const kind = first === '.' ? PROPERTY : first === '?' ? BOOLEAN : first === '@' ? EVENT : ATTR;
            nodes[index] = el;
            kinds[index] = kind;
            /** The parser lowercases attribute names; the spec keeps the author's case (`.someProp`). */
            names[index] = kind === ATTR ? name : name.slice(1);
            staticsList[index] = statics.length === 2 && statics[0] === '' && statics[1] === '' ? null : statics;
            present[index] = kind === ATTR && el.hasAttribute(name);
          }
        }
        if (RAW_TEXT_TAGS.test(el.tagName) && el.textContent!.includes(MARKER)) {
          /** Comments cannot be PARSED here but are legal DOM: rebuild the text markers as marker comments. */
          const pieces = el.textContent!.split(MARKER);
          el.textContent = '';
          for (let p = 0; p < pieces.length - 1; p++) {
            if (pieces[p]) el.append(pieces[p]);
            el.append(doc.createComment(MARKER_COMMENT_DATA));
          }
          if (pieces[pieces.length - 1]) el.append(pieces[pieces.length - 1]);
        }
      } else if (node.nodeType === 8 && (node as Comment).data === MARKER_COMMENT_DATA) {
        const primed = doc.createTextNode('');
        node.parentNode!.insertBefore(primed, node);
        markerWalker.currentNode = primed; // re-aim before removing the node the walker stands on
        (node as Comment).remove();
        nodes[specIndex] = primed;
        kinds[specIndex++] = CHILD;
        skipIgnored();
      }
    }

    /**
     * A child binding that is its element's only content needs no anchor in the template — except
     * inside a raw-text element, whose content is never markup.
     */
    for (let i = 0; i < nodes.length; i++) {
      const primed = nodes[i];
      if (kinds[i] !== CHILD) continue;
      const parent = primed!.parentNode!;
      if (
        parent.nodeType === 1 &&
        primed!.previousSibling === null &&
        primed!.nextSibling === null &&
        !RAW_TEXT_TAGS.test((parent as Element).tagName)
      ) {
        parent.removeChild(primed!);
        nodes[i] = parent;
        kinds[i] = SOLE;
      }
    }

    const first = content.firstChild;
    const root = (this._root = first !== null && first.nodeType === 1 && first.nextSibling === null ? first : content);
    for (let i = 0; i < nodes.length; i++) {
      const path: number[] = [];
      for (let at = nodes[i]; at !== null && at !== root; at = at.parentNode) {
        let index = 0;
        for (let sibling = at.previousSibling; sibling !== null; sibling = sibling.previousSibling) index++;
        path.unshift(index);
      }
      this._paths.push(path);
    }

    let plain = content.querySelector('[is]') === null;
    if (plain) for (const el of content.querySelectorAll('*')) if (el.localName.includes('-')) plain = false;
    this._plain = plain;
  }
}

const templateCache = new WeakMap<TemplateStringsArray, Template>();
const getTemplate = (result: TemplateResult) => {
  let template = templateCache.get(result.strings);
  if (template === undefined) templateCache.set(result.strings, (template = new Template(result)));
  return template;
};

/** `${value}` rather than `String(value)`: a symbol throws here as it does at every other sink. */
const toText = (value: unknown) => (value == null ? '' : `${value}`);

/** The listener an `@event` binding registers — stable, so swapping handlers never touches the DOM. */
class Listener {
  _element: Element;
  _handler: unknown = null;
  constructor(element: Element) {
    this._element = element;
  }
  /** A function is called with the element as `this`; an object is invoked through its `handleEvent`. */
  handleEvent(event: Event) {
    const handler = this._handler as EventListener | EventListenerObject | null;
    if (typeof handler === 'function') handler.call(this._element as never, event);
    else if (typeof handler?.handleEvent === 'function') handler.handleEvent(event);
  }
}

/**
 * A rendered template. Its bindings live in ONE array of `[node, committed value]` pairs rather than a
 * part object each — a row allocates the instance and that array, nothing else. The instance is also
 * its own list item: `$k` is the key a keyed list reads.
 */
class Instance {
  $k: unknown = undefined;
  _template: Template;
  /** The strings this instance was built from — the same-shape identity. */
  _strings: TemplateStringsArray;
  /** The cloned root: the element for a single-root template, else the (soon emptied) fragment. */
  _root: Node;
  _bindings: unknown[];
  constructor(template: Template, strings: TemplateStringsArray, root: Node, bindings: unknown[]) {
    this._template = template;
    this._strings = strings;
    this._root = root;
    this._bindings = bindings;
  }
}

/**
 * Builds an instance and commits its first values.
 *
 * **The clone.** Creating an element in a document WITH a custom-element registry costs a definition
 * lookup per element; the template's inert document has none. So a template that cannot contain a
 * custom element (no dash-named element, no `is`) is cloned with `cloneNode` — its nodes adopt into
 * the page on insertion — and one that can is imported into `owner` with `importNode`, which upgrades
 * defined elements at clone time in the owner's own registry, so a `.prop` commit reaches the class's
 * setter rather than shadowing it. A foreign `owner` (a popped-out window, an iframe) always imports.
 *
 * **Every node is located before anything commits.** The paths index the pristine clone; a commit
 * that upgrades a child position inserts markers and content, which would shift the siblings a later
 * path counts.
 */
const instantiate = (template: Template, result: TemplateResult, owner: Document): Instance => {
  const source = template._root;
  const root = template._plain && owner === doc ? source.cloneNode(true) : owner.importNode(source, true);
  const kinds = template._kinds;
  const paths = template._paths;
  const bindings = new Array(kinds.length * 2);
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind === IGNORED) continue;
    let node = root;
    const path = paths[i];
    for (let step = 0; step < path.length; step++) {
      node = node.firstChild!;
      for (let hops = path[step]; hops > 0; hops--) node = node.nextSibling!;
    }
    bindings[i * 2] = kind === EVENT ? new Listener(node as Element) : node;
    bindings[i * 2 + 1] = kind === CHILD ? '' : UNSET;
  }
  const instance = new Instance(template, result.strings, root, bindings);
  update(instance, result.values);
  return instance;
};

/** Commits new values into an instance of the same shape. */
const update = (instance: Instance, values: unknown[]) => {
  const template = instance._template;
  const kinds = template._kinds;
  const bindings = instance._bindings;
  let valueIndex = 0;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    valueIndex = kind === IGNORED ? valueIndex + 1 : commitBinding(template, bindings, i, kind, values, valueIndex);
  }
};

/** Commits one binding; returns the next value index. */
const commitBinding = (
  template: Template,
  bindings: unknown[],
  i: number,
  kind: number,
  values: unknown[],
  valueIndex: number
): number => {
  const slot = i * 2;
  const committed = bindings[slot + 1];
  if (kind === CHILD || kind === SOLE) {
    const value = values[valueIndex];
    if (committed === UPGRADED) (bindings[slot] as ChildPart)._set(value);
    else if (value == null || typeof value === 'object') {
      /** A template, list, node or nothing: the position becomes a full part, anchored where its text was. */
      let text = bindings[slot] as Text;
      if (committed === UNSET) {
        const holder = text as unknown as Element;
        holder.append('');
        text = holder.firstChild as Text;
      }
      const end = comment();
      const part = new ChildPart(comment(), end);
      const parent = text.parentNode!;
      parent.insertBefore(part._start, text);
      parent.insertBefore(end, text.nextSibling);
      part._mode = TEXT;
      part._text = text;
      part._value = committed === UNSET ? '' : committed;
      bindings[slot] = part;
      bindings[slot + 1] = UPGRADED;
      part._set(value);
    } else if (value !== committed) {
      if (committed === UNSET) {
        /** SOLE's first text: created holding its value. `''` creates no node, so that one is appended. */
        const holder = bindings[slot] as Element;
        if (value === '') holder.append('');
        else holder.textContent = value as string;
        bindings[slot] = holder.firstChild;
      } else (bindings[slot] as Text).data = value as string;
      bindings[slot + 1] = value;
    }
    return valueIndex + 1;
  }
  const statics = template._statics[i];
  let value: unknown;
  if (statics === null || kind === EVENT) value = values[valueIndex];
  else {
    let joined = statics[0];
    for (let s = 1; s < statics.length; s++) joined += toText(values[valueIndex + s - 1]) + statics[s];
    value = joined;
  }
  const next = valueIndex + (statics === null ? 1 : statics.length - 1);
  if (value === committed) return next;
  bindings[slot + 1] = value;
  const name = template._names[i];
  if (kind === ATTR) {
    const element = bindings[slot] as Element;
    if (value != null) element.setAttribute(name, value as string);
    /** A fresh clone carries no attribute to remove unless the template itself wrote one. */
    else if (committed !== UNSET || template._present[i]) element.removeAttribute(name);
  } else if (kind === PROPERTY) (bindings[slot] as Record<string, unknown>)[name] = value;
  else if (kind === BOOLEAN) (bindings[slot] as Element).toggleAttribute(name, !!value);
  else {
    const listener = bindings[slot] as Listener;
    /** Registered once, as the listener OBJECT: the platform dedupes it, so toggling through null never stacks. */
    if (listener._handler === null && value != null) listener._element.addEventListener(name, listener);
    listener._handler = value ?? null;
  }
  return next;
};

/** A single property read — it runs once per list item per render. */
const isTemplateResult = (value: object): value is TemplateResult =>
  (value as TemplateResult).strings !== undefined;

/** What a ChildPart holds. */
const EMPTY = 0;
const TEXT = 1;
const TEMPLATE = 2;
const LIST = 3;
const NODE = 4;

/** Removal is a move into this fragment, then one clear. */
const SCRATCH = doc.createDocumentFragment();

export type { ChildPart, Instance };

/** A list item: an instance of a single-root template (its element is its whole range), or a markered part. */
export type Item = Instance | ChildPart;

/**
 * A value that names the strategy able to reconcile a list of its kind — `keyed()` is the producer.
 * It lives here rather than in `types.ts` because it names `ChildPart`, a runtime class of this file.
 */
export type ListStrategy = (part: ChildPart, values: unknown[], items: Item[], parent: Node, end: Node | null) => Item[];

/** A `TemplateResult` that `keyed()` marked with its strategy. */
export interface KeyedResult extends TemplateResult {
  $r?: ListStrategy;
}

/**
 * A child position that holds anything but plain text: a template, a list, a node, or nothing — or
 * text it took over from an upgraded binding. It owns the range between two comment markers
 * (`_end === null`: to the end of its parent — the root part).
 */
class ChildPart {
  _start: Comment;
  _end: Node | null;
  _mode = EMPTY;
  _value: unknown = undefined;
  _text: Text | null = null;
  _instance: Instance | null = null;
  _items: Item[] | null = null;
  /** The key a keyed list reads when this part is one of its items. */
  $k: unknown = undefined;

  constructor(start: Comment, end: Node | null) {
    this._start = start;
    this._end = end;
  }

  _insert(node: Node) {
    this._start.parentNode!.insertBefore(node, this._end);
  }

  _clear() {
    const parent = this._start.parentNode!;
    const end = this._end;
    /** Owning the parent's whole content, one `textContent = ''` replaces a removal per node. */
    if (this._start.previousSibling === null && (end === null || end.nextSibling === null)) {
      parent.textContent = '';
      parent.appendChild(this._start);
      if (end !== null) parent.appendChild(end);
    } else {
      let node = this._start.nextSibling;
      /** `node !== null` is a backstop: a detached boundary leaves nodes behind rather than throwing mid-render. */
      while (node !== null && node !== end) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
    }
    this._mode = EMPTY;
    this._text = null;
    this._instance = null;
    this._items = null;
  }

  _set(value: unknown) {
    if (value == null) {
      if (this._mode !== EMPTY) this._clear();
      return;
    }
    if (typeof value !== 'object') {
      if (this._mode === TEXT) {
        if (this._value !== value) this._text!.data = value as string;
      } else {
        if (this._mode !== EMPTY) this._clear();
        this._insert((this._text = doc.createTextNode(value as string)));
        this._mode = TEXT;
      }
      this._value = value;
      return;
    }
    if (isTemplateResult(value)) {
      /** The hottest line of a list update: same strings, commit the values and nothing else. */
      if (this._mode === TEMPLATE && this._instance!._strings === value.strings) {
        update(this._instance!, value.values);
        return;
      }
      if (this._mode !== EMPTY) this._clear();
      const instance = instantiate(getTemplate(value), value, this._start.ownerDocument!);
      this._insert(instance._root);
      this._instance = instance;
      this._mode = TEMPLATE;
      return;
    }
    if (Array.isArray(value)) return this._commitList(value);
    /** Any other iterable is a list — but a node is placed, not iterated (a `<select>`, a `<form>`). */
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined)
      return this._commitList([...(value as Iterable<unknown>)]);
    if ((value as Node).nodeType !== undefined) {
      if (this._mode !== NODE || this._value !== value) {
        if (this._mode !== EMPTY) this._clear();
        this._insert(value as Node);
        this._value = value;
        this._mode = NODE;
      }
      return;
    }
    this._set(String(value));
  }

  /** Creates one list item before `ref`. */
  $c(value: unknown, parent: Node, ref: Node | null): Item {
    if (value !== null && typeof value === 'object' && isTemplateResult(value)) {
      const template = getTemplate(value);
      if (template._root.nodeType === 1) {
        const instance = instantiate(template, value, this._start.ownerDocument!);
        parent.insertBefore(instance._root, ref);
        instance.$k = value.key;
        return instance;
      }
    }
    const end = comment();
    const part = new ChildPart(comment(), end);
    parent.insertBefore(part._start, ref);
    parent.insertBefore(end, ref);
    part._set(value);
    part.$k = (value as TemplateResult | null)?.key;
    return part;
  }

  /** Commits `value` into an item; returns the item now standing there (an instance whose shape changed becomes a part). */
  $u(item: Item, value: unknown): Item {
    if (item instanceof ChildPart) {
      item._set(value);
      return item;
    }
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings === item._strings) {
      update(item, (value as TemplateResult).values);
      return item;
    }
    const element = item._root as Element;
    const end = comment();
    const part = new ChildPart(comment(), end);
    element.before(part._start, end);
    element.remove();
    part.$k = item.$k;
    part._set(value);
    return part;
  }

  /** The item's first node — its move handle and the insertion reference before it. */
  $f(item: Item): Node {
    return item instanceof ChildPart ? item._start : item._root;
  }

  /** Moves an item before `ref`. */
  $m(item: Item, ref: Node | null, parent: Node = this._start.parentNode!) {
    if (!(item instanceof ChildPart)) {
      parent.insertBefore(item._root, ref);
      return;
    }
    let node: Node | null = item._start;
    const stop = item._end!.nextSibling;
    while (node !== stop) {
      const next: Node | null = node!.nextSibling;
      parent.insertBefore(node!, ref);
      node = next;
    }
  }

  /** Removes an item. */
  $d(item: Item) {
    this.$m(item, null, SCRATCH);
    SCRATCH.textContent = '';
  }

  _commitList(values: unknown[]) {
    const count = values.length;
    /**
     * A keyed list names its own strategy (`keyed()` stamps `$r`). Keyed and index items are the same
     * kind of item — an unkeyed one carries `$k === undefined`, which a keyed pass treats as not found —
     * so a list can change between the two without being rebuilt.
     */
    const strategy = count ? (values[0] as KeyedResult | null)?.$r : undefined;
    if (this._mode !== LIST) {
      if (this._mode !== EMPTY) this._clear();
      this._items = [];
      this._mode = LIST;
    }
    const items = this._items!;
    if (count === 0) {
      if (items.length) {
        this._clear();
        this._items = [];
        this._mode = LIST;
      }
      return;
    }
    const parent = this._start.parentNode!;
    const end = this._end;
    if (strategy !== undefined) {
      this._items = strategy(this, values, items, parent, end);
      return;
    }
    /** Index mode: update in place, grow at the end, shrink from the end. Rows go straight into the parent. */
    const shared = items.length < count ? items.length : count;
    for (let i = 0; i < shared; i++) items[i] = this.$u(items[i], values[i]);
    for (let i = items.length; i < count; i++) items.push(this.$c(values[i], parent, end));
    if (count < items.length) {
      for (let i = count; i < items.length; i++) this.$m(items[i], null, SCRATCH);
      SCRATCH.textContent = '';
      items.length = count;
    }
  }
}

const rootParts = new WeakMap<Node, ChildPart>();

/**
 * Writes a template result into a container — the renderer's imperative draw: no reactivity, no
 * lifecycle. The first call appends a marker and anchors a root part there; later calls reuse it and
 * commit only the values. Content already in the container stays. lit-html's argument order.
 */
export const renderInto = (result: unknown, container: Node) => {
  let part = rootParts.get(container);
  if (part === undefined) {
    const marker = comment();
    container.appendChild(marker);
    rootParts.set(container, (part = new ChildPart(marker, null)));
  }
  part._set(result);
};

/** Everything this renderer needs, in one entry: `wire([renderer])`. */
export const renderer = {
  name: '@verajs/renderer',
  on: 'render' as const,
  fn: renderInto as never,
  priority: 50,
};
