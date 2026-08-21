/**
 * @verajs/renderer — a ground-up, keyed, template-identity renderer.
 *
 * Replaces the Reef-derived renderer, which flattened every template to an HTML string and
 * re-parsed it on each change — O(whole template) work for a one-row edit, measured at 85 ms for a
 * two-row swap that lit-html does in 3.5 ms.
 *
 * The architecture here is the one that wins that benchmark:
 *
 *   1. A tagged template literal's `strings` array is frozen and IDENTICAL for every call from the
 *      same call site, so it is a cache key for the template's static shape. The shape is parsed
 *      ONCE into a `<template>` element with markers where the expressions go.
 *   2. Rendering clones that template and binds "parts" to the marker positions. Every later render
 *      of the same shape only compares and commits the dynamic values — static content is never
 *      touched again.
 *   3. Arrays reconcile KEYED (see `keyed()`), with head/tail fast paths and map-based moves, so a
 *      reorder moves nodes instead of rebuilding them.
 *
 * Built in, where lit-html requires directive imports: keyed list reconciliation (`keyed`),
 * element refs (element-position expressions), toggled-DOM preservation (`hold`), and a
 * whole-range fast clear — one `textContent = ''` where lit removes thousands of nodes one at a
 * time. Like-for-like (lit-html + repeat + ref + cache: 5 021 B gzip), this file is ~28% smaller.
 *
 * What it deliberately does NOT have, which is why it is smaller than lit-html: no directive
 * protocol, no `noChange`/`nothing` sentinels (in a single-expression attribute, `null`/`undefined`
 * REMOVE the attribute; in a child, they clear it), no sanitizer indirection, no async parts, no
 * dev-mode branches.
 *
 * Known limits, deliberate and shared with lit-html's envelope: no bindings inside comments (the
 * value is consumed and ignored), no dynamic tag names, and nested `<template>` elements' contents
 * are not traversed.
 *
 * CONTRACTS THE SPEED PAYS FOR — these are the trade, documented rather than discovered:
 *
 * - **The renderer owns its container below the mount point.** The whole-range fast clear wipes
 *   everything in a parent the part fully owns, including nodes user code appended there by hand
 *   (lit-html would preserve them). Same contract as mounting Vue or React into a container.
 * - **Do not call `Node.normalize()` on rendered content.** Child anchors are text nodes, and
 *   normalize merges adjacent text — lit-html's comment anchors are immune to this; ours are not.
 * - **A plain string renders as text, never as HTML.** The Reef renderer parsed strings as markup;
 *   this one has no innerHTML sink at all (an XSS class removed). The deliberate escape hatch for
 *   trusted markup is a property binding: `.innerHTML=${trusted}`.
 * - **Hydration is automatic and markerless.** The first render into a container that already has
 *   children adopts them as server output of the same template (statics matched byte-for-byte,
 *   anchors installed by splitting live text at known value positions), falling back to a clean
 *   render on any mismatch. Requires the initial client render to match server state — same
 *   contract as React/Vue hydration.
 * - **No directive protocol.** The template language itself is closed to extension — Vera extends
 *   at the framework layer (inserts) and through element refs, not inside the renderer's value
 *   handling.
 * - Event handlers are invoked with `this` bound to the ELEMENT (lit binds its host).
 *
 * NAMING NOTE: internal class fields and methods are `_`-prefixed because the production build
 * mangles properties matching /^_[a-z]/ (see defaultRollupConfig). That is what lets this file use
 * full descriptive names while still shipping one-letter properties — locals and top-level names
 * are mangled by default anyway, but property names are not. `_$litType$` and `handleEvent`
 * deliberately do not match the pattern: the first is an interop wire format, the second is called
 * by the DOM itself.
 */

export type TemplateResult = {
  /** 1 = html, 2 = svg, 3 = mathml — the markers core's built-in tags produce. */
  _$litType$?: number;
  strings: TemplateStringsArray;
  values: unknown[];
  /** Set by `keyed()`; drives keyed list reconciliation. */
  key?: unknown;
};

/**
 * Marks a template result with a stable key so list reconciliation moves it instead of rewriting
 * it. Key all items in a list or none — mixing is undefined behaviour, as are duplicate keys.
 *
 * ```js
 * rows.map((r) => keyed(r.id, html`<tr>...</tr>`))
 * ```
 */
export const keyed = <T>(key: unknown, result: T): T => {
  (result as TemplateResult).key = key;
  return result;
};

/**
 * Preserves the DOM of templates a child position toggles away from, instead of destroying it —
 * form values, scroll positions and media playback survive the round trip (lit-html calls this
 * `cache`). Stashed DOM is parked in its instance's own fragment and re-adopted on return.
 *
 * ```js
 * html`<div>${hold(editing ? editor() : viewer())}</div>`
 * ```
 */
