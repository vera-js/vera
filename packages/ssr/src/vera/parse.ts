/**
 * A conservative HTML fragment parser, for giving markup a node view.
 *
 * **This exists to answer `querySelector`, not to render.** Markup assigned as a string used to have
 * no nodes at all, so `children` was empty and every query answered `null` while the content sat
 * plainly in the output. Parsing it is what closes that.
 *
 * Three rules shape everything here:
 *
 * 1. **Never change what the page renders.** Each element keeps the exact source text of its own
 *    tags, so re-serializing a parsed tree reproduces the input byte for byte — quoting style,
 *    entity spelling, attribute order and interior whitespace included. Only an element somebody
 *    *mutates* falls back to canonical output, which is the same rule the rest of this DOM follows.
 *    The caller re-serializes and compares anyway (`nodes.js`), so a defect here costs a declined
 *    parse rather than a corrupted page.
 * 2. **Decline rather than guess.** Anything needing the HTML spec's error recovery — misnested
 *    formatting, foster parenting, foreign content — returns `null` and the markup stays a string.
 *    A wrong tree is far worse than no tree: it would answer a query confidently and be wrong.
 * 3. **Never disagree with a real parser.** `tests/ssr-parse-differential.test.mjs` runs a corpus
 *    through both this and parse5 and fails on any input where the two produce *different* trees.
 *    Declining is allowed; disagreeing is not. parse5 is a devDependency and stays one — it is the
 *    oracle, never a runtime dependency.
 */
import { NEWLINE_TAKERS, RAW_TEXT_ELEMENTS, asciiLower, RCDATA_ELEMENTS, VOID_ELEMENTS, commentEnd, commentDataEnd, decodeCodePoint, leadingNewline, normalizeNewlines as normalized, tokenNul } from './escaping.js';
import type { CommentShim, ElementShim, TextShim } from './nodes.js';
import { RAW_TEXT_TAGS, TEXT_ONLY_TAGS, rawTextCloserAt as closerAt } from './tokenizer.js';
import type { InsertFunctionMap, ReferenceInsert } from '@verajs/core';

/**
 * The entity spellings this package emits, plus the handful every document uses: answered here, with their `;`. A
 * `Map`, because a plain object answers for `Object.prototype`'s names too: `&constructor;` decoded to the source text
 * of `Object` (2026-11-25).
 */
const NAMED = new Map<string, string>([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' ']]);
/**
 * A numeric reference decodes without its `;` too. A named one's run is every letter and digit after the `&` and an
 * optional `;`: what the `'reference'` chain is handed, since the tokenizer reads the longest NAME the run begins with
 * and keeps the rest as text (`&notin` is `¬in`).
 */
const ENTITY = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*;?))/g;

/**
 * **What the server hands this file once core has loaded** (`connectServer`, from `index.ts`): core's registry, read only
 * for a name outside `NAMED`, and the warning for such a name with nothing wired. This file cannot import core, because
 * core evaluates after the server's shims are installed and this file before them. It imports no diagnostics either:
 * importing them here, which `index.ts` already does, cost importing `@verajs/ssr` about 0.8% (fresh processes, Node,
 * 2026-11-26). One value, set once, as `frames.ts` holds core's flush (`setCoreFlush`). Until then, and on a server that
 * wires nothing on `'reference'`, a name outside the six reads back as written.
 */
let server: { readonly registry: Pick<Map<keyof InsertFunctionMap, unknown[]>, 'get'>; readonly unwired: (written: string) => void } | undefined;

/** Hands this file the server's registry and its warning for an unwired name (`index.ts`, once core has loaded). */
export const connectServer = (connected: NonNullable<typeof server>): void => {
  server = connected;
};

/**
 * A name outside the six, read by the first `'reference'` module wired (`@verajs/ssr/named-references`: the whole
 * table, by the tokenizer's rules). With none it reads back as written, as it always did, while a browser decodes
 * `&hellip;`, so that is said, for a name written with its `;`: without one, the run is as often a query string's
 * `&b=2` or `AT&T`, which a browser keeps too, and only the table can tell them apart.
 */
const namedReference = (run: string, attribute: boolean, after: number): string => {
  const chain = server?.registry.get('reference') as ReferenceInsert[] | undefined;
  if (chain !== undefined && chain.length !== 0) return chain[0]!(run, attribute, after);
  if (run.charCodeAt(run.length - 1) === 59) server?.unwired(`&${run}`);
  return `&${run}`;
};

