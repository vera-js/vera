/**
 * **The server's one tag scanner** — the HTML tokenizer's own states, from a `<` to its tag's `>`, plus the tree-builder
 * facts that change how the next character parses: raw text, comments, `<template>` content, foreign content and its
 * HTML integration points. Every reader of markup on the server reads it through this: the template compiler
 * (`serializer.ts` — where a hole is text, an attribute value or raw text), the `.innerHTML` inertness scan (`fortify`),
 * and the component scanner (`scan.ts` — where a registered component tag is live). They each ran their own copy
 * once, and every copy drifted from the tokenizer differently; one scanner cannot disagree with itself.
 */
import type { Open, ScanResult, ScanStart, ScanState, ScannedTag } from './types.js';
import { VOID_ELEMENTS, asciiLower } from './escaping.js';
import { PROSE } from './diagnostics.js';
import { own, ssrMisuse } from './report.js';

/**
 * Where a static leaves us: inside a tag, and if so, inside an attribute **value**.
 *
 * The two are different questions and only the second separates `<input ${ref} />` from
 * `<b class="a ${x} c">`. Both are values inside a tag; only the first is an *element position*,
 * where the renderer hands the element to a ref or a spread and there is no markup to write. The
 * second is text between two halves of an attribute the statics already carry.
 *
 * A tail test cannot answer it, because the quote that opened the value may be several statics
 * back — `class="a ` ends in a space and is still inside a value. So the state is carried, one
 * character at a time, and only at compile time: this runs once per template, ever.
 */
/**
 * The two **RAWTEXT** elements. A browser does not decode a character reference inside either, so
 * escaping their content does not protect anything and does corrupt it — `<style>` gets `.a &#62; .b`
 * for `.a > .b`, a selector that matches nothing, and a `<script>` gets broken source.
 *
 * `<title>` and `<textarea>` are **RCDATA**, not RAWTEXT: references *are* decoded there, so those
 * two keep ordinary escaping, which is also what the client produces. They are deliberately not in
 * this set.
 */
const RAWTEXT = new Set(['style', 'script']);
/**
 * Every other element whose content the BROWSER never reads as markup: they keep ordinary escaping — the one
 * direction that is always safe — but nothing inside them is a tag, so a `<style>` written inside one is text.
 *
 * **The proof the raw path rests on:** this scanner writes a value UNESCAPED only inside a `<style>`/`<script>` it
 * saw open at foreign depth 0, and every other doubt resolves to escaping. Reading raw text as markup over-escapes —
 * a visible difference, never an injection; reading markup as raw text writes a value's `<img onerror>` into the
 * page. So the set has to hold everything the parser treats as raw: the first three are the client's `RAW_TEXT_TAGS`;
 * `xmp`, `noembed`, `noframes` and `plaintext` are obsolete (the client's scanner lists them too since 2026-11-19, as
 * never-shown content), and the browser still parses them as raw text — without them, `<xmp><style>${x}</style></xmp>` wrote `x` raw inside what the
 * browser reads as one run of text, and `</xmp>` in the value closed it. `plaintext` never closes at all, and the scan
 * reads it that way (no `</plaintext` ends it), so a template or value that opens one ends inside it, which `compile`
 * and `fortify` refuse: no closer exists, and served, it made the rest of the page its text.
 *
 * `<noscript>` — the client's fourth — is not here, because it is not always raw: a browser with scripting OFF, the
 * one that shows it, parses its content as markup, so `<noscript><a href="${url}">` must be URL-checked like any
 * other link. It is a depth instead, beside foreign content (see `scanTag`): read as markup, with raw text never
 * recognized inside, so every value in it is escaped — which is safe under both parses.
 */
const TEXT_ONLY = new Set(['textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes', 'plaintext']);
/**
 * **The HTML elements never open around markup** (2026-11-26, a rotated-seed find): a raw-text or text-only element
 * holds only text, which its own end tag ends, and a void element is closed as it opens, so neither is ever an ancestor
 * of a tag. An end tag of one of these names, in SVG or MathML, that closes no element the template opened is handed to
 * the HTML rules and closes nothing there either: it is ignored, and the namespace stays known (see the end-tag rule in
 * `structural`). Made unknown, `<math></style><p><x-kid>` left the `<p>` no breakout to act on, and the scan missed a
 * component the browser upgrades (Chromium, Firefox and WebKit: the `<p>` leaves MathML). `br` is left out (`</br>` is
 * a breakout), and so is `noscript`, whose content is markup with scripting off.
 * **That holds for HTML elements only.** In SVG or MathML these names (`link`, `input`, `wbr`, `style`… none a breakout)
 * are foreign elements, which hold markup, and a parent template's `<svg><link>` can be open around a child whose
 * `</link>` really closes it. Ignoring the tag is still safe: a foreign element's parent is always foreign (only
 * `<svg>` and `<math>` leave HTML, and the rule leaves both out), so closing one keeps the parse in SVG or MathML.
 */
const NEVER_AROUND_MARKUP = new Set([...RAWTEXT, ...TEXT_ONLY, ...[...VOID_ELEMENTS].filter((name) => name !== 'br')]);
/**
 * **The HTML integration points: foreign elements whose content the parser reads as HTML.** In SVG, `foreignObject`,
 * `desc` and `title`; in MathML, the text integration points `mi`, `mo`, `mn`, `ms` and `mtext`, and an
 * `annotation-xml` whose `encoding` is `text/html` or `application/xhtml+xml` (ASCII case-insensitive). Each is one
 * ONLY in its own namespace — `<math><foreignObject>` is a MathML element and its content MathML — and only when not
 * self-closed, since foreign content honors `/>`. Inside a MathML text integration point, `mglyph` and `malignmark`
 * are the exception: the dispatcher keeps them foreign, so their content is MathML again.
 */
const SVG_POINTS = new Set(['foreignobject', 'desc', 'title']);
const MATH_TEXT_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
const HTML_ENCODINGS = new Set(['text/html', 'application/xhtml+xml']);
/**
 * **The breakout tags: start tags that END foreign content** — the parser pops out of `<svg>`/`<math>` to the nearest
 * HTML element or integration point and reads the tag as HTML (`<svg><p><style>` is an HTML style, its content raw
 * text). Exactly the standard's list, plus `font` with a `color`, `face` or `size` attribute (`FONT_BREAKOUT`, tracked
 * per tag in `font`). `</p>` and `</br>` are the two end tags that do.
 */
/**
 * **The scope elements that only owe a closer**: a `<table>` or `<object>` (and the obsolete `<applet>`, `<marquee>`)
 * left open by a template or a value made the PARENT's next markup its content — `<div><table><tr><td></div><p>`
 * parses the `<p>` into the cell, since `</div>` cannot close across a table, and an `<object>` the same way — where the
 * client, which parses each template into a fragment, closes them at its end. Tracked so `closersOf` writes their end
 * tags; nothing inside them parses differently, so a tag below one keeps the fast path (see `scanTag`).
 */
