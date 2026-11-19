/**
 * **`@verajs/static`'s renderer: a template result to markup, judged by the HTML parser, never letting a value become
 * code** (2026-11-18). A regex scan of where each hole sits was tried first and the placement fuzz found four tokenizer
 * cases it misread in a row (RCDATA swallowing an end tag, `<plaintext>` never closing, a vertical tab in a tag name,
 * the never-shown elements): a scanner grows forever, the parser cannot be wrong about the parser. So:
 *
 * 1. **Write** (`toMarkup`): each value is ENCODED — every character but a letter, digit or `_` as `&#N;`, so no value can
 *    hold a space, quote, `>`, `=` or `<` and none can make structure — and wrapped in two SENTINELS (U+0001, U+0002;
 *    an encoded value never holds one), so the parse shows where every value landed.
 * 2. **Judge** (`judge`): the markup parsed once in a `<template>` (it is parsed once anyway), and walked. A value in an
 *    element or attribute NAME or the content of a non-JSON `<script>`, `iframe`,
 *    `noscript`, the obsolete raw-text four or a `<template>` is REFUSED (`static-hole`); an event-handler or `srcdoc`
 *    attribute holding one is left out (core's and lite's rule); in a URL attribute its whole
 *    decoded value is checked for `javascript:` and removed when it is one; in an HTML `style` or JSON data block (raw
 *    text) it is TEXT (Brian, 2026-11-17), decoded back and written as data, never parsed; elsewhere — text, `title`,
 *    `textarea`, an attribute — the parser decoded it, and only its sentinels go.
 * 3. **Move** the judged nodes into the root — never re-serialized and parsed again (a second parse is where mutation
 *    XSS lives).
 *
 * Formatting alone is still decided from the markup written so far (`IN_VALUE`): an object or list in an attribute value
 * is its text, as core writes it, and an unquoted value before `/>` keeps the slash out. A misread there changes only the
 * format: the judge decides safety.
 */
import { INLINE_HANDLER, JSON_BLOCK, SCRIPT_URL_ITEM, SHARED, URL_SINK, diagnostic, misuse, warnOnce } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import type { TemplateResult } from './types.js';

/**
 * A value as markup-inert text, between sentinels: every ASCII character but a letter, digit or `_` as a numeric
 * reference. Only ASCII is ever structural in HTML (a name, a quote, whitespace, `<`, `>`, `=`), so everything else is
 * written as it is — referencing it would GARBLE it: a reference to a UTF-16 surrogate half (an emoji's) becomes U+FFFD,
 * and `&#128;`–`&#159;` become Windows-1252 characters (U+0080 is `€`), both by the spec (found in review, 2026-11-18).
 */
const encode = (value: unknown) => `\u0001${`${value}`.replace(/[^\w\u0080-\uffff]/g, (c) => `&#${c.charCodeAt(0)};`)}\u0002`;
/**
 * **An attribute value that is no value** (2026-11-19, core's rules, found by the tier suites): a span holding U+0003,
 * which no encoded value holds (it is ASCII, so `encode` references it). Alone in an attribute's value the attribute is
 * REMOVED — `null`/`undefined` (core removes a nullish single-expression attribute), a false `?name`, and behavior static
 * does not have; beside other text it is nothing, as core joins a nullish value as ''.
 */
const NULLISH = '\u0001\u0003\u0002';
/** The text any object renders as — what a template-SHAPED object that is no template renders, never converted. */
const FORGED = `${{}}`;

/**
 * The attribute whose value the markup so far ends inside — in a start tag (quote-aware, lite's `IN_TAG`), double-quoted,
 * single-quoted or unquoted, each by its own rule (lite's `WRITTEN_NAME`). For FORMATTING only (see above): its group
 * says the value is unquoted. In a tag, or `x =` in text would read as an attribute (the verdict differential).
 */
