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
 * Preserves the DOM of templates a child position toggles away from, instead of destroying it —
 * form values, scroll positions and media playback survive the round trip (lit-html calls this
 * `cache`). Stashed DOM is parked in its instance's own fragment and re-adopted on return.
 *
 * ```js
 * html`<div>${hold(editing ? editor() : viewer())}</div>`
 * ```
 *
 * **Anything that is not a template passes straight through.** There is nothing to park for a
 * string, a list, `null` or `false`, and the branch that produces one is the ordinary shape of the
 * expression this wraps — `hold(editing && editor())`, `hold(row ?? null)`. Wrapping those handed
 * the renderer a `{ $h }` carrying a non-template, which reached the held-commit path and threw on
 * `result.strings`: a whole render lost, from a value the same expression renders happily one
 * character to the left. Decided here rather than in the renderer so the hot path pays nothing.
 */
export const hold = <T>(result: T): T | { $h: TemplateResult } =>
  result != null && typeof result === 'object' && isTemplateResult(result)
    ? { $h: result as TemplateResult }
    : result;

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
        if (__DEV__ && (markup.endsWith('<') || markup.endsWith('</'))) {
          /**
           * Except in **tag position**, where it is a mistake with no useful reading. `<${name}>`
           * lands here because the tag has no name yet, and what the parser then makes of a ref on
           * a nameless element is escaped punctuation. Naming the entry that does support it is
           * more use than an element ref nobody asked for.
           */
          console.error(
            `[vera] an expression in tag position (\`<\${…}>\`) is not a dynamic tag name — the ` +
              `template has no element there and the markup around it is rendered as text.\n` +
              `Runtime tag names live in @verajs/renderer/tag:\n\n` +
              `  import { html, tag } from '@verajs/renderer/tag';\n` +
              `  const heading = tag\`h1\`;\n` +
              `  html\`<\${heading}>…</\${heading}>\`\n`
          );
        }
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
/**
 * `!name` — a property written from the *live* DOM rather than from what this binding last wrote.
 *
 * Numbered below `EVENT` deliberately: `kind >= EVENT` is what decides a value is passed raw rather
 * than joined from the statics, and a live binding is a property, so `!title="a${x}b"` has to join
 * like every other one.
 */