const CLOSE_ONLY = new Set(['table', 'object', 'applet', 'marquee']);
/** The elements that change how what follows them parses, when read in HTML — see the fast path in `scanTag`. */
const STRUCTURAL = new Set(['svg', 'math', 'noscript', 'select', 'template', ...CLOSE_ONLY, ...RAWTEXT, ...TEXT_ONLY]);
/**
 * **`<font>` breaks out when it carries `color`, `face` or `size`** (any case, any value): the standard's conditional
 * breakout, which this scan once never applied — so `<svg><font color=x><style>` was read as SVG while the browser
 * reads an HTML style, its content raw text, and values after it were placed where the browser does not put them. Only
 * a STATIC such attribute counts: one with a hole in its value can be removed by a nullish value, and the client's own
 * template parse never sees it (its bound attributes are renamed to markers before parsing), so the server keeps the
 * no-breakout reading there, which escapes every value — safe under both readings.
 */
export const FONT_BREAKOUT = new Set(['color', 'face', 'size']);
const BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small',
  'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);



/**
 * **Where a tag scan stands: the HTML tokenizer's own states**, from a `<` to its tag's `>`, so this scanner reads a
 * tag exactly where the browser does. It used to approximate them — a name stopped at the first character outside
 * `[a-zA-Z0-9-]`, any `<` opened a tag, any `=` opened a value, a quote anywhere opened one — and every difference
 * was a place where the two disagreed about what is markup. `<script.x>` read as a `<script>` (the browser reads an
 * unknown element named `script.x`), so a hole inside it was written raw and a value's `<img onerror>` ran; `<b x">`
 * read the quote as opening a value (the tokenizer reads it as part of the name `x"`), so the `.innerHTML` scan that
 * shared none of this missed the live `<script>` after it. Each state below is the tokenizer's, under its name in the
 * HTML standard; the value states are `inValue`/`quote`.
 */
const OUTSIDE = 0;
const TAG_OPEN = 1;
const END_TAG_OPEN = 2;
const TAG_NAME = 3;
const BEFORE_ATTRIBUTE_NAME = 4;
const ATTRIBUTE_NAME = 5;
const AFTER_ATTRIBUTE_NAME = 6;
const AFTER_ATTRIBUTE_VALUE = 7;
const SELF_CLOSING = 8;


/** The tokenizer's whitespace — never `\s`, which also takes `\v` and U+00A0, both NAME characters to a tokenizer. */
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\f' || c === '\r';
const isAlpha = (c: string | undefined): boolean => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
/** The tokenizer lowercases ASCII only; `toLowerCase` also folds the Kelvin sign into `k`. */
const lowerAscii = (c: string): string => (c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c);
/** What may follow `</name` for it to END a raw-text or text-only element: the tokenizer's "appropriate end tag". */
const endsName = (c: string | undefined): boolean => isSpace(c) || c === '/' || c === '>';







/** What `scanTag` reports to `fortify`, as (position, edit) pairs — see `fortify`. */
const EDIT_INERT = 0;
const EDIT_SHADOW_ROOT = 1;

/**
 * The entry an end tag named `name` closes, or `-1`. The search stops at an open `<template>` — inside its content an
 * end tag closes nothing outside it — and an end tag this scan never opened closes nothing at all. It used to lower
 * the depth for `</svg>`, `</math>` and `</noscript>`, guessing it closed an element a parent template opened, but the
 * parser closes only what is actually open: inside `<math>` a `</svg>` is ignored, so `<math></svg><style>${v}` read
 * the style as HTML raw text while the browser parsed MathML markup, and a value's `<img onerror>` ran. Keeping the
 * depth only ever over-escapes.
 */
const closeTo = (opens: Open[], name: string): number => {
  let at = opens.length - 1;
  while (at >= 0 && opens[at].name !== name && opens[at].name !== 'template' && !holdsText(opens[at])) at--;
  return at >= 0 && opens[at].name === name ? at : -1;
};

/**
 * **A text element tracked where the parse is not certain holds until its own end tag** — see `structural`, which
 * tracks a text-only element or `<style>` in `<noscript>`/`<select>` markup or where the namespace is unknown. In at
 * least one reading the browser is in that element's TEXT, which only its own end tag ends: current engines read
 * `<select><title>` as an HTML title, so in `<select><title></select><style>${v}` the `</select>` is title text, the
 * scan's pop to depth 0 wrote the value raw, and its `</title>` closed the browser's title and injected (Chromium,
 * Firefox and WebKit; the older select parser, parse5's, ignores the title, which is why jsdom never showed it). So no
 * other end tag closes past it; the content is still scanned as markup, which over-escapes in every reading.
 * **A `<script>` there holds the same way** (2026-11-26, a rotated-seed find): with scripting off, `<noscript><script>` is an
 * HTML script, whose text only `</script>` ends, so in `<noscript><script></noscript><script type=application/json>${v}`
 * the scan's pop out of the noscript served the value as a JSON block's first byte while that reading had it in the
 * first script's text, after a raw `<` (jsdom, scripting off). Held, the hole is inside a tracked script and refused.
 */
export const holdsText = (open: Open): boolean => (open.space === '' || open.space === '?') && (TEXT_ONLY.has(open.name) || RAWTEXT.has(open.name));

/**
 * Pops `opens` to the element a breakout lands in and answers the foreign depth there, or `-1` — leaving `opens` alone
 * — when that is not certain (see the breakout in `scanTag`). It runs only at a breakout, so it sits outside the scan.
 */
const breakOut = (opens: Open[]): number => {
  let at = opens.length - 1;
  /** A stray end tag's unknown entry above the foreign content is popped with it (see the breakout in `structural`). */
  if (at >= 0 && opens[at].space === '?' && opens[at].name === '') at--;
  while (at >= 0 && (opens[at].space === 'svg' || opens[at].space === 'math')) at--;
  if (!(at >= 0 ? opens[at].space === 'html' : opens.length > 0 && opens[0].foreign === 0)) return -1;
  const depth = opens[at + 1].foreign;
  /** Popped, as an end tag's close is (see `scanTag`): `at` starts below `opens.length`, so `at + 1` is at most the length and the loop removes exactly the entries a length store would. */
  while (opens.length > at + 1) opens.pop();
  return depth;
};

/**
 * **Whether a `<![CDATA[` here is a CDATA section**, which runs to `]]>`, rather than the bogus comment it is in HTML,
 * which ends at the first `>`. The parser opens a section when its current node is not an HTML element, so: inside SVG
 * or MathML, read off the innermost tracked element; not inside `<noscript>` or `<select>`, which raise the depth too
 * (read there as CDATA, `<select><![CDATA[><textarea>` hid a live `<textarea>` from the scan; measured, Chromium,
 * Firefox and WebKit), nor in HTML or a table. A template rendered into a hole knows the namespace there (its root
 * entry; see `positionOf`). Two places stay open to both readings: a bare depth, where the namespace is unknown, and
 * straight inside an integration point (an entry of space `'html'` above depth 0; a table's is at 0), which is itself
 * an SVG or MathML element (`<svg><title><![CDATA[ x>` left a section open in all three engines) until an HTML element
 * opens in it, and the scan does not track those. There, when the first `>` after `from` is the one ending the first
 * `]]>`, both readings end at the same place and it is read as CDATA; otherwise it is refused (`ssr-cdata-unknown`),
 * in every build, rather than guessed.
 */