const IN_VALUE = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*?[\s/]([^\s"'>/=]+)\s*=\s*(?:"[^"]*|'[^']*|([^\s"'>]*))$/;

/**
 * **A value in an attribute named `name`** (2026-11-19, the tier suites: `?hidden`, `.value` and `@click` were WRITTEN
 * as attributes of those names, a function's source as the value). `?name` takes the value's truth — present, or removed
 * — as core's boolean binding does; a `.prop`, `!live` or `@event` binding, or a FUNCTION in any attribute, is behavior
 * static does not have: nothing is written (development names what does it), so app code never lands in the markup.
 * `null`/`undefined` write `NULLISH`; anything else its text, as core writes it.
 */
const attributeValue = (name: string, value: unknown): string => {
  const sigil = name[0];
  if (sigil === '?') return value ? '\u0001\u0002' : NULLISH;
  if ('.!@'.includes(sigil!) || typeof value === 'function') {
    if (__DEV__)
      warnOnce('static', `${name}=\${…}`, 'static-needs-renderer', __DEV__ && (() => PROSE['static-needs-renderer'](typeof value === 'function' && sigil !== '@' ? `a function in the attribute \`${name}\`` : `the binding \`${name}\``)), name);
    return NULLISH;
  }
  return value == null ? NULLISH : encode(value);
};

const refuse = () => {
  throw new TypeError(misuse('static', 'static-hole', __DEV__ && PROSE['static-hole']()));
};

/** A tagged template literal's strings: an array owning `raw` (core's and lite's check, identical). */
const literal = (strings: unknown) => Array.isArray(strings) && Object.hasOwn(strings, 'raw');

/**
 * A child value as markup: a template's (if genuine), a list's items', nothing for `null`/`undefined`, else encoded text —
 * core's child rule, so `false` and `0` render as the word and the digit, as in core and lite (2026-11-18: static wrote
 * nothing for `false`, a difference in every text hole, found by the lite/static differential once it held falsy values).
 */
export const toMarkup = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'function') {
    if (__DEV__) warnOnce('static', 'a child value', 'static-needs-renderer', __DEV__ && (() => PROSE['static-needs-renderer']('a function (an event handler, a render function)')), 'function');
    return '';
  }
  if (Array.isArray(value)) {
    let out = '';
    for (const item of value) out += toMarkup(item);
    return out;
  }
  if ((value as TemplateResult)._$litType$ && literal((value as TemplateResult).strings)) return render(value as TemplateResult);
  if (typeof value === 'object') {
    /**
     * Template-SHAPED but no template — a forgery (`JSON.parse`) or a wrapper only core's `hold`/`tag` build: the text any
     * object renders as, NEVER converted (its own `toString` may be data that throws), as core renders a forgery.
     */
    const strings = (value as { strings?: unknown }).strings;
    if (strings !== undefined) {
      if (__DEV__ && literal(strings)) warnOnce('static', 'a child value', 'template-wrapper', __DEV__ && (() => SHARED.templateWrapper()), 'template-wrapper');
      else if (__DEV__) console.warn(diagnostic('static', 'a child value', 'forged-template', __DEV__ && SHARED.forgedTemplate()));
      return encode(FORGED);
    }
    /** Any other iterable that is not a node is a list — core's child rule (a `Set`, a `Map`, a generator). */
    if (typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' && (value as Node).nodeType === undefined) return toMarkup([...(value as Iterable<unknown>)]);
  }
  return encode(value);
};

/** A template's markup: its statics, and each hole's value written by `toMarkup`, or as text in an attribute value. */
const render = ({ strings, values }: TemplateResult): string => {
  let out = strings[0]!;
  for (let i = 1; i < strings.length; i++) {
    const value = values[i - 1];
    const attribute = IN_VALUE.exec(out);
    /** In an attribute value a value is its text (an object or list as core writes it); an unquoted one before `/>` gets a space. */
    out += (attribute === null ? toMarkup(value) : attributeValue(attribute[1]!, value) + (attribute[2] !== undefined && strings[i]!.startsWith('/>') ? ' ' : '')) + strings[i]!;
  }
  return out;
};

/** Elements a value never enters, by name in any namespace: code, or content never shown (lite's set). */
const NEVER = /^(?:script|iframe|noscript|xmp|noembed|noframes|plaintext|template)$/;
/** The sentinels, and a value span between them (its encoded text). */
// eslint-disable-next-line no-control-regex -- the sentinels ARE control characters: ones no encoded value holds
const SENTINELS = /[\u0001-\u0003]/g;
/**
 * Whether `text` holds either sentinel. Either, not only the first: the parser can SPLIT a value's span across nodes
 * (foster-parenting moves text out of a table), leaving a node with the closing one alone (found by the verdict
 * differential, 2026-11-18).
 */
// eslint-disable-next-line no-control-regex -- the same
const marked = (text: string) => /[\u0001\u0002]/.test(text);
// eslint-disable-next-line no-control-regex -- the sentinels ARE control characters: ones no encoded value holds
const SPAN = /\u0001([^\u0002]*)\u0002/g;
/**
 * A raw-text element's text with each value span decoded back, the COMPOSED text then kept unable to end its element
 * should the markup ever be serialized and parsed again (a browser serializes raw text as it is), as `@verajs/ssr`
 * writes it: every `</style` as `<\/style` in CSS (a closer can form across a hole; statics alone never hold one), every
 * `<` as `\u003c` in JSON — both lossless.
 */
const decode = (text: string, json: boolean) => {
  const raw = text.replace(SPAN, (_, span: string) => span.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(+code)));
  return json ? raw.replace(/</g, '\\u003c') : raw.replace(/<\/(style)/gi, '<\\/$1');
};

/**
 * Walks what the parser built under `parent`: refuses, checks or cleans every place a value landed (see the top). Under
 * a `<template>` (`strict`), ANY value refuses — its content is never shown, and is a fragment of its own, outside
 * `childNodes` and `textContent`, so it is entered explicitly, nested templates and attributes included.
 */
const judge = (parent: Node, strict: boolean): number => {
  /** The value spans seen here (their opening sentinels), so `renderInto` can tell whether every one written landed. */
  let seen = 0;
  for (let node = parent.firstChild; node !== null; node = node.nextSibling)
    if (node.nodeType === 1) {
      const element = node as Element;
      const name = element.localName;
      if (marked(name)) refuse();
      for (const attribute of [...element.attributes]) {
        if (marked(attribute.name)) refuse();
        seen += spans(attribute.value);
        if (!marked(attribute.value)) continue;
        if (strict) refuse();
        /**
         * A value in an event-handler or `srcdoc` attribute would run as code or markup: the attribute is not written, as
         * `@verajs/core` and `@verajs/lite` leave it out (development names it); the rest of the template renders.
         */
        if (INLINE_HANDLER.test(attribute.name) || attribute.name === 'srcdoc') {
          /** Core's codes and words (one refusal, one name across the tiers); the alternative is each emitter's own. */
          if (__DEV__ && attribute.name === 'srcdoc')
            console.warn(diagnostic('static', `<${name}>`, 'srcdoc-attribute', __DEV__ && SHARED.srcdocAttribute('`.srcdoc=${…}` in `@verajs/lite` or `@verajs/core`')));
          else if (__DEV__)
            console.warn(diagnostic('static', `<${name}>`, 'handler-attribute', __DEV__ && SHARED.handlerAttribute(attribute.name, `\`data-vd-on-${attribute.name.slice(2)}\` with \`@verajs/directives\`, or \`@${attribute.name.slice(2)}=\${…}\` in \`@verajs/lite\` or \`@verajs/core\``)));
          element.removeAttribute(attribute.name);
          continue;
        }
        /**
         * Gone: a whole value that is no value (`NULLISH`) and a binding static does not have (`.prop`, `!live`, `@event`,
         * even beside text); a `?name` that stays is the attribute `name`, present (`attributeValue`).
         */
        const sigil = attribute.name[0]!;
        if (attribute.value === NULLISH || '.!@?'.includes(sigil)) {
          element.removeAttribute(attribute.name);
          if (sigil === '?' && attribute.value !== NULLISH) element.setAttribute(attribute.name.slice(1), '');
          continue;
        }
        const value = attribute.value.replace(SENTINELS, '');
        /** Every URL name checked item by item (`;`-separated): a superset of the whole-URL check, so it over-refuses only. */
        if (URL_SINK.test(attribute.name) && SCRIPT_URL_ITEM.test(value)) element.removeAttribute(attribute.name);
        /** `setAttribute`, not `attribute.value =`: the server's DOM hands out copies of its attributes (a browser's are live). */
        else element.setAttribute(attribute.name, value);
      }
      const content = (element as HTMLTemplateElement).content;
      if (content !== undefined) seen += judge(content, true);
      /**
       * RAW text, where the parser decodes nothing — an HTML `<style>` or JSON data block (Brian, 2026-11-17: a value there
       * is text): its spans decoded back and written as data, never parsed. `title` and `textarea` (RCDATA) and SVG's or
       * MathML's `style` are decoded by the parser already, so their values are ordinary text, below.
       *
       * `tagName` is upper case exactly for an HTML element in an HTML document: SVG's and MathML's `style` keep their
       * case. Static renders in HTML documents only: in an XHTML (XML) document the template parses as XML, where the
       * sentinels are not legal characters, so the render throws — refused, never misread (`tests/static.test.mjs`).
       */
      if (!strict && (element.tagName === 'STYLE' || (element.tagName === 'SCRIPT' && JSON_BLOCK.test(element.getAttribute('type') ?? '')))) {
        /** Read only here and below: `textContent` walks its subtree, and read for every element it would cost n × depth. */
        const text = element.textContent!;
        seen += spans(text);
        if (marked(text)) element.textContent = decode(text, name === 'script').replace(SENTINELS, '');
      } else if (strict || NEVER.test(name)) {
        if (marked(element.textContent!)) refuse();
        seen += judge(element, true);
      } else seen += judge(element, false);
    } else if (marked((node as CharacterData).data)) {
      if (strict) refuse();
      seen += spans((node as CharacterData).data);
      (node as CharacterData).data = (node as CharacterData).data.replace(SENTINELS, '');
    }
  return seen;
};
/** How many value spans `text` holds — counted by their opening sentinel, which no encoded value or static holds. */
const spans = (text: string) => text.split('\u0001').length - 1;

/**
 * **Renders `result` into `root`**: written, parsed in a `<template>` of the root's document, judged, and moved in. The
 * server's DOM parses into the template itself, and declines markup it cannot reproduce: a sentinel left in what it
 * declined was never judged, so the render is refused.
 */
export const renderInto = (result: unknown, root: Element | ShadowRoot) => {
  const template = root.ownerDocument.createElement('template');
  const markup = toMarkup(result);
  template.innerHTML = markup;
  const parsed: Node = template.content ?? template;
  /**
   * **Every value written must land** (2026-11-19, S4, the tier suites): the parser DROPS some markup outright — a
   * duplicated attribute's second occurrence, with the value static wrote there — and a value that vanished was never
   * judged. Lite refuses such a template; so does static: no span written may be missing. MORE may land than were
   * written — the parser clones a formatting element (`<a>`, `<font>`…) with its attributes when it reopens one, and a
   * value in them lands twice, each copy judged — so only fewer refuses. Measured on the placement fuzz's corpus
   * (6400 templates, a unique marker per hole): every one of the 170 templates this newly refuses had lost a value.
   */
  if (judge(parsed, false) < spans(markup)) refuse();
  if (template.content === undefined && marked(template.innerHTML)) refuse();
  root.replaceChildren(...parsed.childNodes);
};
