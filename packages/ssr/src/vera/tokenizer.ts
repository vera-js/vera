/**
 * **The server's one tag scanner** — the HTML tokenizer's own states, from a `<` to its tag's `>`, plus the tree-builder
 * facts that change how the next character parses: raw text, comments, `<template>` content, foreign content and its
 * HTML integration points. Every reader of markup on the server reads it through this: the template compiler
 * (`serializer.ts` — where a hole is text, an attribute value or raw text), the `.innerHTML` inertness scan (`fortify`),
 * and the component scanner (`scan.ts` — where a registered component tag is live). They each ran their own copy
 * once, and every copy drifted from the tokenizer differently; one scanner cannot disagree with itself.
 */
import type { Open, ScanResult, ScanStart, ScanState, ScannedTag } from './types.js';

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
 * `xmp`, `noembed`, `noframes` and `plaintext` are obsolete and the client does not list them, but the browser
 * still parses them as raw text — without them, `<xmp><style>${x}</style></xmp>` wrote `x` raw inside what the
 * browser reads as one run of text, and `</xmp>` in the value closed it. `plaintext` never closes at all; ending it
 * at `</plaintext` here only ever resumes escaping too early, which writes `<style>` content raw into text the
 * browser shows verbatim — still text.
 *
 * `<noscript>` — the client's fourth — is not here, because it is not always raw: a browser with scripting OFF, the
 * one that shows it, parses its content as markup, so `<noscript><a href="${url}">` must be URL-checked like any
 * other link. It is a depth instead, beside foreign content (see `scanTag`): read as markup, with raw text never
 * recognized inside, so every value in it is escaped — which is safe under both parses.
 */
const TEXT_ONLY = new Set(['textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes', 'plaintext']);
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
 * text). Exactly the standard's list; `font` breaks out only with a `color`, `face` or `size` attribute, which this
 * scan does not track, so `font` never breaks out here — the safe side. `</p>` and `</br>` are the two end tags that do.
 */
/** The elements that change how what follows them parses, when read in HTML — see the fast path in `scanTag`. */
const STRUCTURAL = new Set(['svg', 'math', 'noscript', 'template', ...RAWTEXT, ...TEXT_ONLY]);
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
  while (at >= 0 && opens[at].name !== name && opens[at].name !== 'template') at--;
  return at >= 0 && opens[at].name === name ? at : -1;
};

/**
 * Pops `opens` to the element a breakout lands in and answers the foreign depth there, or `-1` — leaving `opens` alone
 * — when that is not certain (see the breakout in `scanTag`). It runs only at a breakout, so it sits outside the scan.
 */
const breakOut = (opens: Open[]): number => {
  let at = opens.length - 1;
  while (at >= 0 && (opens[at].space === 'svg' || opens[at].space === 'math')) at--;
  if (!(at >= 0 ? opens[at].space === 'html' : opens.length > 0 && opens[0].foreign === 0)) return -1;
  const depth = opens[at + 1].foreign;
  opens.length = at + 1;
  return depth;
};

/**
 * `edits`, when given, collects the positions `fortify` rewrites — a start tag's name end where it is `script`, and
 * a `<template>` start tag's `shadowroot`/`shadowrootmode` attribute names. They are reported from THIS scan, so the
 * `.innerHTML` scan and the template scan cannot disagree about what is a tag: they are one scan. `tags`, when given,
 * collects the component scan's candidates the same way (see `ScannedTag` and `scan.ts`).
 */