const LIVE = 3;
const EVENT = 4; // @name
const REF = 5; // element-position expression

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
    let kind =
      first === '.'
        ? PROPERTY
        : first === '?'
          ? BOOLEAN
          : first === '@'
            ? EVENT
            : first === '&'
              ? REF
              : first === '!'
                ? LIVE
                : ATTR;
    let realName = kind ? name.slice(1) : name;
    /**
     * React muscle-memory, buildless: `onClick=${fn}` ≡ `@click=${fn}`. Strictly `on` + a capital —
     * all-lowercase `onclick` stays a plain attribute (legal inline-handler HTML).
     *
     * `@verajs/renderer/spread` repeats these rules rather than importing them. Sharing them through
     * `@verajs/shared-utils` was tried and reverted: the shared form has to return both the kind and
     * the name, and the tuple it allocates cost this bundle 10 B. Principle #5 allows deliberate
     * duplication where two things can legitimately diverge; here #7 decides it — weight is the
     * product, and core and the renderer are the two packages where that is absolute.
     */
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

  /**
   * `adopting` is set only by `@verajs/renderer/hydrate`, and only changes what happens to the
   * three form-value properties the server can express in markup — see the branch below.
   */
  _commit(values: unknown[], index: number, adopting?: boolean): number {
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
    /**
     * **A live property asks the element, not its own memory.**
     *
     * Every other kind skips a write when the value matches what it last wrote. That is what keeps
     * a field someone has typed into — and it is wrong for a control whose DOM state changes as a
     * *side effect of interacting with a sibling*. Clicking one radio unchecks the others with no
     * event on them, so their bindings still say `true`, still match `_committed`, and never write
     * again: the model and the page diverge and no amount of re-rendering reconciles them. A
     * `<select>`'s options are the same shape.
     *
     * Deliberately narrow. This is not for text inputs — bind those with `.value` and let a
     * person's typing stand. `?hidden` and plain attributes are not offered either: nothing changes
     * them behind the renderer's back, so there is nothing to re-read.
     */
    if (kind === LIVE) {
      this._committed = value;
      /**
       * **Except while adopting.** Hydration reaches a DOM a person may already have used, and the
       * click that checked a radio happened before any handler existed to tell the store about it —
       * so re-asserting the server's choice here would throw the interaction away and nothing would
       * ever put it back. Recorded, not written, exactly as the other form properties are; the
       * first state-driven render after that applies live semantics normally.
       */
      if (!adopting) {
        const liveTarget = this._element as unknown as Record<string, unknown>;
        if (liveTarget[this._name] !== value) liveTarget[this._name] = value;
      }
      return index + this._slots;
    }
    if (value !== this._committed) {
      this._committed = value;
      if (kind === ATTR) {
        /**
         * The removal is unconditional, including on the first commit.
         *
         * It used to be skipped then, on the reasoning that a fresh clone has no such attribute —
         * true unless the template *statically* carries one, and `<b title="a" title=${null}>` does.
         * The binding is authoritative because it is written last, and the server agrees; skipping
         * left `title="a"` in the browser against no attribute at all server-side. One DOM call per
         * nullish attribute binding on first render is what that costs.
         */
        if (value == null) this._element.removeAttribute(this._name);
        else this._element.setAttribute(this._name, value as string);
      } else if (kind === PROPERTY) {
        const target = this._element as unknown as Record<string, unknown>;
        const name = this._name;
        /**
         * **Adopting a form value: record it, do not write it.**
         *
         * `value`, `checked` and `selected` are exactly the properties `@verajs/ssr` mirrors into
         * markup, so the element already holds what this binding says — *unless a person changed
         * it*, which is the entire reason to server-render: the page is usable before the bundle
         * lands, and the window between the two is where someone types their name, ticks a box or
         * picks an option. Writing the binding then threw that away, silently, on every hydrating
         * page. The part is told it already committed this value, so it stays live and the next
         * genuine state change still applies.
         *
         * Only these three, and only while adopting. A property the server cannot express — any
         * other `.prop` — is not in the DOM yet and must be written.
         */
        if (adopting && (name === 'value' || name === 'checked' || name === 'selected'))
          return index + this._slots;
        target[name] = value;
        /**
         * Detection only, and deliberately not repair.
         *
         * A property set on a custom element that has not upgraded yet lands as an own property on
         * the instance. When the definition arrives — lazily imported, code-split, or a module that
         * simply had not run — `customElements.define` upgrades synchronously and the class's field
         * initializers execute. At target ES2022 a field declaration is a `[[Define]]`, so
         * `item?: T` emits `item;` and overwrites the bound value with `undefined`. Nothing throws;
         * it reads as broken reactivity.
         *
         * Repairing it was tried and removed. Re-applying when the slot came back `undefined`
         * covered `item?: T` but not `item = someDefault`, which overwrites with the default and
         * never looks clobbered — so the repair was silently partial, and made the bug intermittent
         * across two spellings of the same mistake. It also cost 74 B in every app while leaving
         * `declare` mandatory anyway, because a property assigned imperatively is unrecoverable:
         * the renderer never saw it, and by the time `init()` runs the value is already gone.
         *
         * So this is `__DEV__`-only and production pays nothing — no check, no message, no
         * `whenDefined` subscription. Lit reached the same place from the other direction and
         * throws (`lit.dev/msg/class-field-shadowing`); a warning suffices here because Vera has no
         * prototype accessors to shadow permanently — the damage is one lost value, not a property
         * that never updates again.
         */
        if (__DEV__) {
          const tag = this._element.localName;
          if (tag.indexOf('-') > 0 && !customElements.get(tag)) {
            customElements.whenDefined(tag).then(() => {
              /**
               * States what was observed rather than diagnosing it. A class field is the usual
               * cause by a wide margin, but a component that assigns the property itself during
               * upgrade produces the same observation, and that is a legitimate — if confusing —
               * thing to do, since the renderer's dirty check will not re-apply the bound value on
               * the next render either.
               */
              if (target[name] !== value)
                console.warn(
                  `@verajs/renderer: the value bound by \`.${name}=\${…}\` on <${tag}> was replaced ` +
                    `while the element upgraded. A class field is the usual cause: at ES2022 ` +
                    `\`${name}?: …\` emits \`${name};\`, which runs during upgrade and overwrites ` +
                    `whatever was set beforehand — write it \`declare ${name}?: …\` instead, which ` +
                    `emits nothing. A plain field also wipes properties assigned imperatively, ` +
                    `which cannot be detected at all. Ignore this if the component replaced the ` +
                    `value on purpose.`
                );
            });
          }
        }
      } else if (kind === BOOLEAN) {
        /** Unconditional for the same reason: `<b hidden ?hidden=${false}>` must end up not hidden. */
        this._element.toggleAttribute(this._name, !!value);
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
        else if (typeof value === 'object') {
          /**
           * A self-applying value: anything that knows what to do with an element applies itself.
           * `@verajs/renderer/spread` is the first, and the whole protocol is this one property
           * read — the implementation lives in that entry, so an app that never spreads pays for
           * the check and nothing else. `_$…$` is exempt from property mangling, like `_$litType$`.
           *
           * Deliberately confined to the element position, which is rare. A protocol in the text,
           * attribute or property commits would sit in the hot path every benchmark measures.
           */
          const self = value as { _$apply$?: (el: Element, part: object) => void; value: unknown };
          /** The part is passed as the ownership key: one element can carry several spreads. */
          if (self._$apply$) self._$apply$(this._element, this);
          else self.value = this._element;
        }
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
const SCRATCH = doc.createDocumentFragment();

/**
 * A value that names the strategy able to reconcile a list of its kind. `keyed()` in
 * `@verajs/renderer/keyed` is the only producer today; the shape is deliberately open so a
 * virtualizer or an async list can ship as its own module without this file learning about it.
 *
 * `$r` and the three members it calls are exempt from property mangling — they are the only names
 * that cross a bundle boundary, and they are two characters so crossing costs nothing.
 */
export type ListStrategy = (
  part: ChildPart,
  values: unknown[],
  items: Item[],
  parent: Node,
  end: Node | null
) => Item[];

export type KeyedResult = TemplateResult & { $r?: ListStrategy };

type Item = {
  $k: unknown;
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

/**
 * A value at a child position that applies itself — see `ChildPart._set`.
 *
 * `previous` is whatever this directive returned at this part on the last render, which is where a
 * directive keeps its continuity. Returning nothing is fine for one that has none.
 */
export type ChildDirective = (part: { _$commit$(value: unknown): void }, previous: unknown) => unknown;

/**
 * A value at a child position the renderer has no built-in answer for. Return `true` to claim it.
 *
 * A handler will also be handed the **operations** it needs to do its job — the shape
 * `'proxy-handler'` uses, where core passes `addCallback` and `runCallbacks` rather than exposing
 * them as members. That object is deliberately *not* here yet: an earlier draft guessed nine
 * methods, nothing used them, they cost 90 B of anticipation, and porting the list algorithm then
 * showed it needs closer to fourteen — including item accessors the guess had no idea about. It
 * gets built in the step that has a caller to shape it.
 *
 * This is how a value *kind* becomes a package rather than a branch: lists, an async value, a
 * portal, a virtualizer. The built-ins below register through it too, so a third party's kind is
 * not second-class to one that shipped in the box.
 */
export type ValueHandler = (part: object, value: unknown) => boolean | void;

/**
 * The registry this renderer reads `'value'` handlers from, handed over by {@link renderer}.
 *
 * Not imported. The renderer carries no registry of its own for the same reason the router does
 * not: a production bundle inlines `@verajs/inserts`, so importing it would give this package one
 * registry and core another, and an app would register into whichever it happened to import — the
 * failure `connectInserts` used to repair.
 */
let registry: { get(name: 'value'): ValueHandler[] | undefined } | null = null;
const noHandlers: ValueHandler[] = [];
const valueHandlers = () => (registry ? (registry.get('value') ?? noHandlers) : noHandlers);

/**
 * Kinds this package still ships. They read from a local list rather than the registry because the
 * renderer cannot register into one it was merely handed — that needs `wire`, which it does not
 * import. The list empties when they move to packages; until then a wired handler is checked first,
 * so a module can pre-empt a built-in exactly as the priority order promises.
 */
const builtIns: ValueHandler[] = [];

/** What a ChildPart currently contains. */
const EMPTY = 0;
const TEXT = 1;
const TEMPLATE = 2;
const LIST = 3;
const NODE = 4;

/**
 * Development-only profiling hook, armed by `@verajs/renderer/profiler`. Null until something
 * arms it, so an unprofiled development render pays one null check per template commit.
 *
 * Every reference sits behind `__DEV__`, which `defineDev()` folds to `false` before terser runs —
 * so the declaration, the constants and every call site are removed from the production bundle.
 * Verified by byte comparison, not assumed.
 */
const PROFILE_UPDATE = 0; // same template identity — values committed in place
const PROFILE_CREATE = 1; // first template into an empty part
const PROFILE_REBUILD = 2; // template identity CHANGED — subtree torn down and rebuilt
const PROFILE_FRAME_START = 3;
const PROFILE_FRAME_END = 4;

type ProfileHook = (kind: number, subject: unknown, shape: TemplateStringsArray | null) => void;
let _profileHook: ProfileHook | null = null;
/** @internal */
const _setProfileHook = (fn: ProfileHook | null) => {
  _profileHook = fn;
};

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
  /** Whatever the last `_$child$` at this part returned — its continuity across renders. */
  _directive: unknown = undefined;
  /** Which directive that state belongs to, so two of them at one part cannot read each other's. */
  _directiveFn: unknown = undefined;

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
    const end = this._end;
    /**
     * When this part owns its parent's entire contents, one `textContent = ''` replaces removing
     * every node individually. For a 1 000-row table body that is the difference between ~22 ms
     * (lit-html's per-node teardown) and ~5 ms.
     *
     * A part owns the whole parent when nothing precedes its start AND nothing follows its end —
     * `_end === null` (a root part, which runs to the end by definition) or `_end` is the last
     * child. The second case is the common one and used to miss this path entirely: every list
     * written as `<tbody>${rows}</tbody>` sits inside a template, and since 0.1.2 a nested part
     * always owns an end marker, so `_end === null` alone never held for it.
     *
     * Re-appending both anchors in order restores the part's boundary exactly as it was.
     */
    if (this._start.previousSibling === null && (end === null || end.nextSibling === null)) {
      parent.textContent = '';
      parent.appendChild(this._start);
      if (end !== null) parent.appendChild(end);
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
    this._directive = undefined;
    this._directiveFn = undefined;
  }

  /**
   * How a child-position directive renders. Named to survive property mangling — `/^_[a-z]/` is the
   * pattern, and `_$…$` does not match it — because this is the half of the protocol that third
   * parties call.
   */
  _$commit$(value: unknown) {
    /**
     * The directive's own state survives its own rendering. Committing different content usually
     * runs `_clear`, which drops the state so a part that was emptied by *anything else* cannot
     * hand a directive continuity it no longer has — but a directive rendering its own next value
     * has not gone away, and losing continuity there made `until()` fall back to its placeholder on
     * the render after it resolved.
     */
    const directive = this._directive;
    const directiveFn = this._directiveFn;
    this._set(value);
    this._directive = directive;
    this._directiveFn = directiveFn;
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
        if (__DEV__ && _profileHook) _profileHook(PROFILE_UPDATE, this, value.strings);
        this._instance!._update(value.values);
        return;
      }
      /**
       * Reaching here with a template already committed means the identity changed, so the
       * subtree below is about to be destroyed and rebuilt rather than updated. That is what
       * `?hidden=${…}` over a swapped subtree exists to avoid, and it is otherwise invisible.
       */
      if (__DEV__ && _profileHook) {
        _profileHook(this._mode === TEMPLATE ? PROFILE_REBUILD : PROFILE_CREATE, this, value.strings);
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
    const handlers = valueHandlers();
    for (let i = 0; i < handlers.length; i++) if (handlers[i](this, value)) return;
    for (let i = 0; i < builtIns.length; i++) if (builtIns[i](this, value)) return;

    /**
     * **A child-position value that applies itself.** The same idea as `_$apply$` at element
     * position — which is how `@verajs/renderer/spread` ships as a separate package the renderer
     * knows nothing about — at the one other position worth extending.
     *
     * `_$child$(part, previous)` is handed the part and whatever it returned last time at this
     * part, and calls `part._$commit$(value)` to render content. Keeping continuity in the return
     * value rather than in a directive *instance* is what keeps this a protocol rather than a
     * framework: there is no base class, no factory and no lifecycle to learn, and a directive is
     * an object literal.
     *
     * Placed **after** the template check on purpose. A template is overwhelmingly the common
     * object at a child position, and it returns above without ever reading this property — so the
     * check costs the hot path nothing and only arrays, nodes and directives pay for it. Measured:
     * +22 B gzipped, and no runtime difference distinguishable from noise.
     *
     * There is deliberately no teardown hook. `_clear` bulk-removes DOM and, when the part owns its
     * parent, does `parent.textContent = ''` — the thing that makes clearing a 1 000-row table ~5 ms
     * against lit-html's ~22 ms. Calling teardown on a nested directive would mean walking the part
     * tree on every removal, which is precisely the per-node work that fast path exists to skip. So
     * a directive here can render, and cannot yet be told it has gone away.
     */
    const applyChild = (value as { _$child$?: ChildDirective })._$child$;
    if (applyChild !== undefined) {
      /** `previous` belongs to *this* directive; a different one at the same part starts fresh. */
      const previous = this._directiveFn === applyChild ? this._directive : undefined;
      this._directiveFn = applyChild;
      this._directive = applyChild.call(value, this, previous);
      return;
    }
    if ((value as Node).nodeType !== undefined) {
      /**
       * A DOM node renders as itself — a canvas a charting library owns, a `<template>`'s content,
       * an element built by hand. Placed after the template check and before the list check
       * because `nodeType` is one property read and nothing else that reaches here has one.
       */
      if (this._mode !== NODE || this._value !== value) {
        if (this._mode !== EMPTY) this._clear();
        this._insert(value as Node);
        this._value = value;
        this._mode = NODE;
      }
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
  $c(value: unknown, parent: Node, ref: Node | null): Item {
    if (value !== null && typeof value === 'object' && (value as TemplateResult).strings !== undefined) {
      const result = value as TemplateResult;
      const template = getTemplate(result);
      const instance = new Instance(template);
      instance._update(result.values);
      const rootNode = instance._fragment.firstChild;
      if (rootNode !== null && rootNode.nodeType === 1 && rootNode.nextSibling === null) {
        parent.insertBefore(rootNode, ref);
        return {
          $k: result.key,
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
      return { $k: result.key, _element: null, _instance: null, _shape: null, _part: part };
    }
    const part = createMarkeredPart(parent, ref);
    part._set(value);
    return { $k: (value as TemplateResult)?.key, _element: null, _instance: null, _shape: null, _part: part };
  }

  /** Commits a new value into an existing item, demoting element mode if the shape changed. */
  $u(item: Item, value: unknown) {
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
  $f(item: Item): Node {
    return item._element ?? item._part!._start;
  }

  /**
   * Moving and removing an item read `_element` and `_part`, which are mangled — so they stay here
   * rather than travelling with the algorithm that calls them. `$m` and `$d` are the price: two
   * cold methods, exempt from mangling, two characters each.
   */
  $m(item: Item, ref: Node | null, parent: Node = this._start.parentNode!) {
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
  $d(item: Item) {
    this.$m(item, null, SCRATCH);
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
    const isKeyed = newValues[0] != null && (newValues[0] as KeyedResult).$r !== undefined;
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
      for (let i = 0; i < count; i++) items.push(this.$c(newValues[i], fragment, null));
      this._insert(fragment);
      return;
    }

    if (!isKeyed) {
      // index mode: update in place, grow at the end, shrink from the end
      const shared = items.length < count ? items.length : count;
      for (let i = 0; i < shared; i++) this.$u(items[i], newValues[i]);
      if (count > items.length) {
        const fragment = doc.createDocumentFragment();
        for (let i = items.length; i < count; i++) items.push(this.$c(newValues[i], fragment, null));
        this._insert(fragment);
      } else if (count < items.length) {
        const last = items[items.length - 1];
        let node: Node | null = this.$f(items[count]);
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
     * Keyed reconciliation is not here. It lives in `@verajs/renderer/keyed`, and it arrives on
     * the values themselves — `keyed()` stamps each result with the strategy that understands it,
     * so importing the marker is what loads the algorithm. Nothing registers, nothing is wired, and
     * two strategies cannot disagree about a list because the list names its own.
     *
     * The protocol is three cold members (`$c`, `$u`, `$f`) plus a returned array. Everything a
     * strategy would otherwise have to reach for — the mode switch, the empty case, the initial
     * fill — is already done above and passed in.
     */
    this._items = (newValues[0] as KeyedResult).$r!(this, newValues, items, parent, this._end);
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
  if (__DEV__ && _profileHook) _profileHook(PROFILE_FRAME_START, container, null);
  let part = rootParts.get(container);
  if (part === undefined) {
    const marker = comment();
    container.appendChild(marker);
    rootParts.set(container, (part = new ChildPart(marker, null)));
  }
  part._set(result);
  if (__DEV__ && _profileHook) _profileHook(PROFILE_FRAME_END, container, null);
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
  NODE,
  comment,
  doc,
  toText,
  isTemplateResult,
  instanceWalker,
  rootParts,
  _setProfileHook,
  PROFILE_UPDATE,
  PROFILE_CREATE,
  PROFILE_REBUILD,
  PROFILE_FRAME_START,
  PROFILE_FRAME_END,
};
/** @internal */
export type { Part, Item, TemplatePart };


/**
 * Lists, as a registered kind rather than a branch — the built-in going through the same door a
 * package will. Moving it to `@verajs/renderer/lists` is step 5; nothing else has to change when
 * it does, which is what this shape is for.
 */
builtIns.push((part, value) => {
  if (Array.isArray(value)) {
    (part as ChildPart)._commitList(value);
    return true;
  }
  if (value !== null && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
    (part as ChildPart)._commitList([...(value as Iterable<unknown>)]);
    return true;
  }
  return false;
});

/**
 * Everything this renderer needs, in one entry: `wire([renderer])`.
 *
 * It registers on the `'render'` chain *and* takes the registry, because a package that both
 * provides a capability and reads one should not cost an app two lines. This replaced
 * `setRenderer`, which existed only because there was no general way to say "this app has a
 * renderer" — and which resolved the shadow root at registration, so a renderer wired any other
 * way silently rendered into the light DOM. That resolution lives in core's dispatch now.
 */
/**
 * A `__DEV__`-only hint for `wire`, and the reason the descriptor can safely be called `renderer`
 * while the raw function beside it is `render`.
 *
 * Wiring the wrong one is otherwise **silent**: a bare function has no `on`, so `wire` reads it as a
 * connector and hands it the registry. Nothing registers, nothing throws, and the page renders
 * nothing for a reason two characters wide. The marker lets `wire` name the export that was meant.
 *
 * `$module` is deliberately generic — any package exporting a raw function next to a module of a
 * similar name can set it. Production carries neither the property nor the check that reads it.
 */
if (__DEV__) (render as unknown as { $module?: string }).$module = 'renderer';

export const renderer = {
  name: '@verajs/renderer',
  on: 'render' as const,
  fn: render as never,
  priority: 50,
  connect: (given: { get(name: 'value'): ValueHandler[] | undefined }) => {
    registry = given;
  },
};