const cdataHere = (opens: Open[], text: string, from: number): boolean => {
  const top = opens.length === 0 ? undefined : opens[opens.length - 1];
  const space = top === undefined ? '?' : top.space;
  if (space === 'svg' || space === 'math') return true;
  if (space === '' || (space === 'html' && top!.foreign === 0)) return false;
  const end = text.indexOf(']]>', from);
  if (end !== -1 && text.indexOf('>', from) === end + 2) return true;
  throw own(new Error(ssrMisuse('ssr-cdata-unknown', PROSE['ssr-cdata-unknown']!())));
};

/**
 * Where the end tag that closes raw or escaped text named `name` begins in `text`, searching from `from`: the first
 * `</name` followed by whitespace, `/`, `>` or the end of the text — so `</scripts` ends nothing, and `</name` at the
 * very end counts as an end (a hole right after it is refused as a tag-name hole) — or `-1` when none does. One rule
 * in one place: `scanTag` reads it for `<style>`, `<script>` and the text-only elements (`<title>`, `<textarea>`, …),
 * and `compile` for the static after a JSON block's or a style's hole. That end used to be carried in every scan's
 * answer (`rawUntil`), which cost the `.innerHTML` scan about 0.5% per render, counted (2026-11-19; the store and the
 * answer's extra field together), and was read only there. A search from a fresh start is exact because the rule is
 * STATELESS for every element but `<script>`: `indexOf('</')`, a lowercase name compare and `endsName`. A script's
 * text has escape states (`scriptCloserAt`). The one search that starts after a script hole, at a JSON block's end
 * (`closeRawSlot`), starts fresh on purpose: a block's statics are served with every `<` as `\u003c`, so the served
 * page never enters an escape state, and the block ends where that search ends it.
 */
const closerAt = (text: string, from: number, name: string): number => {
  if (name === 'script') return scriptCloserAt(text, from);
  const length = text.length;
  for (let at = text.indexOf('</', from); at !== -1; at = text.indexOf('</', at + 2)) {
    const after = at + 2 + name.length;
    if (asciiLower(text.slice(at + 2, after)) === name && (after >= length || endsName(text[after]))) return at;
  }
  return -1;
};

/** Whether `script`, any case, starts at `at` and ends a name there (or the text ends). */
const scriptNameAt = (text: string, at: number): boolean =>
  asciiLower(text.slice(at, at + 6)) === 'script' && (at + 6 >= text.length || endsName(text[at + 6]));

/**
 * **Where a `<script>`'s text ends, by the parser's script-data states** (2026-11-23). `<!--` enters the ESCAPED state,
 * where a `<script` enters the DOUBLE-ESCAPED one, in which `</script>` does not end the element (it returns to
 * escaped); `-->` returns to plain script data from either. `<script><!--\n'<script src=a.js></script>'\nvar n = …`
 * runs on past that first `</script>` in Chromium, Firefox and WebKit, and a search for the first one put the rest of
 * the script, a hole included, outside it: the value was served as escaped TEXT inside code that runs. At the end of
 * the text a `</script` still counts as an end in the plain and escaped states, as `closerAt` counts one. Each static
 * starts in plain script data: a hole is a token boundary, and one inside a script's text is refused unless the script
 * is a JSON data block, whose statics are served with every `<` as `\u003c`, so the page itself never enters an escape
 * state there.
 */
const scriptCloserAt = (text: string, from: number): number => {
  /** 0: script data; 1: escaped; 2: double-escaped. */
  let state = 0;
  for (let at = from; at < text.length; at++) {
    const c = text.charCodeAt(at);
    /** `-->` ends an escape, of either depth. */
    if (c === 45) {
      if (state !== 0 && text.startsWith('-->', at)) {
        state = 0;
        at += 2;
      }
      continue;
    }
    if (c !== 60) continue;
    if (text.charCodeAt(at + 1) === 47) {
      if (!scriptNameAt(text, at + 2)) continue;
      if (state !== 2) return at;
      state = 1;
      at += 7;
    } else if (state === 0 && text.startsWith('!--', at + 1)) {
      /** On to the `!`: the `--` it opens with can be the `-->` that closes it (`<!-->`). */
      state = 1;
      at += 1;
    } else if (state === 1 && scriptNameAt(text, at + 1)) {
      state = 2;
      at += 6;
    }
  }
  return -1;
};

/**
 * What `structural` answers besides a foreign depth: the tag opened an HTML `<template>`, whose content is inert one
 * level deeper, or it is a `<script>` or `<textarea>` straight inside a `<select>` opened in HTML, read as at depth 0.
 */
const INTO_TEMPLATE = -1;
const INTO_SCRIPT = -2;
const INTO_TEXTAREA = -3;
/**
 * **A tag that changes how what follows it parses**, read where `scanTag` cannot skip it: the namespace it is read in,
 * a breakout, and for a start tag the element it opens. Out of the per-character loop (2026-11-21): this is the code a
 * typical template's tags never reach, and in the loop its bytecode was carried by every character scanned. Answers
 * the foreign depth after the tag (an end tag's, after any breakout: what it closes stays in `scanTag`), or one of the
 * `INTO_` answers above, which `scanTag` turns into its own state. The raw-text and text-only elements at depth 0 are
 * settled in `scanTag` before this is called: there the namespace is HTML, no breakout applies, and no branch here can
 * take those names (none is in `BREAKOUT`, and a `<select>` raises the depth), so nothing else could have claimed them.
 */