export const hold = (result: TemplateResult): { $h: TemplateResult } => ({ $h: result });

/**
 * Unique per module load, so user text can never collide with it. Randomness here cannot break
 * template caching — the marker only ever pairs a scan with its own Template construction.
 */
const MARKER = '$v' + ((Math.random() * 1e9) >>> 0).toString(36) + '$';
/** `<?xyz>` parses as a bogus comment whose data is `?xyz`. */
const MARKER_COMMENT_DATA = '?' + MARKER;

const doc = document;
const comment = (data = '') => doc.createComment(data);

/**
 * One walker for every template construction, re-aimed by assigning `currentNode`. Traversal of a
 * detached fragment cannot escape it — ascent stops at a null parent — and no walk is ever
 * re-entered mid-flight: an inner instantiation only begins after the outer walk has finished
 * collecting its parts.
 */
const markerWalker = doc.createTreeWalker(doc, 129 /* ELEMENT | COMMENT */);
/**
 * Second shared walker for indexing and instantiation. Templates ship with NO marker comments —
 * every child slot's anchor is its primed text node — so instances index over elements and texts.
 * Marker comments exist only transiently during template construction, and are created lazily at
 * runtime only if a slot upgrades from text to template/array content. Sharing the walker saves a
 * TreeWalker allocation per instance, which is 10 000 allocations in a 10 000-row create.
 */
const instanceWalker = doc.createTreeWalker(doc, 5 /* ELEMENT | TEXT */);

const RAW_TEXT_TAGS = /^(?:script|style|textarea|title)$/i;
const ATTR_NAME_DELIMITER = /[\s"'>=/]/;

/** What an expression position turned out to be. */
const CHILD = 0;
const ATTRIBUTE = 1;
const IGNORED = 2; // value consumed, nothing rendered (bindings inside comments, junk positions)

type Spec = { _type: 0 } | { _type: 1; _name: string } | { _type: 2 };

/** Scanner states. */
const IN_TEXT = 0;
const IN_TAG = 1;
const IN_QUOTED_VALUE = 2; // a static quoted attribute value (no binding seen yet)
const IN_COMMENT = 3;
const IN_RAW_TEXT = 4; // inside <script>/<style>/<textarea>/<title>
const IN_BOUND_VALUE = 5; // collecting a bound attribute's statics

/**
 * One pass over the template strings, producing parseable HTML with markers plus an ordered spec
 * list. Runs once per template shape, so clarity beats micro-optimisation here.
 *
 * A small state machine rather than tail regexes, because `>` inside quoted attribute values and
 * inside comments must not terminate a tag, and raw-text elements swallow markup.
 */
const scan = (strings: TemplateStringsArray) => {
  const specs: Spec[] = [];
  let markup = '';
  let state = IN_TEXT;
  let quote = '';
  let quoteStart = 0; // markup index of the opening quote while IN_QUOTED_VALUE
  let rawTag = ''; // which raw-text element we are inside
  let tagNameStart = 0; // markup index where the current tag's name begins
  let isClosing = false;
  let attrName = '';
  let statics: string[] = [];
  let pending = ''; // the static chunk currently being collected IN_BOUND_VALUE

  /** Backscan an attribute name that ends at `end` (exclusive); '' when malformed. */
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
        if (
          ch === quote ||
          (quote === '' && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '>' || ch === '/'))
        ) {
          /**
           * The bound attribute closes. Emit a marker attribute whose VALUE carries the statics
           * joined by the marker — reading them back from the parsed attribute means entities
           * arrive decoded, exactly as a static attribute would.
           */
          statics.push(pending);
          const quoteChar = quote || '"';
          markup += ` ${specs.length}${MARKER}=${quoteChar}${statics.join(MARKER)}${quoteChar}`;
          specs.push({ _type: ATTRIBUTE, _name: attrName });
          state = IN_TAG;
          if (quote !== '') pos++; // consume the closing quote; unquoted terminators reprocess IN_TAG
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
          } else {
            state = IN_TEXT;
          }
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
        // IN_RAW_TEXT
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

    // ── expression boundary ──────────────────────────────────────────────────
    if (i === strings.length - 1) break;
    if (state === IN_TEXT) {
      markup += `<?${MARKER}>`;
      specs.push({ _type: CHILD });
    } else if (state === IN_RAW_TEXT) {
      markup += MARKER; // a text marker; comments cannot be parsed inside raw-text elements
      specs.push({ _type: CHILD });
    } else if (state === IN_COMMENT) {
      specs.push({ _type: IGNORED }); // binding inside a comment: consumed, ignored
    } else if (state === IN_BOUND_VALUE) {
      statics.push(pending); // this attribute spans another expression
      pending = '';
    } else if (state === IN_QUOTED_VALUE) {
      // expression inside a quoted attribute value -> becomes a bound attribute
      const name = markup[quoteStart - 1] === '=' ? attrNameBefore(quoteStart - 1) : '';
      if (name) {
        attrName = name;
        statics = [markup.slice(quoteStart + 1)]; // the static prefix already inside the quotes
        pending = '';
        markup = markup.slice(0, quoteStart - 1 - name.length); // cut `name="` back out
        state = IN_BOUND_VALUE;
      } else {
        specs.push({ _type: IGNORED });
      }
    } else {
      // IN_TAG: `name=${x}` unquoted, or an element-position expression
      const name = markup.endsWith('=') ? attrNameBefore(markup.length - 1) : '';
      if (name) {
        attrName = name;
        statics = [''];
        pending = '';
        quote = '';
        markup = markup.slice(0, markup.length - 1 - name.length);
        state = IN_BOUND_VALUE;
      } else {
        /**
         * Element-position expression — an element REF, not a no-op. Marked exactly like a bound
         * attribute ('&' cannot begin a real attribute binding), so no new machinery exists for it.
         */
        markup += ` ${specs.length}${MARKER}="${MARKER}"`;
        specs.push({ _type: ATTRIBUTE, _name: '&' });
      }
    }
  }
  return { markup, specs };
};