/** One reference, in text or in an attribute value. */
const reference = (attribute: boolean, match: string, decimal: string | undefined, hex: string | undefined, run: string | undefined, at: number, source: string): string =>
  decimal
    ? decodeCodePoint(Number(decimal))
    : hex
      ? decodeCodePoint(parseInt(hex, 16))
      : /** Neither number matched, so a name did: one of the six is answered at once. */
        (run!.charCodeAt(run!.length - 1) === 59 ? NAMED.get(run!.slice(0, -1)) : undefined) ?? namedReference(run!, attribute, source.charCodeAt(at + match.length));
/** One callback per context, at module level, so neither closes over `attribute`. */
const inText = (match: string, decimal?: string, hex?: string, run?: string, at?: number, source?: string): string => reference(false, match, decimal, hex, run, at!, source!);
const inAttribute = (match: string, decimal?: string, hex?: string, run?: string, at?: number, source?: string): string => reference(true, match, decimal, hex, run, at!, source!);
/**
 * **Character references, decoded — owned here and shared.** Decimal, hex and every named reference of the HTML
 * Standard (every name outside the six through `namedReference`), in text; `decodeAttribute` is the same for an attribute value's
 * text, where a legacy name before `=` or an alphanumeric stays as written. Two functions of one argument, not one with
 * an `attribute` flag: the flag's default parameter cost template parsing 2.4–2.8% steady with no `&` in the markup
 * (measured, Node, 2026-11-25), because every text node pays for it. `index.js` kept a lesser copy (decimal only, and
 * `String.fromCharCode`, which TRUNCATES above U+FFFF) that was safe only while `escapeHtml`'s table stayed decimal and
 * BMP — an invariant no test held. One decoder instead, so a change to what this package escapes cannot silently
 * outrun what it can decode.
 */
export const decode = (text: string): string => (text.includes('&') ? text.replace(ENTITY, inText) : text);
/** `decode` for an attribute value's text: the HTML tokenizer's attribute exception for a legacy name (`&ampx=1`). */
export const decodeAttribute = (text: string): string => (text.includes('&') ? text.replace(ENTITY, inAttribute) : text);

/**
 * **Implied end tags.** A start tag in the value set closes an open element of the key's name — the
 * rule that makes `<li>a<li>b` two siblings rather than a nest. This is the part of the spec that
 * well-formed markup actually depends on; everything past it is error recovery.
 */
const CLOSED_BY: Partial<Record<string, ReadonlySet<string>>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option', 'optgroup']),
  optgroup: new Set(['optgroup']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['tr', 'td', 'th']),
  thead: new Set(['tbody', 'tfoot']),
  tbody: new Set(['tbody', 'tfoot']),
  tfoot: new Set(['tbody']),
  rt: new Set(['rt', 'rp']),
  rp: new Set(['rt', 'rp']),
};

/**
 * Elements whose end tag the spec makes optional, so finding one still open at the end of a fragment
 * is well-formed markup rather than error recovery. `<ul><li>a<li>b</ul>` and a trailing `<p>text`
 * are both ordinary hand-written HTML and both end with something open.
 */
const OPTIONAL_END_TAG = new Set([
  'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'rt', 'rp',
]);

/** A `<p>` is closed by any of these opening, which is the one implied-end rule with a long list. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main',
  'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

/** Nothing is refused outright any more — see `OPAQUE` for what `<template>` does instead. */
const REFUSED = new Set<string>();

/**
 * **Foreign content is kept whole.** `svg` and `math` switch the spec into rules this parser does
 * not implement — self-closing tags mean something different, names stay case-sensitive, and
 * attributes are adjusted (`viewBox`, not `viewbox`). Guessing at the interior would produce a tree
 * a real parser disagrees with.
 *
 * So the element itself is modeled and its **content is kept as one opaque chunk**: the surrounding
 * markup parses normally, the icon is an element you can find and style, and nothing inside it is
 * claimed. Refusing the whole fragment instead — which is what this used to do — meant a card with
 * an icon in it got no node view at all, which is a great deal to give up for one `<svg>`.
 */
const FOREIGN = new Set(['svg', 'math']);