const structural = (opens: Open[], tagName: string, closing: boolean, selfClosing: boolean, encoding: string, font: number, foreign: number, inert: number): number => {
  /** The innermost element this scan opened that changes parsing, and the namespace this tag is read in. */
  let top = opens.length === 0 ? undefined : opens[opens.length - 1];
  let space = foreign === 0 ? 'html' : top !== undefined && top.space !== 'html' ? top.space : '?';
  /**
   * **After a stray end tag in SVG or MathML, a breakout still reaches HTML** (2026-11-26, rotated seeds): the namespace
   * there is unknown (see the end-tag rule below) because the tag was either ignored, and the parse is still in the
   * foreign content, which the breakout leaves for the element `breakOut` finds, or it closed an HTML element above, and
   * the parse is already in HTML. Every HTML element this scan tracks (`table`, `object`, `noscript`, `select`,
   * `template`, an integration point…) is one the parser's end-tag walk stops at, so the tag can have closed something
   * only past the template's own HTML root: both readings end in HTML at depth 0 there, and at the tracked element
   * otherwise. Left unknown, `<math><font id=size></foreignObject><p><x-kid>` missed a component every engine upgrades.
   * Only the unknown entry an end tag in foreign content leaves (the one above an SVG or MathML entry); at an
   * integration point's, the parser may be back in the foreign content above the point or still in it.
   */
  const strayEnd = space === '?' && top!.name === '' && opens.length > 1 && (opens[opens.length - 2].space === 'svg' || opens[opens.length - 2].space === 'math');
  /**
   * **A breakout** — see `BREAKOUT`. The ONE rule here that moves the scan from foreign content toward HTML, the
   * dangerous direction, so it acts only where its target is certain: inside SVG or MathML content, or at the unknown
   * namespace a stray end tag left there (`strayEnd`; never at an integration point, where these tags are HTML already), popping to the nearest element whose content is HTML. It
   * stops — and changes nothing — at `<noscript>` or anywhere else the namespace is unknown, and at the template's own
   * root unless that root is HTML: a template that inherited its depth cannot know what is outside it.
   */
  if ((space === 'svg' || space === 'math' || strayEnd) && (closing ? tagName === 'p' || tagName === 'br' : BREAKOUT.has(tagName) || font === 1)) {
    const depth = breakOut(opens);
    if (depth !== -1) {
      foreign = depth;
      top = opens.length === 0 ? undefined : opens[opens.length - 1];
      space = 'html';
    }
  }
  if (closing && space === 'html' && top !== undefined && top.space === 'html' && top.foreign !== 0 && !BREAKOUT.has(tagName) && closeTo(opens, tagName) === -1) {
    /**
     * **An end tag that may close a foreign element above an integration point** (2026-11-22). With the point current,
     * the parser reads an end tag by the foreign-content rules, which walk up through the SVG/MathML elements and pop
     * at one of its name: `<svg><g><foreignObject></g><style>${v}` is back in SVG, where the `<style>` is markup, while
     * the scan, which tracks no `g`, stayed in HTML and wrote the value raw, and its `<img onerror>` ran (Chromium,
     * Firefox and WebKit; so did `<svg><a><title></a>`, `<math><mrow><mtext></mrow>` and a child at a point that starts
     * `</foreignObject>`). Only a breakout name (`BREAKOUT`; `p` and `br` among them) can never be such an element: opened
     * inside SVG or MathML it leaves for HTML, while any other name, `section`, `video` and a `<font>` with no attributes
     * included, is a foreign element there (measured, Chromium, Firefox and WebKit).
     * **But the scan cannot know which way the parser went**: where no foreign element of that name is open, the parser
     * stays at the point and ignores the tag. So the namespace becomes UNKNOWN, at the point's depth, never the foreign
     * one below it. Popped to MathML instead, `<math><mi></font><title><a></section><math><table><style>${v}` was read
     * as a MathML `<title>` (markup), and the `<table>` broke the scan out to HTML while the browser was still in the
     * title's TEXT, so the value went out raw and its `</title><img onerror>` ran (Chromium, Firefox and WebKit). At
     * an unknown namespace a text-only element is tracked and its content over-escaped, no breakout acts, a CDATA must
     * read the same both ways, and a later end tag of an element opened below (`</math>`) returns to known ground.
     */
    opens.push({ name: '', foreign: top.foreign, inert, space: '?' });
    return top.foreign;
  }
  /** `mglyph`/`malignmark` straight inside a MathML text integration point: read as MathML, not HTML. */
  const reentry = space === 'html' && top !== undefined && MATH_TEXT_POINTS.has(top.name) && (tagName === 'mglyph' || tagName === 'malignmark');
  /**
   * A `/` before the `>` closes only a FOREIGN element: on an HTML one the parser ignores it, so `<template/>`,
   * `<noscript/>` and `<style/>` open exactly as `<template>`, `<noscript>` and `<style>` do. Counting them as closed
   * had the server writing raw text into what the browser parses as `<noscript>` content. `<svg/>` and `<math/>` are
   * foreign elements even in HTML, so their `/>` closes them; inside foreign content every `/>` does.
   */
  const selfClosed = selfClosing && (space !== 'html' || reentry || tagName === 'svg' || tagName === 'math');
  if (!closing && !selfClosed && (tagName === 'script' || tagName === 'textarea') && top !== undefined && top.name === 'select' && top.foreign === 0) {
    /**
     * Straight inside a `<select>` opened in HTML, the two parsers agree on these two (2026-11-21; parse5 and
     * Chromium 159, Firefox 159, WebKit 27.2): a `<script>` is raw text (the older select parser reads it by the
     * head's rules), and a `<textarea>` is text (the older parser closes the select first). So they are read as at
     * depth 0. Read as markup, the `<b` of `<script>if (a<b)` opened a tag in the source: a later hole in the
     * select's text was refused, and a hole the scan placed inside that tag was served into the code.
     */
    return tagName === 'script' ? INTO_SCRIPT : INTO_TEXTAREA;
  }
  if (!closing && (space === '' || space === '?') && (TEXT_ONLY.has(tagName) || tagName === 'style')) {
    /**
     * **A text-only or raw-text element in `<noscript>`/`<select>` markup, or where the namespace is unknown** (`''`
     * or `'?'`) is tracked for its closer, at the same depth and in the same namespace, `/>` or not. A parser with scripting off
     * reads `<noscript><textarea>` as HTML, where the textarea is text, so the server's `</noscript>` became its text
     * and the page after it with it (measured, jsdom with scripting off: `<textarea>`, `<title>`, `<style>`; the `/`
     * of `<textarea/>` is ignored in HTML). Its content is still scanned as markup, which over-escapes, never injects.
     * Where the element was foreign, or never opened, its end tag closes it or is ignored.
     */
    opens.push({ name: tagName, foreign, inert, space });
    return foreign;
  }
  if (closing && (space === 'svg' || space === 'math') && tagName !== 'svg' && tagName !== 'math' && !NEVER_AROUND_MARKUP.has(tagName) && closeTo(opens, tagName) === -1) {
    /**
     * **An end tag in SVG or MathML that closes no element this scan opened** (2026-11-26, the browser fuzz on a
     * rotated seed). The parser walks up the open elements, and at the first HTML one it hands the tag to the HTML
     * rules, which close an HTML element of that name anywhere above, outside the template too: a page's
     * `<div id="host">` around `<math></div><script><b><style>${v}` is closed by the `</div>`, the `<math>` with it,
     * and the `<script>` is HTML raw text, where a value's `</script>` ends it and its `<img onerror>` ran (Chromium and
     * Firefox). With no such element above, the tag is ignored and the parse stays in MathML. The scan cannot see the
     * page, so the namespace becomes UNKNOWN at this depth, as at an integration point (above): a later `<script>` or
     * `<style>` is tracked and over-escaped in both readings. Every foreign element is tracked (below), so an end tag
     * of one the template opened (`<svg><g></g>`) closes it and keeps the namespace known. `</svg>` and `</math>` are
     * the two names no HTML element has (their start tags always make SVG and MathML elements), so the HTML rules close
     * nothing for them and they stay ignored, as `closeTo` says.
     */
    opens.push({ name: '', foreign, inert, space: '?' });
    return foreign;
  }
  if (closing || selfClosed) return foreign;
  /**
   * **Foreign content: raw text exists only for HTML elements.** Inside `<svg>`/`<math>`, `<style>`, `<title>`,
   * `<textarea>` and the rest are SVG/MathML elements whose content is MARKUP — read as raw text there, a hole
   * would be served unquoted, unescaped and unrefused (an attribute hole became a live handler). So raw text is
   * recognized only at depth 0, which an HTML integration point restores for its content (see `SVG_POINTS`).
   * A breakout tag (`<svg><p>`) leaves it (see `BREAKOUT`). Deliberately incomplete on the SAFE side: an end tag
   * the parser ignores keeps the depth (one it may hand to an element outside the template makes it unknown, above),
   * and so does a `<font>` whose `color`, `face` or `size` holds a hole (see
   * `FONT_BREAKOUT`) — both only ever read raw text as markup, which over-escapes, never injects. `<noscript>` counts as foreign: markup to a parser with scripting off and raw text
   * to one with it on, so it is scanned as the first and escaped as neither can misread (see `TEXT_ONLY`), and
   * nothing inside it is an integration point. The depth a hole sits at is recorded for the template rendered
   * there, which starts from it (see `serializeTemplate`).
   */
  if (tagName === 'svg' || tagName === 'math') {
    /**
     * An `<svg>`/`<math>` start tag the parser handles by HTML rules — in HTML, or an `<svg>` straight inside
     * `annotation-xml` — opens its own namespace; inside foreign content it is an element of the SURROUNDING one
     * (`<math><svg>` is a MathML element named `svg`, so a `foreignObject` in it is MathML too).
     */
    const own = space === 'html' || (tagName === 'svg' && top !== undefined && top.name === 'annotation-xml');
    opens.push({ name: tagName, foreign, inert, space: own ? tagName : space });
    return foreign + 1;
  }
  if ((tagName === 'noscript' || tagName === 'select') && space !== 'svg' && space !== 'math') {
    /**
     * Only where HTML rules read the tag (2026-11-19, a rotated-seed find): inside `<svg>`/`<math>` proper a
     * `<noscript>` is a foreign element like any (raw text exists only for HTML elements), so it is not tracked and a
     * breakout after it (`<svg><noscript><p>`) pops it with the foreign content, as the parser does. At an
     * integration point `space` is HTML, so it is tracked there — an HTML `<noscript>`, as `<template>` below.
     *
     * **`<select>` counts the same way** (2026-11-21): its content parses two ways. The select parser before
     * customizable select (jsdom's, and older browsers') ignores a `<style>`, `<svg>`, `<math>` or `<noscript>` start
     * tag inside it, so what follows is markup; current engines read that `<style>` as raw text. Read as raw text
     * here, a value's `</select><img onerror>` was written raw and ran on the older parser. Scanned as markup,
     * with no integration point inside and raw text only where both parsers read it (`<script>`, below), every
     * other value is escaped: safe under both.
     */
    opens.push({ name: tagName, foreign, inert, space: '' });
    return foreign + 1;
  }
  if (space === 'html' && CLOSE_ONLY.has(tagName)) {
    /** Tracked for its closer only, at the same depth: its content is HTML as before (see `CLOSE_ONLY`). */
    opens.push({ name: tagName, foreign, inert, space: 'html' });
    return foreign;
  }
  if (tagName === 'template' && space !== 'svg' && space !== 'math') {
    /** Inert content only for an HTML `<template>`: inside `<svg>`/`<math>` it is a foreign element, its content live markup. */
    opens.push({ name: tagName, foreign, inert, space });
    return INTO_TEMPLATE;
  }
  if (
    (space === 'svg' && SVG_POINTS.has(tagName)) ||
    (space === 'math' && (MATH_TEXT_POINTS.has(tagName) || (tagName === 'annotation-xml' && HTML_ENCODINGS.has(asciiLower(encoding)))))
  ) {
    opens.push({ name: tagName, foreign, inert, space: 'html' });
    return 0;
  }
  if (space === 'math' && tagName === 'annotation-xml') {
    /** Not an integration point, but an `<svg>` straight inside it is SVG — so it is tracked. */
    opens.push({ name: tagName, foreign, inert, space });
    return foreign;
  }
  if (reentry) {
    opens.push({ name: tagName, foreign, inert, space: 'math' });
    return 1;
  }
  if (space !== 'html' && tagName === 'script') {
    /**
     * A `<script>` in SVG (or a MathML element of that name) is tracked so a hole inside it is refused (see
     * `compile`): its content is markup to the parser, so it is no raw text here, and an SVG script runs on a served
     * page — and from a template, in Chromium and WebKit (BROWSER-LEDGER, 2026-11-18). An HTML `<script>` is raw text
     * (`rawTag`, in `scanTag`) and never reaches `opens`, so every `script` here is a foreign one.
     *
     * So is one whose namespace is unknown (`space` is `''`: a template that inherited its depth, or inside
     * `<noscript>`/`<select>`), 2026-11-21: `html\`<svg>${html\`<script>${v}</script>\`}</svg>\`` read the child's
     * script as neither, wrote the hole as escaped text, which does nothing to code, and it ran in all three engines.
     *
     * **And every other element opened in SVG or MathML** (2026-11-26), so its end tag is told apart from one that
     * closes nothing the template opened, which may close an element outside it (see the end-tag rule above). A
     * breakout pops these with the rest of the foreign content (`breakOut`), and `closersOf` closes one a template
     * leaves open, as the client's parse of that template does.
     */
    opens.push({ name: tagName, foreign, inert, space });
  } else if (space === 'svg' || space === 'math') opens.push({ name: tagName, foreign, inert, space });
  return foreign;
};