/** A part's position and shape inside a Template, resolved to a node index for instantiation. */
type TemplatePart = {
  _type: 0 | 1 | 2;
  _index: number;
  _name?: string;
  _statics?: string[];
  _node?: Node; // only during construction, carrying identity between the two passes
};

const templateCache = new WeakMap<TemplateStringsArray, Template>();

class Template {
  _element: HTMLTemplateElement;
  _parts: TemplatePart[] = [];

  constructor(result: TemplateResult) {
    const type = result._$litType$ ?? 1;
    const { markup, specs } = scan(result.strings);
    this._element = doc.createElement('template');
    /** svg/mathml fragments only parse inside their root; wrap, then unwrap below. */
    this._element.innerHTML = type === 2 ? `<svg>${markup}</svg>` : type === 3 ? `<math>${markup}</math>` : markup;
    const content = this._element.content;
    if (type !== 1) {
      const wrapper = content.firstChild!;
      while (wrapper.firstChild) content.insertBefore(wrapper.firstChild, wrapper);
      content.removeChild(wrapper);
    }

    /**
     * Pass 1 — DISCOVER over ELEMENT | COMMENT: pair scan specs with parsed nodes in document
     * order (which is expression order), and swap every marker comment for a primed empty text
     * node. The shipped template then contains no comments at all: each clone is three nodes
     * lighter per typical row, and the primed text doubles as both anchor and first-commit target.
     */
    markerWalker.currentNode = content;
    let specIndex = 0;
    let node: Node | null;
    const parts = this._parts;
    const consumeIgnored = () => {
      while (specIndex < specs.length && specs[specIndex]._type === IGNORED) {
        parts.push({ _type: IGNORED, _index: -1 });
        specIndex++;
      }
    };
    consumeIgnored();
    while (specIndex < specs.length && (node = markerWalker.nextNode()) !== null) {
      if (node.nodeType === 1) {
        const element = node as Element;
        if (element.hasAttributes()) {
          for (const attributeName of element.getAttributeNames()) {
            if (attributeName.endsWith(MARKER)) {
              /**
               * The marker attribute's value carries the statics; the REAL (case-preserved) name
               * comes from the spec — the HTML parser lowercases attribute names, which would
               * corrupt `.someProp`.
               */
              const spec = specs[specIndex++] as { _type: 1; _name: string };
              parts.push({
                _type: ATTRIBUTE,
                _index: -1,
                _name: spec._name,
                _statics: element.getAttribute(attributeName)!.split(MARKER),
                _node: element,
              });
              element.removeAttribute(attributeName);
              consumeIgnored();
            }
          }
        }
        if (RAW_TEXT_TAGS.test(element.tagName) && element.textContent!.includes(MARKER)) {
          /**
           * Comments cannot be PARSED inside raw-text elements, but they are legal DOM once
           * created — so the scan left text markers, and here they become real marker comments.
           * The walker visits them next and they pair as ordinary child parts.
           */
          const pieces = element.textContent!.split(MARKER);
          element.textContent = '';
          for (let p = 0; p < pieces.length - 1; p++) {
            if (pieces[p]) element.append(pieces[p]);
            element.append(comment(MARKER_COMMENT_DATA));
          }
          if (pieces[pieces.length - 1]) element.append(pieces[pieces.length - 1]);
        }
      } else if ((node as Comment).data === MARKER_COMMENT_DATA) {
        specIndex++;
        const primedText = doc.createTextNode('');
        node.parentNode!.insertBefore(primedText, node);
        /** Re-aim the walker before removing the node it stands on. */
        markerWalker.currentNode = primedText;
        (node as Comment).remove();
        parts.push({ _type: CHILD, _index: -1, _node: primedText });
        consumeIgnored();
      }
    }

    /** Pass 2 — INDEX over ELEMENT | TEXT, the mask instances walk with. */
    instanceWalker.currentNode = content;
    let nodeIndex = -1;
    let partIndex = 0;
    while (partIndex < parts.length && parts[partIndex]._type === IGNORED) partIndex++;
    while (partIndex < parts.length && (node = instanceWalker.nextNode()) !== null) {
      nodeIndex++;
      while (partIndex < parts.length && parts[partIndex]._node === node) {
        parts[partIndex]._index = nodeIndex;
        partIndex++;
        while (partIndex < parts.length && parts[partIndex]._type === IGNORED) partIndex++;
      }
    }
    for (const part of parts) part._node = undefined;
  }
}