export const scanTag = (text: string, state: ScanState, edits?: number[], tags?: ScannedTag[]): ScanResult => {
  let { phase, inValue, quote, rawTag, tagName, attrName, serial, closing, inert, comment, textTag, foreign, attrRaw, encoding } = state;
  /** The parser-state elements THIS template has open, innermost last — what its end must close (see `compile`). Mutated. */
  const { opens } = state;
  /** Where, in THIS text, the last attribute to open here starts (its leading space) and its value starts — see `compile`. */
  let opened = false;
  let attrStart = 0;
  let valueStart = 0;
  let nameAt = 0;
  /** Where the attribute name being read began in THIS text — `-1` when it began in an earlier one. */
  let nameFrom = -1;
  let tagAt = -1;
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
      const at = text.indexOf('</', i);
      if (at === -1) break;
      const after = at + 2 + name.length;
      if (text.slice(at + 2, after).toLowerCase() !== name || (after < length && !endsName(text[after]))) {
        i = at + 1;
        continue;
      }
      rawTag = '';
      textTag = '';
      phase = TAG_NAME;
      tagName = name;
      closing = true;
      tagAt = at;
      i = after - 1;
      continue;
    }
    /**
     * Inside a comment nothing is markup until its closer — the client's scanner reads it the same way, and a binding
     * here is dropped on both sides (see `compile`). A comment ends at `-->` or `--!>`; a BOGUS comment — `<!` not
     * followed by `--`, `<?`, or `</` not followed by a letter — at the first `>`, quotes or not.
     */
    if (comment !== '') {
      if (comment === '>') {
        const at = text.indexOf('>', i);
        if (at === -1) break;
        i = at;
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
      if (edits !== undefined && !closing && tagName === 'template' && nameFrom !== -1) {
        const lower = attrRaw.toLowerCase();
        if (lower === 'shadowrootmode' || lower === 'shadowroot') edits.push(nameFrom, EDIT_SHADOW_ROOT);
      }
      if (character === '=') value = true;
      else if (character === '>') emit = true;
      else {
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
      attrName = attrRaw.toLowerCase();
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
     * stack, namespace and breakout work below.
     */
    if (foreign === 0 && opens.length === 0 && !STRUCTURAL.has(tagName)) {
      tagName = '';
      closing = false;
      selfClosing = false;
      encoding = '';
      continue;
    }
    /** The innermost element this scan opened that changes parsing, and the namespace this tag is read in. */
    let top = opens.length === 0 ? undefined : opens[opens.length - 1];
    let space = foreign === 0 ? 'html' : top !== undefined && top.space !== 'html' ? top.space : '';
    /**
     * **A breakout** — see `BREAKOUT`. The ONE rule here that moves the scan from foreign content toward HTML, the
     * dangerous direction, so it acts only where its target is certain: inside SVG or MathML content (never at an
     * integration point, where these tags are HTML already), popping to the nearest element whose content is HTML. It
     * stops — and changes nothing — at `<noscript>` or anywhere the namespace is unknown, and at the template's own
     * root unless that root is HTML: a template that inherited its depth cannot know what is outside it.
     */
    if ((space === 'svg' || space === 'math') && (closing ? tagName === 'p' || tagName === 'br' : BREAKOUT.has(tagName))) {
      const depth = breakOut(opens);
      if (depth !== -1) {
        foreign = depth;
        top = opens.length === 0 ? undefined : opens[opens.length - 1];
        space = 'html';
      }
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
    if (closing) {
      /** An end tag closes the innermost element of its name this scan opened, and everything opened inside it. */
      /**
       * Inside `<template>` content an end tag closes nothing outside the template (see `closeTo`). Each entry holds the
       * foreign depth and the template depth from before it opened, and a close restores both — never a count kept
       * by hand, which a close that also closes a template inside it would leave wrong.
       */
      const at = closeTo(opens, tagName);
      if (at !== -1) {
        foreign = opens[at].foreign;
        /** How deep inside nested `<template>` content this is: what it was before the closed element opened. */
        inert = opens[at].inert;
        opens.length = at;
      }
    } else if (!selfClosed) {
      /**
       * **Foreign content: raw text exists only for HTML elements.** Inside `<svg>`/`<math>`, `<style>`, `<title>`,
       * `<textarea>` and the rest are SVG/MathML elements whose content is MARKUP — read as raw text there, a hole
       * would be served unquoted, unescaped and unrefused (an attribute hole became a live handler). So raw text is
       * recognized only at depth 0, which an HTML integration point restores for its content (see `SVG_POINTS`).
       * A breakout tag (`<svg><p>`) leaves it (see `BREAKOUT`). Deliberately incomplete on the SAFE side: an end tag
       * the parser ignores keeps the depth, and so does `<font color>` — both only ever read raw text as markup, which
       * over-escapes, never injects. `<noscript>` counts as foreign: markup to a parser with scripting off and raw text
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
        foreign++;
      } else if (tagName === 'noscript') {
        opens.push({ name: tagName, foreign, inert, space: '' });
        foreign++;
      } else if (tagName === 'template' && space !== 'svg' && space !== 'math') {
        /** Inert content only for an HTML `<template>`: inside `<svg>`/`<math>` it is a foreign element, its content live markup. */
        opens.push({ name: tagName, foreign, inert, space });
        inert++;
      } else if (
        (space === 'svg' && SVG_POINTS.has(tagName)) ||
        (space === 'math' && (MATH_TEXT_POINTS.has(tagName) || (tagName === 'annotation-xml' && HTML_ENCODINGS.has(encoding.toLowerCase()))))
      ) {
        opens.push({ name: tagName, foreign, inert, space: 'html' });
        foreign = 0;
      } else if (space === 'math' && tagName === 'annotation-xml') {
        /** Not an integration point, but an `<svg>` straight inside it is SVG — so it is tracked. */
        opens.push({ name: tagName, foreign, inert, space });
      } else if (reentry) {
        opens.push({ name: tagName, foreign, inert, space: 'math' });
        foreign = 1;
      } else if (foreign === 0 && RAWTEXT.has(tagName)) rawTag = tagName;
      else if (foreign === 0 && TEXT_ONLY.has(tagName)) textTag = tagName;
    }
    tagName = '';
    closing = false;
    selfClosing = false;
    encoding = '';
  }
  /** A name still being read at the end carries on into the next text (a hole there is refused — see `nameHole`). */
  if (phase === ATTRIBUTE_NAME) attrRaw = nameFrom === -1 ? attrRaw + text : text.slice(nameFrom);
  return { inTag: phase !== OUTSIDE, phase, inValue, quote, rawTag, tagName, attrName, serial, closing, inert, comment, textTag, foreign, opens, attrRaw, encoding, opened, attrStart, valueStart, nameAt, tagAt };
};


/** The end-of-input closers a scan state owes: its open comment or raw-text or text-only element, then every element it opened that changes parsing (svg, math, noscript, template, an integration point), innermost first. Shared by `compile` and `fortify`. */
export const closersOf = (end: ScanState): string =>
  (end.comment || (end.rawTag ? `</${end.rawTag}>` : end.textTag ? `</${end.textTag}>` : '')) +
  end.opens.reduceRight((closing, open) => closing + `</${open.name}>`, '');
/** A scan state at foreign depth `depth` and nothing else open — its own `opens`, since `scanTag` mutates it. */
export const freshScan = (depth: number): ScanStart => ({ inTag: false, phase: OUTSIDE, inValue: false, quote: '', rawTag: '', tagName: '', attrName: '', serial: 0, closing: false, inert: 0, comment: '', textTag: '', foreign: depth, opens: [], attrRaw: '', encoding: '' });

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