/**
 * **A start tag's attribute name that changes how the scan goes on**, read out of the per-character loop (whose bytecode
 * every character carries): a `<template>`'s `shadowroot`/`shadowrootmode`, recorded in `edits` for `fortify`, and a
 * `<font>`'s `color`, `face` or `size`, answered `true` (see `FONT_BREAKOUT`). `scanTag` asks about a font only in
 * foreign content, the one place its breakout acts (see `structural`); `foreign` holds still while a tag is read, so a
 * font set from this reaches `structural`, which is where `scanTag` clears it.
 */
const attributeNamed = (name: string, tagName: string, at: number, edits: number[] | undefined): boolean => {
  const lower = asciiLower(name);
  if (tagName === 'font') return FONT_BREAKOUT.has(lower);
  if (edits !== undefined && (lower === 'shadowrootmode' || lower === 'shadowroot')) edits.push(at, EDIT_SHADOW_ROOT);
  return false;
};

/**
 * `edits`, when given, collects the positions `fortify` rewrites — a start tag's name end where it is `script`, and
 * a `<template>` start tag's `shadowroot`/`shadowrootmode` attribute names. They are reported from THIS scan, so the
 * `.innerHTML` scan and the template scan cannot disagree about what is a tag: they are one scan. `tags`, when given,
 * collects the component scan's candidates the same way (see `ScannedTag` and `scan.ts`).
 */