const getTemplate = (result: TemplateResult) => {
  let template = templateCache.get(result.strings);
  if (template === undefined) templateCache.set(result.strings, (template = new Template(result)));
  return template;
};

/** Anything bound to a live position: commits values[index..], returns the next value index. */
interface Part {
  _commit(values: unknown[], index: number): number;
}

const IGNORED_PART: Part = { _commit: (_values, index) => index + 1 };

/** Never equal to any user value, so the first commit always runs. */
const UNSET = {};

/** Removal target: nodes moved here are dropped when it is emptied. */
const SCRATCH = doc.createDocumentFragment();

/** A fresh markered part: two comments inserted before `ref` in `parent`. */
const createMarkeredPart = (parent: Node, ref: Node | null) => {
  const start = comment();
  const end = comment();
  parent.insertBefore(start, ref);
  parent.insertBefore(end, ref);
  return new ChildPart(start, end);
};

const toText = (value: unknown) => (value == null ? '' : String(value));

/** Binding kinds, resolved once from the attribute name's first character. */
const ATTR = 0; // plain attribute
const PROPERTY = 1; // .name
const BOOLEAN = 2; // ?name
const EVENT = 3; // @name
const REF = 4; // element-position expression

class AttrPart implements Part {
  _element: Element;
  _name: string;
  _statics: string[];
  _slots: number; // how many expression values this binding consumes
  _kind: number;
  _isFullValue: boolean; // exactly one expression with no static text around it
  _committed: unknown = UNSET;
  _handler: EventListener | null = null;

  constructor(element: Element, name: string, statics: string[]) {
    const first = name[0];
    let kind = first === '.' ? PROPERTY : first === '?' ? BOOLEAN : first === '@' ? EVENT : first === '&' ? REF : ATTR;
    let realName = kind ? name.slice(1) : name;
    /** React muscle-memory, buildless: `onClick=${fn}` ≡ `@click=${fn}`. Strictly `on` + a
     * capital — all-lowercase `onclick` stays a plain attribute (legal inline-handler HTML). */
    if (kind === ATTR && first === 'o' && name.charCodeAt(1) === 110 && name.charCodeAt(2) > 64 && name.charCodeAt(2) < 91) {
      kind = EVENT;
      realName = name.slice(2).toLowerCase();
    }
    this._kind = kind;
    this._name = realName;
    this._element = element;
    this._statics = statics;
    this._slots = statics.length - 1;
    this._isFullValue = this._slots === 1 && statics[0] === '' && statics[1] === '';
  }

  /** Stable listener registered once; swapping the handler never touches the DOM. */
  handleEvent(event: Event) {
    if (this._handler) this._handler.call(this._element as never, event);
  }

  _commit(values: unknown[], index: number): number {
    const kind = this._kind;
    let value: unknown;
    if (this._isFullValue || kind >= EVENT) {
      value = values[index]; // raw and uncoerced — events and refs receive the actual value
    } else {
      const statics = this._statics;
      let joined = statics[0];
      for (let i = 0; i < this._slots; i++) joined += toText(values[index + i]) + statics[i + 1];
      value = joined;
    }
    if (value !== this._committed) {
      /** On the very first commit the attribute does not exist, so a null needs no DOM call. */
      const isFirst = this._committed === UNSET;
      this._committed = value;
      if (kind === ATTR) {
        if (value == null) {
          if (!isFirst) this._element.removeAttribute(this._name);
        } else this._element.setAttribute(this._name, value as string);
      } else if (kind === PROPERTY) {
        (this._element as unknown as Record<string, unknown>)[this._name] = value;
      } else if (kind === BOOLEAN) {
        if (!isFirst || (value as boolean)) this._element.toggleAttribute(this._name, !!value);
      } else if (kind === EVENT) {
        if (this._handler === null && value != null) this._element.addEventListener(this._name, this);
        this._handler = (value as EventListener) ?? null;
      } else if (value != null) {
        /**
         * Element ref: `<input ${myRef} />`. A function is called with the element; an object gets
         * the element assigned to `.value` — which makes core's own `ref()` double as an element
         * ref, reactively. Runs once per distinct value, not once per render.
         */
        if (typeof value === 'function') (value as (el: Element) => void)(this._element);
        else if (typeof value === 'object') (value as { value: unknown }).value = this._element;
        // any other value type at element position is consumed and ignored
      }
    }
    return index + this._slots;
  }
}