/**
 * **`<template>` is kept opaque too, for the same reason and by the same mechanism.**
 *
 * Its content is a separate document fragment, which this DOM does not model — so the parse used to
 * REFUSE any markup containing one. That is the heavier version of the mistake the `<svg>` comment
 * above describes: declining the whole fragment meant a component with a `<template>` anywhere in
 * its markup got no node view at all, so every `querySelector` on it answered emptily. Measured
 * against a real DOM, one empty `<template>` was enough to turn `querySelectorAll('*')` from three
 * elements into none — silently.
 *
 * That cost real behavior. `@verajs/renderer/slots` finds a component's `<slot>` positions with a
 * query, so a light-DOM component whose markup held a `<template>` distributed on the client and
 * not on the server: a server/client divergence, from markup nobody would suspect.
 *
 * Keeping the interior opaque is also the honest answer rather than merely the convenient one. A
 * real DOM does not match template content from the host either — `host.querySelector('b')` never
 * finds a `<b>` inside a `<template>`. The chunk is the template's CONTENT, a fragment of its own
 * (`templateElement` in `nodes.ts`, 2026-11-23), never its children, and it is parsed when a node view
 * of the content is asked for, as any chunk is.
 */
const OPAQUE = new Set([...FOREIGN, 'template']);

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * **Which rules a chunk of markup is parsed under** (2026-11-18): HTML's; SVG's or MathML's (foreign content); or HTML's
 * inside a MathML TEXT integration point (`<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`), where `<mglyph>` and
 * `<malignmark>` would be MathML and are declined. ONE namespace per parse: `<svg>` and `<math>` in HTML, and every
 * integration point in foreign content, stay opaque boundaries, and their interior is parsed in its own namespace when
 * a node view of it is asked for (`nodes.ts`'s `parseChunks`, with `contentSpace`).
 */
type Space = 'html' | 'svg' | 'math' | 'math-text';

/** MathML's text integration points: their content is HTML. */
const MATH_TEXT = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

/** The space an element's CONTENT is parsed in — what an interior kept opaque under it is read as. */
export const contentSpace = (element: { readonly localName: string; readonly namespaceURI: string | null; getAttribute(name: string): string | null }): Space => {
  const name = element.localName;
  if (element.namespaceURI === SVG_NS) return name === 'foreignObject' || name === 'desc' || name === 'title' ? 'html' : 'svg';
  if (element.namespaceURI !== MATHML_NS) return 'html';
  if (MATH_TEXT.has(name)) return 'math-text';
  return name === 'annotation-xml' && htmlEncoded(element.getAttribute('encoding')) ? 'html' : 'math';
};

/** An `<annotation-xml>` whose `encoding` makes its content HTML (an HTML integration point). */
const htmlEncoded = (encoding: string | null | undefined): boolean => {
  const value = asciiLower(encoding ?? '');
  return value === 'text/html' || value === 'application/xhtml+xml';
};

/**
 * **Start tags that BREAK OUT of foreign content** (the spec's list, "in foreign content"; `<font>` with `color`, `face`
 * or `size` too, and the end tags `</br>` and `</p>`): a real parser pops out of the `<svg>` or `<math>` and continues in
 * HTML, which this parser does not reproduce — so it declines them, and the markup stays a string.
 */
const BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small',
  'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);

/** SVG's mixed-case element names, as the parser adjusts them (the spec's table, keyed lower case). */
const SVG_TAGS = new Map(
  ['altGlyph', 'altGlyphDef', 'altGlyphItem', 'animateColor', 'animateMotion', 'animateTransform', 'clipPath', 'feBlend',
    'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
    'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage',
    'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
    'feTurbulence', 'foreignObject', 'glyphRef', 'linearGradient', 'radialGradient', 'textPath'].map((name) => [name.toLowerCase(), name])
);

/** SVG's mixed-case attribute names, as the parser adjusts them (the spec's table, keyed lower case). */
const SVG_ATTRIBUTES = new Map(
  ['attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode', 'clipPathUnits', 'diffuseConstant',
    'edgeMode', 'filterUnits', 'glyphRef', 'gradientTransform', 'gradientUnits', 'kernelMatrix', 'kernelUnitLength',
    'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust', 'limitingConeAngle', 'markerHeight', 'markerUnits',
    'markerWidth', 'maskContentUnits', 'maskUnits', 'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform',
    'patternUnits', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'preserveAlpha', 'preserveAspectRatio', 'primitiveUnits',
    'refX', 'refY', 'repeatCount', 'repeatDur', 'requiredExtensions', 'requiredFeatures', 'specularConstant',
    'specularExponent', 'spreadMethod', 'startOffset', 'stdDeviation', 'stitchTiles', 'surfaceScale', 'systemLanguage',
    'tableValues', 'targetX', 'targetY', 'textLength', 'viewBox', 'viewTarget', 'xChannelSelector', 'yChannelSelector',
    'zoomAndPan'].map((name) => [name.toLowerCase(), name])
);

/**
 * An attribute name as the parser stores it on an element in `namespace`: SVG's and MathML's adjusted case. A prefixed
 * name (`xlink:href`, `xmlns:xlink`) keeps its qualified name; its NAMESPACE is not modeled (`getAttributeNS` and an
 * attribute's `namespaceURI` differ from a browser's) — what a selector, `getAttribute` and serialization see agree.
 */
const adjustAttribute = (name: string, namespace: string): string =>
  namespace === SVG_NS ? (SVG_ATTRIBUTES.get(name) ?? name) : namespace === MATHML_NS && name === 'definitionurl' ? 'definitionURL' : name;

/**
 * **The attribute-name charset, owned here and shared: HTML's tokenizer rule.** A first character that is not
 * whitespace, `/` or `>`, then anything but those and `=`. Deliberately WIDE — every real engine accepts `a.b`, `a(b)`,
 * `a|b` and `a?b` (recorded in the repo's conventions), so a narrower charset does not reject those names, it
 * MIS-PARSES them. That held for quotes and `<` too (2026-11-23): Chromium, Firefox and WebKit read `<x a"b="v">` as
 * the one attribute `a"b`, and `=a` as the name `=a`; the rebuild in `index.js` read `a""` plus a `b="v"` nobody wrote.
 *
 * Exported because `index.js` scans the same grammar when it rebuilds a nested component from the
 * open tag this module wrote. It kept its own `[\w:-]+` copy, which split `data-a.b="v"` into
 * `data-a=""` and `b="v"` — the child then read the wrong attributes, server-side only. Same fact, two spellings, one of them wrong: CODE-PRINCIPLES #5, and the same fix
 * `RAW_TEXT_ELEMENTS` already got in this package.
 */
export const ATTRIBUTE_NAME = "[^\\t\\n\\f\\r />][^\\t\\n\\f\\r />=]*";
/**
 * **One attribute, as a start tag carries it**: the name, then optionally `=` with whitespace on either side and a
 * double-quoted, single-quoted or unquoted value (captures: name, double, single, bare). Shared with `scan.ts`, which
 * rebuilt a nested component from its open tag with its own copy that allowed no whitespace around `=`:
 * `<x-kid title = "a b">` gave the child `title=""`, `a=""` and `b=""` (2026-11-23).
 */
export const ATTRIBUTE_SOURCE = `(${ATTRIBUTE_NAME})(?:[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*(?:"([^"]*)"|'([^']*)'|([^\\t\\n\\f\\r >]*)))?`;
const ATTRIBUTE = new RegExp(`^${ATTRIBUTE_SOURCE}`);

/**
 * **Every element whose content the parser reads as text, from the tokenizer that owns the list** (2026-11-23): its
 * raw-text and text-only elements, and `<noscript>` (scripting on). This parse kept escaping's six-name set, which
 * lacks `xmp`, `noembed`, `noframes` and `plaintext`, so `<xmp><img src=x onerror=…></xmp>` assigned through
 * `innerHTML` gave a query an `<img>` that every engine reads as text. A `<plaintext>` has no end tag: its parse finds
 * no closer and declines, as an unclosed raw-text element does. Their text still serializes escaped (`TextShim.markup`).
 */
const PARSED_AS_TEXT = new Set([...RAW_TEXT_ELEMENTS, ...RAW_TEXT_TAGS, ...TEXT_ONLY_TAGS]);

/**
 * **Whether a name is already among the first `count` attributes** (2026-11-23). HTML's tokenizer keeps the FIRST of
 * a repeated attribute and drops the rest, so `<a href="javascript:…" href="/safe">` is a `javascript:` link in every
 * engine. Kept the last, this DOM answered `/safe` while the page it served navigated to the first: a check made on
 * this DOM was not a check of the page. A plain loop: a tag has a handful of attributes.
 */
export const heldAt = (attributes: ReadonlyArray<readonly [string, string]>, count: number, name: string): boolean => {
  for (let i = 0; i < count; i++) if (attributes[i]![0] === name) return true;
  return false;
};

/** The node factories `parseFragment` builds with; the caller owns node identity, so this file never imports the DOM it builds. */
type NodeFactories = {
  readonly element: (name: string, namespaceURI?: string) => ElementShim;
  readonly text: (data: string) => TextShim;
  readonly comment: (data: string) => CommentShim;
};

/** The fragment's root: the frame at the bottom of the stack, never closed, built or handed out. */
type RootFrame = { readonly children: Child[]; readonly localName: '#root' };

/**
 * An element parsed but not yet built: its real node, and its children until the shape is known to be sound. `markup`
 * is absent — what tells a frame from the Text and Comment nodes beside it, which carry a `markup()` method (`build`).
 */
type ElementFrame = {
  readonly element: ElementShim;
  readonly children: Child[];
  readonly localName: string;
  closeTag: string;
  foreign: boolean;
  readonly markup?: undefined;
};

/** One parsed child: a frame, a Text or Comment node, or a foreign/`<template>` interior kept as one opaque string. */
type Child = ElementFrame | TextShim | CommentShim | string;

/**
 * Parse a fragment into entries — elements and raw text.
 *
 * @param markup
 * @param create node factories; the caller owns node identity, so this file never imports the DOM it builds
 * @returns entries, or `null` when the markup needs more than this will guess at
 */
export const parseFragment = (
  markup: string,
  create: NodeFactories,
  space: Space = 'html'
): Array<ElementShim | TextShim | CommentShim | string> | null => {
  if (typeof markup !== 'string' || markup === '') return null;
  /**
   * Whether a NUL is anywhere in the markup, asked once: `tokenNul` runs on a name or a value only then. Asked per name
   * and value, the check cost a 50 KB article's parse 2.5% cold and 4.4% at steady state (Node 24's V8, 2026-11-23).
   */
  const nul = markup.includes('\0');
  /** Foreign content: `/>` closes, names are case-adjusted, nothing is raw text, nothing closes implicitly. */
  const foreign = space === 'svg' || space === 'math';
  const namespace = space === 'svg' ? SVG_NS : space === 'math' ? MATHML_NS : undefined;

  const root: RootFrame = { children: [], localName: '#root' };
  const stack: Array<RootFrame | ElementFrame> = [root];
  const open = () => stack[stack.length - 1];
  let index = 0;
  let text = '';

  /**
   * A text run becomes a node carrying **both** its decoded value and the bytes it came from — the
   * value is what `textContent` should answer, and the bytes are what re-serializing has to write
   * back. Keeping only the bytes made `textContent` return `a &amp; b`; keeping only the value
   * would have rewritten the page as `a &#38; b`.
   */
  const flushText = () => {
    if (text !== '') {
      const node = create.text(decode(normalized(text)));
      node._source = text;
      open().children.push(node);
    }
    text = '';
  };

  while (index < markup.length) {
    const next = markup.indexOf('<', index);
    if (next === -1) {
      text += markup.slice(index);
      break;
    }
    text += markup.slice(index, next);

    /**
     * The character after `<`, read once: only `!` and `?` open a comment of either kind, so a tag pays one read here
     * rather than a prefix test per kind (three of them cost a cold 50 KB parse about 1.5%, measured 2026-11-23).
     */
    const sigil = markup.charCodeAt(next + 1);
    /** A comment keeps its bytes, for the round trip, beside the data component code reads. */
    if (sigil === 33 && markup.startsWith('<!--', next)) {
      const end = commentEnd(markup, next);
      if (end === -1) return null;
      flushText();
      /** A NUL in comment data is U+FFFD, as the tokenizer reads it — as in a name or a value. */
      const data = normalized(markup.slice(next + 4, commentDataEnd(markup, next, end)));
      const node = create.comment(nul ? tokenNul(data) : data);
      node._source = markup.slice(next, end);
      open().children.push(node);
      index = end;
      continue;
    }
    /**
     * **`<!` not opening a comment, and `<?`, open a BOGUS comment to the first `>`** (2026-11-23): `a<!x>b<?y>c` is
     * the text `a`, a comment `x`, `b`, a comment `?y` and `c` to every parser, and it was read here as one text run
     * holding the markup — component code reading it back saw what no browser has. The node keeps its bytes, as a
     * comment does. A doctype, which a fragment's parser drops (no node to carry its bytes), and `<![CDATA[` in foreign
     * content, a text section there, are declined.
     */
    const bang = sigil === 33;
    if (bang || sigil === 63) {
      if (bang && ((foreign && markup.startsWith('<![CDATA[', next)) || asciiLower(markup.slice(next + 2, next + 9)) === 'doctype')) return null;
      const end = markup.indexOf('>', next);
      if (end === -1) return null;
      flushText();
      const data = normalized(markup.slice(bang ? next + 2 : next + 1, end));
      const node = create.comment(nul ? tokenNul(data) : data);
      node._source = markup.slice(next, end + 1);
      open().children.push(node);
      index = end + 1;
      continue;
    }

    /* ── an end tag ──────────────────────────────────────────────────────────────────────────── */
    if (markup.startsWith('</', next)) {
      const end = markup.indexOf('>', next);
      if (end === -1) return null;
      /**
       * The end tag's name runs to HTML's whitespace, `/` or `>` (a tokenizer's rule; `trim` also takes `\v` and U+00A0).
       * Found by a character loop: a regex on a fresh slice per end tag cost a 50 KB parse 4–5% (measured on Node 24's V8,
       * 2026-11-22).
       */
      let stop = next + 2;
      for (let c = markup.charCodeAt(stop); stop < end && c !== 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13 && c !== 47; c = markup.charCodeAt(++stop));
      const name = asciiLower(nul ? tokenNul(markup.slice(next + 2, stop)) : markup.slice(next + 2, stop));
      if (!name) return null;
      flushText();
      /**
       * Foreign content closes only the open element, by name (any case), and `</br>` and `</p>` break out of it: anything
       * else is error recovery, declined.
       */
      if (foreign) {
        if (name === 'br' || name === 'p' || stack.length === 1 || asciiLower(open().localName) !== name) return null;
        (open() as ElementFrame).closeTag = markup.slice(next, end + 1);
        stack.pop();
        index = end + 1;
        continue;
      }
      /** Close through anything the spec would have closed implicitly; anything else is recovery. */
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].localName !== name) {
        if (!CLOSED_BY[stack[depth].localName] && stack[depth].localName !== 'p') return null;
        depth--;
      }
      if (depth === 0) return null;
      /** `depth` is above 0 here — the root returned just above — so this is an element's frame. */
      (stack[depth] as ElementFrame).closeTag = markup.slice(next, end + 1);
      stack.length = depth;
      index = end + 1;
      continue;
    }

    /* ── a start tag ─────────────────────────────────────────────────────────────────────────── */
    /**
     * The tag name: a letter, then everything up to HTML's whitespace, `/` or `>`. Found by a character loop, as the end
     * tag's is: a pattern on a fresh slice per start tag cost a cold 50 KB parse about 1% (measured on Node 24's V8,
     * 2026-11-22).
     */
    const first = markup.charCodeAt(next + 1);
    let after = next + 2;
    for (let c = markup.charCodeAt(after); after < markup.length && c !== 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13 && c !== 47 && c !== 62; c = markup.charCodeAt(++after));
    if (!((first >= 97 && first <= 122) || (first >= 65 && first <= 90))) {
      /** A bare `<` that is not a tag is text in the spec, and text is all it can be here. */
      text += '<';
      index = next + 1;
      continue;
    }
    const name = asciiLower(nul ? tokenNul(markup.slice(next + 1, after)) : markup.slice(next + 1, after));
    if (REFUSED.has(name)) return null;
    /** A start tag that leaves foreign content, or a MathML element inside a MathML text integration point: declined. */
    if (foreign ? BREAKOUT.has(name) || name === 'font' : space === 'math-text' && (name === 'mglyph' || name === 'malignmark')) return null;
    /**
     * The element's namespace: the foreign content's; `<svg>` and `<math>` open theirs in HTML; and an `<svg>` directly
     * inside MathML's `<annotation-xml>` is SVG (the spec's one exception).
     */
    const elementNamespace =
      foreign && !(space === 'math' && name === 'svg' && open().localName === 'annotation-xml') ? namespace!
      : name === 'svg' ? SVG_NS
      : name === 'math' ? MATHML_NS
      : undefined;

    let cursor = after;
    const attributes: Array<[string, string]> = [];
    for (;;) {
      /** HTML's whitespace between attributes, a character at a time: no slice, no pattern (the same measurement). */
      const c = markup.charCodeAt(cursor);
      if (c === 32 || c === 9 || c === 10 || c === 12 || c === 13) {
        cursor++;
        continue;
      }
      if (markup.startsWith('/>', cursor) || markup[cursor] === '>') break;
      const attribute = ATTRIBUTE.exec(markup.slice(cursor));
      if (!attribute || cursor >= markup.length) return null;
      /**
       * A name led by `=` is one HTML's parser keeps (`<p =a>` holds `=a`) and `setAttribute` refuses: this DOM builds
       * through `setAttribute`, so it declines here, never a throw.
       */
      if (markup.charCodeAt(cursor) === 61) return null;
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const lower = asciiLower(nul ? tokenNul(attribute[1]) : attribute[1]);
      const named = elementNamespace === undefined ? lower : adjustAttribute(lower, elementNamespace);
      /** A repeated name is dropped: the FIRST is the attribute, as the tokenizer keeps it (see `heldAt`). */
      if (heldAt(attributes, attributes.length, named)) {
        cursor += attribute[0].length;
        continue;
      }
      attributes.push([named, decodeAttribute(nul ? tokenNul(normalized(value)) : normalized(value))]);
      cursor += attribute[0].length;
    }
    const selfClosing = markup.startsWith('/>', cursor);
    const end = markup.indexOf('>', cursor);
    if (end === -1) return null;
    const openTag = markup.slice(next, end + 1);

    flushText();
    /** The implied end tags, before this element joins the stack (HTML's rule: foreign content has none). */
    for (; !foreign; ) {
      const current = open().localName;
      const closes = CLOSED_BY[name]?.has(current) || (current === 'p' && CLOSES_P.has(name));
      if (!closes || stack.length === 1) break;
      stack.pop();
    }

    /**
     * **A row directly inside `<table>` is declined.** The spec inserts an implied `<tbody>` there,
     * and this parser cannot both reproduce the input byte for byte (which forbids inventing that
     * tag) and agree with a real parser about the tree (which requires it). Markup that writes the
     * section itself parses normally, so the common explicit form is unaffected.
     */
    if (!foreign && (name === 'tr' || name === 'td' || name === 'th') && open().localName === 'table') return null;

    /**
     * **A name the DOM rejects is a DECLINE, never a throw.** The tag name is deliberately loose
     * (a letter, then anything but HTML's whitespace, `/` or `>`) so recovery can see odd names, but that lets a malformed start tag
     * like `<p<div>` yield the name `p<div`, which `createElement` refuses with a DOMException —
     * and an uncaught throw here takes the whole server render down, naming createElement rather
     * than the component. This file's contract is "match a real parser or decline (return null)";
     * a throw is neither. So a rejected name declines the fragment, landing on the same
     * "could not be parsed" path a stray close tag does. Found by an adversarial probe.
     */
    let element: ElementShim;
    try {
      element = elementNamespace === undefined ? create.element(name) : create.element(elementNamespace === SVG_NS ? (SVG_TAGS.get(name) ?? name) : name, elementNamespace);
    } catch {
      return null;
    }
    for (const [attributeName, value] of attributes) element.setAttribute(attributeName, value);
    element._sourceOpenTag = openTag;
    /**
     * **`''` means "no end tag in the source", which is different from "not parsed".** `<li>a<li>b`
     * closes the first item implicitly and writing `</li>` back would add bytes the input never had
     * — the round-trip would fail and this whole parse would be discarded for markup that is
     * perfectly ordinary. An element built by `createElement` has no source close tag at all and
     * still gets the canonical one.
     */
    const node: ElementFrame = { element, children: [], localName: name, closeTag: '', foreign: false };
    open().children.push(node);
    index = end + 1;
    /**
     * **The line feed the parser takes** right after this start tag (`NEWLINE_TAKERS`) is not content, so it is no
     * text node's. It stays in the bytes as part of the source tag — which is how `serializeElement` knows the markup
     * already carries one and adds none.
     */
    if (!foreign && NEWLINE_TAKERS.has(name)) {
      const taken = leadingNewline(markup, index);
      if (taken !== 0) {
        element._sourceOpenTag += markup.slice(index, index + taken);
        index += taken;
      }
    }

    /** A void element never has children and never has an end tag. */
    if (!foreign && VOID_ELEMENTS.has(name)) continue;
    /**
     * `<div/>` is **not** self-closing in HTML — the slash is ignored and the element stays open.
     * Treating it as closed is a common and quiet way to build the wrong tree, so it declines. In foreign content it IS
     * self-closing (2026-11-18): the element is closed, with no end tag to write back.
     */
    if (selfClosing) {
      if (foreign) continue;
      return null;
    }

    /**
     * An opaque boundary: in HTML, `<svg>`, `<math>` and `<template>`; in foreign content, an integration point (its
     * content is HTML: `contentSpace`) and the SVG an `<annotation-xml>` opens.
     */
    const opaque = foreign
      ? elementNamespace !== namespace ||
        (space === 'svg' ? name === 'foreignobject' || name === 'desc' || name === 'title'
        : MATH_TEXT.has(name) || (name === 'annotation-xml' && htmlEncoded(attributes.find(([n]) => n === 'encoding')?.[1])))
      : OPAQUE.has(name);
    /**
     * An opaque interior runs to its matching end tag and is kept verbatim, nesting counted so an
     * `<svg>` inside an `<svg>` closes the right one.
     */
    if (opaque) {
      let depth = 1;
      let closeAt = -1;
      const opener = new RegExp(`<(/?)${name}\\b`, 'giu');
      opener.lastIndex = index;
      for (let found = opener.exec(markup); found; found = opener.exec(markup)) {
        depth += found[1] ? -1 : 1;
        if (depth === 0) {
          closeAt = found.index;
          break;
        }
      }
      if (closeAt === -1) return null;
      const closeEnd = markup.indexOf('>', closeAt);
      if (closeEnd === -1) return null;
      if (index !== closeAt) node.children.push(markup.slice(index, closeAt));
      node.closeTag = markup.slice(closeAt, closeEnd + 1);
      node.foreign = true;
      index = closeEnd + 1;
      continue;
    }

    /** Raw text runs to its own end tag and is never parsed as markup (HTML's rule: foreign content has none). */
    if (!foreign && PARSED_AS_TEXT.has(name)) {
      const close = closerAt(markup, index, name);
      if (close === -1) return null;
      const closeEnd = markup.indexOf('>', close);
      if (closeEnd === -1) return null;
      /** Raw text is not markup: a `<script>` means its bytes exactly, line breaks normalized; RCDATA is decoded. */
      if (index !== close) {
        const bytes = markup.slice(index, close);
        const raw = create.text(RCDATA_ELEMENTS.has(name) ? decode(normalized(bytes)) : normalized(bytes));
        raw._source = markup.slice(index, close);
        node.children.push(raw);
      }
      node.closeTag = markup.slice(close, closeEnd + 1);
      index = closeEnd + 1;
      continue;
    }
    stack.push(node);
  }
  flushText();
  /**
   * What is still open at the end is fine if the spec would have closed it implicitly, and is error
   * recovery otherwise — an unclosed `<div>` is a mistake this parser will not guess about.
   */
  while (!foreign && stack.length > 1 && OPTIONAL_END_TAG.has(open().localName)) stack.pop();
  if (stack.length !== 1) return null;

  /** Build the real nodes now that the shape is known to be sound. */
  const build = (node: ElementFrame): ElementShim => {
    /**
     * An HTML `<template>`'s interior, kept as one chunk, is its content's markup (`templateElement`, which holds it as a
     * string until `content` is read), never its children. Asked once per element, by name: reading a field for every
     * child of every element cost a parse of a template-heavy article about 2% (Node A/B, 2026-11-23).
     */
    const template = node.localName === 'template' && node.element._raw !== undefined;
    for (const child of node.children) {
      /** One chunk by construction: an opaque interior is pushed whole, up to its matching end tag, and nothing after it. */
      if (template && typeof child === 'string') node.element._raw = child;
      else if (typeof child === 'string' || typeof child.markup === 'function') {
        node.element._entries.push(child);
        if (typeof child !== 'string') child._parent = node.element;
      } else {
        build(child);
        /**
         * Pushed rather than appended: `appendChild` marks an unrendered registered component so
         * the scan can find that instance, which would write a marker attribute into markup this
         * parse must reproduce exactly — and would enroll a node nobody is going to render.
         */
        node.element._entries.push(child.element);
        child.element._parent = node.element;
      }
    }
    node.element._sourceCloseTag = node.closeTag;
    /** Marked so anything comparing this tree knows the interior is not modeled. */
    return node.element;
  };
  return root.children.map((child) =>
    typeof child === 'string' || typeof child.markup === 'function' ? child : build(child)
  );
};