export const scanTag = (text: string, state: ScanState, edits?: number[], tags?: ScannedTag[]): ScanResult => {
  let { phase, inValue, quote, rawTag, tagName, attrName, serial, closing, inert, comment, textTag, foreign, attrRaw, encoding, font } = state;
  /** The parser-state elements THIS template has open, innermost last — what its end must close (see `compile`). Mutated. */
  const { opens } = state;
  /** Where, in THIS text, the last attribute to open here starts (its leading space) and its value starts — see `compile`. */
  let opened = false;
  let attrStart = 0;
  let valueStart = 0;
  let nameAt = 0;
  /** Where the attribute name being read began in THIS text — `-1` when it began in an earlier one. */
  let nameFrom = -1;
  /** Where the name of the `<font>`'s `color`, `face` or `size` read in THIS text starts (see `font`). */
  let fontFrom = -2;
  let tagAt = -1;
  /**
   * Where, in THIS text, raw content last BEGAN (after its element's start tag) — `-1` for none: where a raw element's
   * content starts inside the static before a hole (`compile`). Where it ends in the static after is `closerAt`'s.
   */
  let rawFrom = -1;
  let selfClosing = false;
  /** Where the value that opened in THIS text starts — `-1` when none did — so an `encoding` can be read whole. */
  let valueFrom = -1;
  const length = text.length;
  for (let i = 0; i < length; i++) {
    /**
     * Inside `<style>`/`<script>` (`rawTag`) or a text-only element (`textTag`) nothing is markup until that
     * element's own end tag — `</name` followed by whitespace, `/` or `>`, so `</scripts` ends nothing — and a hole
     * here is raw text or escaped text, which the render pass has to know about. The end tag is then read as any end
     * tag is, attributes and all. At the very end of a text, `</name` counts as an end: a hole right after it is
     * refused as a tag-name hole (see `compile`), never written into the raw text, where a value of `>` would end it.
     */
    if (rawTag !== '' || textTag !== '') {
      const name = rawTag || textTag;
      /** Nothing ends a `<plaintext>`: the parser reads to the end of the input (see `TEXT_ONLY`). */
      const at = name === 'plaintext' ? -1 : closerAt(text, i, name);
      if (at === -1) break;
      rawTag = '';
      textTag = '';
      phase = TAG_NAME;
      tagName = name;
      closing = true;
      tagAt = at;
      i = at + 1 + name.length;
      continue;
    }
    /**
     * Inside a comment nothing is markup until its closer — the client's scanner reads it the same way, and a binding
     * here is dropped on both sides (see `compile`). A comment ends at `-->` or `--!>`; a BOGUS comment — `<!` not
     * followed by `--`, `<?`, or `</` not followed by a letter — at the first `>`, quotes or not; and a CDATA section,
     * which exists only in foreign content, at the first `]]>` (left open, it is closed with one, see `closersOf`).
     * The comment rule is `commentEnd`'s (`escaping.ts`), streamed here across statics; `tests/comment-end-twins.test.mjs`
     * holds the two equal.
     */
    if (comment !== '') {
      if (comment !== '-->') {
        const at = text.indexOf(comment, i);
        if (at === -1) break;
        i = at + comment.length - 1;
        comment = '';
        continue;
      }
      const at = text.indexOf('--', i);
      if (at === -1) break;
      if (text.startsWith('-->', at)) {
        i = at + 2;
        comment = '';
      } else if (text.startsWith('--!>', at)) {
        i = at + 3;
        comment = '';
      } else i = at;
      continue;
    }
    const character = text[i];
    /** Whether this character's state hands over to an attribute value, and whether it ends the tag. */
    let value = false;
    let emit = false;
    if (inValue) {
      if (quote !== '') {
        const at = text.indexOf(quote, i);
        if (at === -1) break;
        if (attrName === 'encoding' && valueFrom !== -1 && encoding === '') encoding = text.slice(valueFrom, at);
        i = at;
        inValue = false;
        quote = '';
        phase = AFTER_ATTRIBUTE_VALUE;
        continue;
      }
      /** An unquoted value ends at whitespace or the tag's own `>`; a quote or `=` inside it is value text. */
      if ((character === '>' || isSpace(character)) && attrName === 'encoding' && valueFrom !== -1 && encoding === '') encoding = text.slice(valueFrom, i);
      if (character === '>') {
        inValue = false;
        emit = true;
      } else if (isSpace(character)) {
        inValue = false;
        phase = BEFORE_ATTRIBUTE_NAME;
        continue;
      } else if (character === '/' && i === 0 && text[1] === '>') {
        /**
         * A `/>` RIGHT after a hole that ended an unquoted value is the tag's self-close, not value text — `compile`
         * keeps the slash out of the value, as the client's scanner does (`<circle r=${r}/>`), so the markup served is
         * a self-closing tag and is scanned as one.
         */
        inValue = false;
        phase = SELF_CLOSING;
        continue;
      } else continue;
    } else if (phase === OUTSIDE) {
      const at = text.indexOf('<', i);
      if (at === -1) break;
      i = at;
      tagAt = at;
      phase = TAG_OPEN;
      continue;
    } else if (phase === TAG_OPEN) {
      if (character === '!') {
        if (text.startsWith('--', i + 1)) {
          i += 2;
          /** `<!-->` and `<!--->` end the comment they open — the tokenizer's abrupt close. */
          if (text[i + 1] === '>') i += 1;
          else if (text.startsWith('->', i + 1)) i += 2;
          else comment = '-->';
        } else if ((foreign !== 0 || opens.length !== 0) && text.startsWith('[CDATA[', i + 1) && cdataHere(opens, text, i + 8)) {
          i += 7;
          comment = ']]>';
        } else comment = '>';
        phase = OUTSIDE;
        continue;
      }
      if (character === '/') {
        phase = END_TAG_OPEN;
        continue;
      }
      if (isAlpha(character)) {
        phase = TAG_NAME;
        tagName = lowerAscii(character);
        closing = false;
        continue;
      }
      /** `<?` opens a bogus comment; a `<` before anything else is TEXT — `a < b`, `<1`. */
      if (character === '?') comment = '>';
      else i--;
      phase = OUTSIDE;
      continue;
    } else if (phase === END_TAG_OPEN) {
      if (isAlpha(character)) {
        phase = TAG_NAME;
        tagName = lowerAscii(character);
        closing = true;
        continue;
      }
      /** `</>` is nothing at all; `</` before anything else opens a bogus comment that holds that character. */
      if (character !== '>') {
        comment = '>';
        i--;
      }
      phase = OUTSIDE;
      continue;
    } else if (phase === TAG_NAME) {
      /** A tag name runs to whitespace, `/` or `>` — every other character is part of it, `.` `:` `=` and quotes too. */
      if (isSpace(character)) phase = BEFORE_ATTRIBUTE_NAME;
      else if (character === '/') phase = SELF_CLOSING;
      else if (character === '>') emit = true;
      else {
        tagName += lowerAscii(character);
        continue;
      }
      /** The name is whole: a `<script>` start tag gets the inert type right after it, first among its attributes. */
      if (edits !== undefined && !closing && tagName === 'script') edits.push(i, EDIT_INERT);
      if (!emit) continue;
    } else if (phase === BEFORE_ATTRIBUTE_NAME || phase === AFTER_ATTRIBUTE_NAME || phase === AFTER_ATTRIBUTE_VALUE) {
      if (isSpace(character)) {
        phase = BEFORE_ATTRIBUTE_NAME;
        continue;
      }
      if (character === '/') {
        phase = SELF_CLOSING;
        continue;
      }
      if (character === '>') emit = true;
      /** `=` after a name opens its value; anywhere else — `<b =x>` — it is the first character of a NAME. */
      else if (character === '=' && phase === AFTER_ATTRIBUTE_NAME) value = true;
      else {
        phase = ATTRIBUTE_NAME;
        nameFrom = i;
        continue;
      }
    } else if (phase === ATTRIBUTE_NAME) {
      /** A name runs to whitespace, `/`, `>` or `=` — a quote or `<` inside it is part of the name (`<b x">`). */
      if (!(isSpace(character) || character === '/' || character === '>' || character === '=')) continue;
      attrRaw = nameFrom === -1 ? attrRaw + text.slice(0, i) : text.slice(nameFrom, i);
      /**
       * The two start tags whose attribute NAMES matter here — see `attributeNamed`; every other tag skips the call, and
       * so does a `<font>` outside foreign content, the only place its breakout acts (legacy `<font color>` markup in
       * HTML pays one compare per attribute, not a call and a lowercase copy).
       */
      if (nameFrom !== -1 && !closing && (tagName === 'template' || (tagName === 'font' && foreign !== 0)) && attributeNamed(attrRaw, tagName, nameFrom, edits) && font === 0) {
        font = 1;
        fontFrom = nameFrom;
      }
      if (character === '=') value = true;
      else if (character === '>') {
        emit = true;
      } else {
        phase = character === '/' ? SELF_CLOSING : AFTER_ATTRIBUTE_NAME;
        continue;
      }
    } else {
      /** `SELF_CLOSING`: only a `>` makes the tag self-closing; anything else starts an attribute name. */
      if (character === '>') {
        emit = true;
        selfClosing = true;
      } else {
        phase = BEFORE_ATTRIBUTE_NAME;
        i--;
        continue;
      }
    }
    if (value) {
      /** Which attribute this value belongs to, and a serial per value — the URL-sink check needs both. */
      attrName = asciiLower(attrRaw);
      serial++;
      let next = i + 1;
      while (next < length && isSpace(text[next])) next++;
      quote = text[next] === '"' || text[next] === "'" ? text[next] : '';
      inValue = true;
      /** The value states are `inValue`/`quote`; every way out of them names the phase that follows. */
      phase = BEFORE_ATTRIBUTE_NAME;
      opened = true;
      nameAt = nameFrom === -1 ? 0 : nameFrom;
      attrStart = nameAt;
      while (attrStart > 0 && isSpace(text[attrStart - 1])) attrStart--;
      valueStart = quote ? next + 1 : next;
      valueFrom = valueStart;
      i = quote ? next : next - 1;
      continue;
    }
    /** `emit`: the tag is whole. */
    phase = OUTSIDE;
    /** A tag the component scan wants — see `ScannedTag`. A dashed name never changes parse state, so where it is read is where it sits. */
    if (tags !== undefined && inert === 0 && tagName.includes('-')) tags.push({ at: tagAt, end: i + 1, name: tagName, closing, live: !closing && foreign === 0 });
    /**
     * **Most tags change nothing about how what follows parses.** In HTML with nothing open, only the elements in
     * `STRUCTURAL` do, so every other tag — the `<p>`, `<a>` and `<li>` that are nearly all of real markup — skips the
     * stack, namespace and breakout work below. So does one whose innermost tracked element is an HTML one opened at
     * depth 0 — a `CLOSE_ONLY` table or object, which only owes a closer, or a `<template>`: `structural` reads nothing
     * but the innermost entry, and for those it does nothing to such a tag, so a table's rows and cells cost what they
     * cost outside it. Read off the entry's own fields, not a `Set` lookup on its name: the lookup, once per tag inside
     * a table, cost a 50 KB table article 8% per render (measured, fresh processes against the base without tracking).
     */
    if (foreign === 0 && (opens.length === 0 || (opens[opens.length - 1].foreign === 0 && opens[opens.length - 1].space === 'html')) && !STRUCTURAL.has(tagName)) {
      tagName = '';
      closing = false;
      selfClosing = false;
      encoding = '';
      continue;
    }
    /**
     * The raw-text and text-only elements, read as such only in HTML (depth 0; see `structural` for why foreign content
     * has none, and why nothing else can take these names there): settled here, before the structural work.
     */
    if (foreign === 0 && !closing && RAWTEXT.has(tagName)) {
      rawTag = tagName;
      rawFrom = i + 1;
    } else if (foreign === 0 && !closing && TEXT_ONLY.has(tagName)) textTag = tagName;
    /**
     * A `<plaintext>` where the namespace is not SVG or MathML for certain: in `<noscript>` or `<select>` markup (the
     * entries scanned as markup at a raised depth, `space` ''), where a parser with scripting off, or one of today's
     * select parsers, reads it as HTML and from there it swallows the page; or where the namespace is unknown (`'?'`,
     * a bare depth; see `positionOf`), where the two readings never agree (an SVG element ends, an HTML one never
     * does). Read as its text here, so the template or value ends inside it and is refused.
     */
    else if (tagName === 'plaintext' && !closing && (opens.length === 0 || opens[opens.length - 1].space === '' || opens[opens.length - 1].space === '?')) textTag = tagName;
    else {
      const next = structural(opens, tagName, closing, selfClosing, encoding, font, foreign, inert);
      font = 0;
      if (next === INTO_TEMPLATE) inert++;
      else if (next === INTO_SCRIPT) {
        rawTag = tagName;
        rawFrom = i + 1;
      } else if (next === INTO_TEXTAREA) textTag = tagName;
      else foreign = next;
      if (closing) {
        /** An end tag closes the innermost element of its name this scan opened, and everything opened inside it. */
        /**
         * Inside `<template>` content an end tag closes nothing outside the template (see `closeTo`). Each entry holds
         * the foreign depth and the template depth from before it opened, and a close restores both — never a count
         * kept by hand, which a close that also closes a template inside it would leave wrong.
         */
        const at = closeTo(opens, tagName);
        if (at !== -1) {
          foreign = opens[at].foreign;
          /** How deep inside nested `<template>` content this is: what it was before the closed element opened. */
          inert = opens[at].inert;
          /**
           * Popped, not cut with a length store (2026-11-19): shrinking the array by `opens.length = at` cost the
           * `.innerHTML` scan 2.2% per render, counted (instructions, a 50 KB value holding an SVG and a MathML `<script>`
           * per chunk — each a tracked element its end tag closes), and the pops cost nothing there. Exact: `closeTo`
           * answers `-1` or an index below `opens.length`, and this runs only when it is not `-1`, so the loop removes
           * exactly the entries the store dropped and leaves the same array.
           */
          while (opens.length > at) opens.pop();
        }
      }
    }
    tagName = '';
    closing = false;
    selfClosing = false;
    encoding = '';
  }
  /** A name still being read at the end carries on into the next text (a hole there is refused — see `nameHole`). */
  if (phase === ATTRIBUTE_NAME) attrRaw = nameFrom === -1 ? attrRaw + text : text.slice(nameFrom);
  /**
   * A `color` this static ends inside — its value open, or an `=` still possible after its name — takes a hole: no
   * longer certain, so the no-breakout reading. Any other is whole, and carries on with the tag into the next text.
   */
  if (font === 1 && nameFrom === fontFrom && (inValue || phase === AFTER_ATTRIBUTE_NAME)) font = 0;
  return { inTag: phase !== OUTSIDE, phase, inValue, quote, rawTag, tagName, attrName, serial, closing, inert, comment, textTag, foreign, opens, attrRaw, encoding, font, opened, attrStart, valueStart, nameAt, tagAt, rawFrom };
};