/**
 * A list item is either ELEMENT-MODE — a single-root template instance whose one element IS the
 * item's boundary (`_element`/`_instance`/`_shape` set, `_part` null) — or a general markered
 * ChildPart. Rows are single-root in virtually every real list, and element mode drops both marker
 * comments and both marker inserts per item, which is exactly the per-row overhead a vdom does not
 * pay on create.
 */
type Item = {
  _key: unknown;
  _element: Element | null;
  _instance: Instance | null;
  _shape: TemplateStringsArray | null;
  _part: ChildPart | null;
};

class Instance {
  _parts: Part[] = [];
  _fragment: DocumentFragment;

  constructor(template: Template) {
    /** cloneNode over importNode: same document, and it measures slightly cheaper. */
    this._fragment = template._element.content.cloneNode(true) as DocumentFragment;
    const templateParts = template._parts;
    /** Shared walker, ELEMENT | TEXT — child anchors are the primed text nodes themselves. */
    instanceWalker.currentNode = this._fragment;
    let nodeIndex = -1;
    let node: Node | null = null;
    for (let i = 0; i < templateParts.length; i++) {
      const templatePart = templateParts[i];
      if (templatePart._type === IGNORED) {
        this._parts.push(IGNORED_PART);
        continue;
      }
      while (nodeIndex < templatePart._index) {
        node = instanceWalker.nextNode();
        nodeIndex++;
      }
      this._parts.push(
        templatePart._type === CHILD
          ? new TextPart(node as Text)
          : new AttrPart(node as Element, templatePart._name!, templatePart._statics!)
      );
    }
  }

  _update(values: unknown[]) {
    let valueIndex = 0;
    const parts = this._parts;
    for (let i = 0; i < parts.length; i++) valueIndex = parts[i]._commit(values, valueIndex);
  }
}

/** A single property read — this runs once per list item per render, so it must be minimal. */
const isTemplateResult = (value: object): value is TemplateResult =>
  (value as TemplateResult).strings !== undefined;

/**
 * The common case of a child expression is plain text, and the template primes every child slot
 * with a text node — so the steady state is compare-and-assign on `.data`. This part carries only
 * that, upgrading itself to a full ChildPart the first time it sees null, a template, or an array.
 */
class TextPart implements Part {
  _text: Text;
  _value: unknown = '';
  _upgraded: ChildPart | null = null;

  constructor(text: Text) {
    this._text = text;
  }

  _commit(values: unknown[], index: number): number {
    const value = values[index];
    if (this._upgraded !== null) {
      this._upgraded._set(value);
      return index + 1;
    }
    if (value == null || typeof value === 'object') {
      /**
       * Upgrade in place: marker comments come into existence only now, anchored around the text
       * node, and the full part inherits the committed text state and delegates forever.
       *
       * BOTH markers are ours. Borrowing `this._text.nextSibling` as the end instead would hand
       * this part a boundary owned by the NEXT part — and the next part removes that very node
       * when it upgrades and clears its own text. The stale reference then makes `_clear()` walk
       * past the end of the child list. Owning both anchors also makes `_end === null` mean
       * exactly one thing: the root part, which really does own its container.
       */
      const start = comment();
      const end = comment();
      const parent = this._text.parentNode!;
      parent.insertBefore(start, this._text);
      parent.insertBefore(end, this._text.nextSibling);
      const part = new ChildPart(start, end);
      part._mode = TEXT;
      part._text = this._text;
      part._value = this._value;
      this._upgraded = part;
      part._set(value);
      return index + 1;
    }
    if (value !== this._value) {
      this._value = value;
      this._text.data = value as string;
    }
    return index + 1;
  }
}

/** What a ChildPart currently contains. */
const EMPTY = 0;
const TEXT = 1;
const TEMPLATE = 2;
const LIST = 3;

class ChildPart implements Part {
  _start: Comment;
  /** Exclusive end of this part's range; null means "to the end of the parent". */
  _end: Node | null;
  _mode = EMPTY;
  _value: unknown;
  _text: Text | null = null;
  _instance: Instance | null = null;
  /** The committed template's strings identity — the same-template fast path in `_set`. */
  _shape: TemplateStringsArray | null = null;
  _items: Item[] | null = null;
  _keyedList = false;
  /** Held instances by template identity; survives clears so state outlives interim content. */
  _held: Map<TemplateStringsArray, Instance> | null = null;