/** The end-of-input closers a scan state owes: its open comment (or foreign CDATA section) or raw-text or text-only element, then every element it opened that changes parsing (svg, math, noscript, select, template, an integration point), innermost first. Shared by `compile` and `fortify`. */
export const closersOf = (end: ScanState): string =>
  (end.comment || (end.rawTag ? `</${end.rawTag}>` : end.textTag ? `</${end.textTag}>` : '')) +
  end.opens.reduceRight((closing, open) => (open.name === '' ? closing : closing + `</${open.name}>`), '');
/**
 * **The empty `opens` every fresh scan copies — already an array of OBJECTS to V8** (2026-11-20). An `[]` literal starts
 * as an array of small integers and changes kind at its first push of an entry, so each fresh scan's `opens` reached
 * `scanTag` in a different kind from the one its optimized code had learned: two "wrong map" deopts and a "not a Smi"
 * one over the first seven renders of a 50 KB `.innerHTML` value, each throwing the optimized scan away, and every
 * recompile after them came later. Copied from an empty array already holding objects (its one entry removed at
 * load), every `opens` has the same kind from birth: the deopts are gone and the first 100 renders of that value took
 * 64.7 ms against 82.3 (0.3.0: 78.8; 8 fresh processes, medians), the renders after them unchanged. A module-level
 * constant (Brian, 2026-11-20): built once at load and never written after — `freshScan` hands out copies, and
 * `scanTag` mutates only those.
 */
const NO_OPENS: Open[] = [{ name: '', foreign: 0, inert: 0, space: '' }];
NO_OPENS.pop();

/**
 * **A position: the foreign depth a template or value starts at, and the namespace it starts in**, as one small integer
 * (2026-11-22). A child template inherited only its parent's depth, so it could not tell `<svg>` from `<select>` around
 * it: a `<![CDATA[` there is a section to `]]>` in one and a bogus comment to `>` in the other, and a `<plaintext>` ends
 * in one and never in the other, so the child refused what either reading could not settle — an icon's
 * `<style><![CDATA[ .a > .b {} ]]>` included — and a text element tracked at an unknown namespace read as HTML. The
 * parent knows the namespace at the hole, so it hands it down: the low 24 bits are the depth, the bits above it the
 * namespace (an index into `SPACES`; 0 is unknown, so a bare depth reads as one). An integer, so the plan's `depths` and every
 * call that carries one stay small integers to V8; a depth past 2^24 would need a template of tens of megabytes.
 */
const SPACES = ['?', 'svg', 'math', '', 'html'];
/** The namespace's unit: a depth is below it, so `position % SPACE_UNIT` is the depth. */
const SPACE_UNIT = 2 ** 24;
export const positionOf = (depth: number, space: string): number => (depth === 0 ? 0 : depth + (space === 'svg' ? 1 : space === 'math' ? 2 : space === '' ? 3 : 0) * SPACE_UNIT);
/**
 * **Straight inside an integration point**: depth 0, but the current node is an SVG or MathML element, where a
 * `<![CDATA[` is a section (see `cdataHere`). Plain depth 0 is HTML with an HTML element current.
 */
export const POINT = 4 * SPACE_UNIT;
/** The foreign depth a position starts at. */
export const depthOf = (position: number): number => position % SPACE_UNIT;
/** The position of a hole at the end of a scan: its depth, in the namespace of the innermost element it holds open. */
export const positionAt = (foreign: number, opens: Open[]): number => {
  const top = opens.length === 0 ? undefined : opens[opens.length - 1];
  if (foreign === 0) return top !== undefined && top.space === 'html' && top.foreign !== 0 ? POINT : 0;
  return positionOf(foreign, top === undefined ? '?' : top.space);
};
/**
 * A scan state at `position` and nothing else open — its own `opens` (a copy of `NO_OPENS`), since `scanTag` mutates it.
 * Past depth 0 it holds one ROOT entry, named `''`, standing for the parent's element the position is inside: it
 * carries the namespace, so `structural` reads it as it reads any tracked element. No end tag names it (`closeTo`), a
 * breakout stops at it (`breakOut`: its `foreign` is never 0), and it owes no closer (`closersOf`).
 */
export const freshScan = (position: number): ScanStart => {
  const depth = position % SPACE_UNIT;
  const opens = NO_OPENS.slice();
  /** At `POINT` the root stands for the integration point: space `'html'` above depth 0, as the point's own entry is. */
  if (position !== 0) opens.push({ name: '', foreign: depth === 0 ? 1 : depth, inert: 0, space: SPACES[(position - depth) / SPACE_UNIT] ?? '?' });
  return { inTag: false, phase: OUTSIDE, inValue: false, quote: '', rawTag: '', tagName: '', attrName: '', serial: 0, closing: false, inert: 0, comment: '', textTag: '', foreign: depth, opens, attrRaw: '', encoding: '', font: 0 };
};

/**
 * What the template compiler reads of this module besides the scan itself — exported as SEPARATE bindings. The scan
 * reads its own constants on every character, and V8 reaches an exported module variable through a cell rather than
 * the module's context: exporting these directly cost compile 4% and a 50 KB \`.innerHTML\` value 11%.
 */
export const RAW_TEXT_TAGS = RAWTEXT;
export const TEXT_ONLY_TAGS = TEXT_ONLY;
export const PHASE_TAG_OPEN = TAG_OPEN;
export const PHASE_END_TAG_OPEN = END_TAG_OPEN;
export const PHASE_TAG_NAME = TAG_NAME;
export const isTokenizerSpace = isSpace;
export const INERT_EDIT = EDIT_INERT;
export const rawTextCloserAt = closerAt;