  constructor(start: Comment, end: Node | null) {
    this._start = start;
    this._end = end;
  }

  _commit(values: unknown[], index: number): number {
    this._set(values[index]);
    return index + 1;
  }

  _insert(node: Node) {
    this._start.parentNode!.insertBefore(node, this._end);
  }

  _clear() {
    const parent = this._start.parentNode!;
    /**
     * When this part owns its parent's entire contents, one `textContent = ''` replaces removing
     * every node individually. For a 1 000-row table body that is the difference between ~22 ms
     * (lit-html's per-node teardown) and ~5 ms.
     */
    if (this._start.previousSibling === null && this._end === null) {
      parent.textContent = '';
      parent.appendChild(this._start);
    } else {
      let node = this._start.nextSibling;
      /**
       * `node !== null` is a backstop, not an expected exit. Reaching the end of the child list
       * without meeting `_end` means something detached this part's boundary; stopping leaves
       * nodes behind, which beats throwing out of the middle of a render pass.
       */
      while (node !== null && node !== this._end) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
    }
    this._mode = EMPTY;
    this._text = null;
    this._instance = null;
    this._items = null;
    this._shape = null;
  }

  _set(value: unknown) {
    if (value == null) {
      if (this._mode !== EMPTY) this._clear();
      return;
    }
    if (typeof value !== 'object') {
      if (this._mode === TEXT) {
        if (this._value !== value) {
          this._value = value;
          this._text!.data = value as string; // the DOM coerces numbers etc.
        }
      } else {
        if (this._mode !== EMPTY) this._clear();
        this._text = doc.createTextNode(value as string);
        this._insert(this._text);
        this._value = value;
        this._mode = TEXT;
      }
      return;
    }
    const heldResult = (value as { $h?: TemplateResult }).$h;
    if (heldResult !== undefined) {
      this._commitHeld(heldResult);
      return;
    }
    if (isTemplateResult(value)) {
      /**
       * Same-shape fast path on `strings` identity alone — no template-cache lookup. This is the
       * hottest line in a keyed list update: for every row whose shape did not change (all of
       * them, in practice), commit costs one identity compare before touching the values.
       */
      if (this._shape === value.strings) {
        this._instance!._update(value.values);
        return;
      }
      const template = getTemplate(value);
      if (this._mode !== EMPTY) this._clear();
      const instance = new Instance(template);
      instance._update(value.values);
      this._insert(instance._fragment);
      this._instance = instance;
      this._shape = value.strings;
      this._mode = TEMPLATE;
      return;
    }
    if (Array.isArray(value)) {
      this._commitList(value);
      return;
    }
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
      this._commitList([...(value as Iterable<unknown>)]);
      return;
    }
    // any other object: render as text
    this._set(String(value));
  }

  /** Commits a template while stashing whatever it replaces — see the `hold()` export. */
  _commitHeld(result: TemplateResult) {
    if (this._mode === TEMPLATE && this._shape === result.strings) {
      this._instance!._update(result.values);
      return;
    }
    const held = (this._held ??= new Map());
    if (this._mode === TEMPLATE) {
      /** Park the live nodes back in their instance's own (empty) fragment. */
      const fragment = this._instance!._fragment;
      let node = this._start.nextSibling;
      while (node !== this._end) {
        const next = node!.nextSibling;
        fragment.appendChild(node!);
        node = next;
      }
      held.set(this._shape!, this._instance!);
    } else if (this._mode !== EMPTY) {
      this._clear();
    }
    const instance = held.get(result.strings) ?? new Instance(getTemplate(result));
    instance._update(result.values);
    this._insert(instance._fragment);
    this._instance = instance;
    this._shape = result.strings;
    this._mode = TEMPLATE;
  }

  /**
   * Creates one list item. A single-root template instance becomes an element-mode item with no
   * markers at all; anything else gets its own start/end marker pair so moves can never dangle.
   */
  _createItem(value: unknown, parent: Node, ref: Node | null): Item {
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings !== undefined) {
      const result = value as TemplateResult;
      const template = getTemplate(result);
      const instance = new Instance(template);
      instance._update(result.values);
      const rootNode = instance._fragment.firstChild;
      if (rootNode !== null && rootNode.nodeType === 1 && rootNode.nextSibling === null) {
        parent.insertBefore(rootNode, ref);
        return {
          _key: result.key,
          _element: rootNode as Element,
          _instance: instance,
          _shape: result.strings,
          _part: null,
        };
      }
      /** Multi-root template: markered part, content already instantiated. */
      const part = createMarkeredPart(parent, ref);
      part._instance = instance;
      part._shape = result.strings;
      part._mode = TEMPLATE;
      part._start.parentNode!.insertBefore(instance._fragment, part._end);
      return { _key: result.key, _element: null, _instance: null, _shape: null, _part: part };
    }
    const part = createMarkeredPart(parent, ref);
    part._set(value);
    return { _key: (value as TemplateResult)?.key, _element: null, _instance: null, _shape: null, _part: part };
  }

  /** Commits a new value into an existing item, demoting element mode if the shape changed. */
  _updateItem(item: Item, value: unknown) {
    if (item._element !== null) {
      if (value !== null && typeof value === 'object' && (value as TemplateResult).strings === item._shape) {
        item._instance!._update((value as TemplateResult).values);
        return;
      }
      /** Shape changed: swap the bare element for a markered part in its place. */
      const part = createMarkeredPart(item._element.parentNode!, item._element);
      item._element.remove();
      item._element = null;
      item._instance = null;
      item._shape = null;
      (item._part = part)._set(value);
      return;
    }
    item._part!._set(value);
  }

  /** The item's first node — its move/removal handle and the insertion reference before it. */
  _firstNode(item: Item): Node {
    return item._element ?? item._part!._start;
  }

  _moveItem(item: Item, ref: Node | null, parent: Node = this._start.parentNode!) {
    if (item._element !== null) {
      parent.insertBefore(item._element, ref);
      return;
    }
    let node: Node | null = item._part!._start;
    const stop = item._part!._end!.nextSibling;
    while (node !== stop) {
      const next: Node | null = node!.nextSibling;
      parent.insertBefore(node!, ref);
      node = next;
    }
  }

  /** Removal is a move into a scratch fragment that is immediately emptied. */
  _dropItem(item: Item) {
    this._moveItem(item, null, SCRATCH);
    SCRATCH.textContent = '';
  }

  _commitList(newValues: unknown[]) {
    if (this._mode !== LIST) {
      if (this._mode !== EMPTY) this._clear();
      this._items = [];
      this._keyedList = false;
      this._mode = LIST;
    }
    const count = newValues.length;
    if (count === 0) {
      if (this._items!.length) {
        this._clear();
        this._items = [];
        this._mode = LIST;
      }
      return;
    }
    const isKeyed = newValues[0] != null && (newValues[0] as TemplateResult).key !== undefined;
    if (isKeyed !== this._keyedList && this._items!.length) {
      this._clear();
      this._items = [];
      this._mode = LIST;
    }
    this._keyedList = isKeyed;
    const items = this._items!;
    const parent = this._start.parentNode!;

    if (items.length === 0) {
      /** Initial fill builds off-document and lands in one insert. */
      const fragment = doc.createDocumentFragment();
      for (let i = 0; i < count; i++) items.push(this._createItem(newValues[i], fragment, null));
      this._insert(fragment);
      return;
    }

    if (!isKeyed) {
      // index mode: update in place, grow at the end, shrink from the end
      const shared = items.length < count ? items.length : count;
      for (let i = 0; i < shared; i++) this._updateItem(items[i], newValues[i]);
      if (count > items.length) {
        const fragment = doc.createDocumentFragment();
        for (let i = items.length; i < count; i++) items.push(this._createItem(newValues[i], fragment, null));
        this._insert(fragment);
      } else if (count < items.length) {
        const last = items[items.length - 1];
        let node: Node | null = this._firstNode(items[count]);
        const stop = last._element !== null ? last._element.nextSibling : last._part!._end!.nextSibling;
        while (node !== stop) {
          const next: Node | null = node!.nextSibling;
          parent.removeChild(node!);
          node = next;
        }
        items.length = count;
      }
      return;
    }

    /**
     * Zero-allocation fast path for the dominant case: same length, same key order — a pure
     * in-place update (a selection change, a field edit). No key array, no output array, no null
     * checks. Falls through to the full algorithm on the first mismatch; the items already updated
     * re-verify there as cheap no-op compares.
     */
    if (items.length === count) {
      let i = 0;
      while (i < count && items[i]._key === (newValues[i] as TemplateResult).key) {
        this._updateItem(items[i], newValues[i]);
        i++;
      }
      if (i === count) return;
    }

    /**
     * Keyed reconciliation — the standard head/tail algorithm (as in lit's `repeat` and Vue):
     * skip matching prefixes and suffixes, detect the two swap shapes directly, and fall back to
     * key maps for arbitrary moves, removals and insertions.
     */
    const oldItems: (Item | null)[] = items;
    const newKeys: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) newKeys[i] = (newValues[i] as TemplateResult).key;
    const newItems: Item[] = new Array(count);
    let oldHead = 0;
    let oldTail = oldItems.length - 1;
    let newHead = 0;
    let newTail = count - 1;
    let newKeyToIndex: Map<unknown, number> | undefined;
    let oldKeyToIndex: Map<unknown, number> | undefined;
    const refAt = (i: number): Node | null =>
      i < count && newItems[i] !== undefined ? this._firstNode(newItems[i]) : this._end;

    while (oldHead <= oldTail && newHead <= newTail) {
      if (oldItems[oldHead] === null) oldHead++;
      else if (oldItems[oldTail] === null) oldTail--;
      else if (oldItems[oldHead]!._key === newKeys[newHead]) {
        this._updateItem((newItems[newHead] = oldItems[oldHead]!), newValues[newHead]);
        oldHead++;
        newHead++;
      } else if (oldItems[oldTail]!._key === newKeys[newTail]) {
        this._updateItem((newItems[newTail] = oldItems[oldTail]!), newValues[newTail]);
        oldTail--;
        newTail--;
      } else if (oldItems[oldHead]!._key === newKeys[newTail]) {
        const item = oldItems[oldHead]!;
        this._moveItem(item, refAt(newTail + 1));
        this._updateItem(item, newValues[newTail]);
        newItems[newTail] = item;
        oldHead++;
        newTail--;
      } else if (oldItems[oldTail]!._key === newKeys[newHead]) {
        const item = oldItems[oldTail]!;
        this._moveItem(item, this._firstNode(oldItems[oldHead]!));
        this._updateItem(item, newValues[newHead]);
        newItems[newHead] = item;
        oldTail--;
        newHead++;
      } else {
        if (newKeyToIndex === undefined) {
          newKeyToIndex = new Map();
          for (let i = newHead; i <= newTail; i++) newKeyToIndex.set(newKeys[i], i);
          oldKeyToIndex = new Map();
          for (let i = oldHead; i <= oldTail; i++) {
            if (oldItems[i] !== null) oldKeyToIndex.set(oldItems[i]!._key, i);
          }
        }
        if (!newKeyToIndex.has(oldItems[oldHead]!._key)) {
          this._dropItem(oldItems[oldHead]!);
          oldHead++;
        } else if (!newKeyToIndex.has(oldItems[oldTail]!._key)) {
          this._dropItem(oldItems[oldTail]!);
          oldTail--;
        } else {
          const oldIndex = oldKeyToIndex!.get(newKeys[newHead]);
          if (oldIndex === undefined) {
            newItems[newHead] = this._createItem(newValues[newHead], parent, this._firstNode(oldItems[oldHead]!));
          } else {
            const item = oldItems[oldIndex]!;
            this._moveItem(item, this._firstNode(oldItems[oldHead]!));
            this._updateItem(item, newValues[newHead]);
            newItems[newHead] = item;
            oldItems[oldIndex] = null;
          }
          newHead++;
        }
      }
    }
    while (newHead <= newTail) {
      newItems[newHead] = this._createItem(newValues[newHead], parent, refAt(newTail + 1));
      newHead++;
    }
    while (oldHead <= oldTail) {
      const item = oldItems[oldHead++];
      if (item !== null) this._dropItem(item);
    }
    this._items = newItems;
  }
}

const rootParts = new WeakMap<Node, ChildPart>();

/**
 * Renders a template result into a container. Slots into Vera via `setRenderer(render)`; core's
 * built-in `html` tag already produces the accepted shape, so no `setHtml` call is required —
 * though lit-html's `html` also works, its results being structurally identical.
 *
 * HYDRATION lives in `@verajs/renderer/hydrate` — a drop-in superset entry whose `render` adopts
 * existing server-rendered children on first render. SSR apps import from there instead of here;
 * this entry carries zero hydration code.
 */
export const render = (result: unknown, container: Node) => {
  let part = rootParts.get(container);
  if (part === undefined) {
    const marker = comment();
    container.appendChild(marker);
    rootParts.set(container, (part = new ChildPart(marker, null)));
  }
  part._set(result);
};

// ── INTERNAL SURFACE — imported by ./hydrate.ts, never re-exported by src/index.ts ─────────────
// The public d.ts comes from src/index.ts, and the base bundles tree-shake all of this away, so
// nothing here reaches consumers of the base entry. The hydrate entry compiles against this exact
// source into its own self-contained bundle, so mangled property names always agree within it.

/** @internal */
export {
  getTemplate,
  Template,
  Instance,
  TextPart,
  ChildPart,
  AttrPart,
  IGNORED_PART,
  IGNORED,
  TEMPLATE,
  LIST,
  comment,
  doc,
  toText,
  isTemplateResult,
  instanceWalker,
  rootParts,
};
/** @internal */
export type { Part, Item, TemplatePart };
