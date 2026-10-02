/**
 * Escaping at the render boundary, and the elements that must not be escaped at all.
 *
 * One place decides what becomes a character reference, because escaping in two places
 * double-escapes and escaping in none is an injection. `<style>`, `<script>`, `<textarea>` and
 * `<title>` hold **text**, not markup: a browser does not decode a character reference inside them,
 * so escaping there does not protect anything and does corrupt the content — a `static styles` with
 * `.a > .b` shipped a broken stylesheet until that was understood.
 */

const NEEDS_ESCAPE = /[&<>"'\r]/;

const ESCAPE = /[&<>"'\r]/g;

/**
 * Escaping is the hottest thing in a large render, and most values have nothing to escape.
 *
 * Asking first is worth it: 200 escapes of ordinary text measured 9.60 µs going straight to
 * `replace` against 3.03 µs testing first — and text that *does* need escaping came out slightly
 * ahead too (21.73 vs 20.03), because a global `replace` sets up more than a single `test` does. On
 * a 100-row table of clean data that is a quarter of the whole render.
 */

/**
 * **Carriage return is here for correctness, not for safety.**
 *
 * The HTML input-stream preprocessor rewrites CR and CRLF to a single LF *before* tokenization, so a
 * raw `\r` written into markup does not survive being parsed — the server renders `a\r\nb` and the
 * client reads back `a\nb`. Nothing is injected and nothing looks wrong; the two sides simply hold
 * different strings, which is a hydration mismatch on every render of anything carrying a Windows
 * newline: a `<textarea>` value, a CSV cell, a string from an HTTP payload.
 *
 * Character references are resolved *after* preprocessing, so `&#13;` does survive. **Verified in
 * Chromium, Firefox and WebKit**, all three identical: raw CRLF parses to `[97, 10, 98]` and
 * `a&#13;\nb` parses to `[97, 13, 10, 98]`, in text and in attribute values alike.
 *
 * **NUL is the other character the preprocessor rewrites, and it is not fixable here.** A raw NUL is
 * dropped in text and becomes U+FFFD in an attribute, and `&#0;` is a parse error that also becomes
 * U+FFFD — there is no spelling that round-trips, so a string containing NUL cannot be server
 * rendered faithfully by anyone. It is listed as a limitation in the README rather than silently
 * transformed here, because turning it into U+FFFD would make the markup lie about what the
 * component rendered without making the two sides agree.
 *
 * Precomputed, because building `'&#' + c.charCodeAt(0) + ';'` per character is the slow half.
 */
const ESCAPED: Readonly<Record<string, string>> = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;', '\r': '&#13;' };

export const escapeHtml = (value: unknown): string => {
  /**
   * `` `${value}` `` rather than `String(value)`: identical for everything except a **symbol**,
   * which `String` special-cases into its description while every DOM conversion on the client
   * throws. Serving `Symbol(s)` into markup the client cannot reproduce is the leniency this
   * package's README warns about — it does not make anything work, it moves the failure across the
   * boundary and strips the context.
   */
  const text = typeof value === 'string' ? value : `${value}`;
  return NEEDS_ESCAPE.test(text) ? text.replace(ESCAPE, (character) => ESCAPED[character]) : text;
};

/**
 * Neutralize a `</style>` sequence inside CSS text.
 *
 * `<style>` is a raw-text element: its content is not HTML, so `escapeHtml` cannot be used here —
 * it would turn every `>` in a selector into `&#62;` and break the stylesheet. The only sequence
 * that matters is the end tag, because it is the one thing the HTML tokenizer looks for while
 * inside the element. A value interpolated into `css` and carrying `</style>` therefore closes the
 * element and everything after it parses as markup.
 *
 * `<\/style` is valid CSS — a backslash escape is legal in identifiers and strings, and renders
 * identically — while the tokenizer no longer matches an end tag. Applied here, at the render
 * boundary, rather than in `css` itself: escaping at the source would corrupt the constructed
 * stylesheet path, which is the double-escaping principle #8 warns about. It also catches a
 * sequence assembled across several interpolations, which source-side escaping cannot see.
 *
 * **Deliberately duplicated** in `@verajs/styles` (`escapeStyleText` there is the same three
 * lines). It cannot be shared: the obvious home is `@verajs/shared-utils`, which is private and
 * inlined at build time, and `@verajs/ssr` publishes its `src` with **no dependencies at all** — an
 * import of a package that is never published would break the published tarball. Two copies of a
 * security rule is a real risk, so `tests/ssr-escaping.test.mjs` asserts the two agree on the
 * payloads that matter rather than trusting they will be edited together.
 */
export const escapeStyleText = (value: unknown): string => `${value}`.replace(/<\/(style)/gi, '<\\/$1');

/**
 * The same neutralization, for whichever RAWTEXT element the value landed in.
 *
 * `<style>` and `<script>` are the only two: a browser does not decode a character reference inside
 * either, so escaping their content protects nothing and corrupts it. Interpolating `.a > .b` into a
 * stylesheet produced `.a &#62; .b` — a selector matching nothing — while the client, which sets
 * text through the DOM and never re-parses, rendered it correctly. Every interpolated stylesheet was
 * broken on the server and right in the browser.
 *
 * Writing raw means the element's own end tag has to come out of the value instead, or it closes the
 * element and everything after it parses as markup. `<\/style` is valid CSS and `<\/script` is the
 * canonical form in JavaScript; both render identically and neither is seen by the tokenizer. Only
 * the end tag matters, because it is the only sequence the tokenizer looks for while inside.
 *
 * `<title>` and `<textarea>` are **RCDATA** — references *are* decoded there — so they keep ordinary
 * escaping, which is also what the client produces for them.
 */
const RAW_TEXT_CLOSERS: Partial<Record<string, RegExp>> = { style: /<\/(style)/gi, script: /<\/(script)/gi };

export const escapeRawText = (value: unknown, tag: string): string => {
  const closer = RAW_TEXT_CLOSERS[tag];
  return closer ? `${value}`.replace(closer, '<\\/$1') : escapeHtml(value);
};

/**
 * Elements whose content is text rather than markup. Setting `textContent` on one of these stores
 * the text as written: inside `<style>` or `<script>` a character reference is **not** decoded, so
 * escaping there does not protect anything and does corrupt the content.
 */
/**
 * Elements a parser reads the children of as text.
 *
 * `iframe` and `noscript` were absent, so this DOM built a tree no browser builds:
 * `<noscript><img src="x"></noscript>` parsed to an element here and `querySelectorAll('noscript img')`
 * answered **1** where every engine answers 0, because the content is a text node.
 *
 * Measured across Chromium, Firefox and WebKit rather than read off a spec — and jsdom is not the
 * oracle for this one. It parses with scripting *disabled*, so it agrees with the old list about
 * `noscript` and all three real engines disagree with both.
 */
export const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'textarea', 'title', 'iframe', 'noscript']);

/**
 * Elements that have no end tag. Writing one is not merely redundant — a parser reads `</br>` as
 * *another* `<br>`, so `appendChild(createElement('br'))` served `<br></br>` and rendered two line
 * breaks where the client has one. The same content assigned as a markup string was already correct,
 * so the two paths disagreed with each other as well as with the browser.
 */
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * **A URL a browser reads as `javascript:`** — the twin of `SCRIPT_URL` in `@verajs/shared-utils`,
 * which this package cannot import (it publishes its `src` with no dependencies). Matched the way the
 * URL Standard's parser reads a scheme: leading C0 controls and spaces stripped, ASCII tab, LF and CR
 * removed anywhere, case-insensitive. A bound value that parses this way is code arriving as data, so
 * the client refuses it — and a server that emitted it would serve the very link the client refuses,
 * and a working exploit to anyone who never hydrates. `tests/url-sinks.test.mjs` drives both homes
 * against one stated spec.
 */
// eslint-disable-next-line no-control-regex
export const SCRIPT_URL = /^[\u0000- ]*j[\t\n\r]*a[\t\n\r]*v[\t\n\r]*a[\t\n\r]*s[\t\n\r]*c[\t\n\r]*r[\t\n\r]*i[\t\n\r]*p[\t\n\r]*t[\t\n\r]*:/i;

/**
 * The names whose bound value is checked for `javascript:` — captured: checked from the start (where a browser
 * navigates); not captured: an SVG animation's values, checked item by item. The twin of `URL_SINK` there.
 */
export const URL_SINK = /^(?:(href|src|action|formaction|xlink:href|data)|to|from|by|values)$/i;

/** `SCRIPT_URL` at the start of any `;`-separated item — an animation's `values` list — the twin of `SCRIPT_URL_ITEM` there. */
// eslint-disable-next-line no-control-regex
export const SCRIPT_URL_ITEM = /(?:^|;)[\u0000- ]*j[\t\n\r]*a[\t\n\r]*v[\t\n\r]*a[\t\n\r]*s[\t\n\r]*c[\t\n\r]*r[\t\n\r]*i[\t\n\r]*p[\t\n\r]*t[\t\n\r]*:/i;

/** A bound inline event-handler attribute runs its value as code — the twin of `INLINE_HANDLER` there. */
export const INLINE_HANDLER = /^on./i;

/**
 * The character references that can spell part of a scheme, decoded — enough to give the verdict a
 * browser gives on an attribute's static text, without a full entity table. Numeric references (with
 * or without their `;`) and the three named ones that are scheme-relevant (`&colon;`, `&Tab;`,
 * `&NewLine;`); every other named reference decodes to a character that cannot be part of
 * `javascript:`, so leaving it encoded gives the same verdict.
 */
/**
 * The C1 numbers a parser reads as Windows-1252: `&#128;` is `€`, not U+0080. The HTML standard's table, by
 * offset from 0x80; the five holes (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their own code point.
 */
const C1 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
/**
 * **A numeric reference's character, exactly as a parser decodes it** — the one decoder every reader here uses: NUL, a
 * surrogate or an out-of-range value is U+FFFD, and 0x80–0x9F map through `C1`. `String.fromCodePoint` THROWS past
 * U+10FFFF, so the copies that called it directly took a whole render down on `&#1114112;` in markup.
 */
export const decodeCodePoint = (code: number): string =>
  code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || Number.isNaN(code)
    ? '\ufffd'
    : code >= 0x80 && code <= 0x9f
      ? String.fromCharCode(C1[code - 0x80])
      : String.fromCodePoint(code);

export const decodeSchemeReferences = (text: string): string =>
  text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(colon|Tab|NewLine));?/g, (whole: string, decimal?: string, hex?: string, name?: string) =>
    decimal !== undefined || hex !== undefined
      ? /** One of the two matched, so `decimal ?? hex` is a string: the `!` restates what the test proved. */
        decodeCodePoint(parseInt((decimal ?? hex)!, decimal !== undefined ? 10 : 16))
      : name === 'colon' ? ':' : name === 'Tab' ? '\t' : name === 'NewLine' ? '\n' : whole
  );

/**
 * Where a comment opened at `open` (the index of its `<!--`) ends, as the HTML tokenizer reads it: at `-->`, at
 * `--!>`, or ABRUPTLY at `<!-->` and `<!--->`. Answers the index just past it, or `-1` when it runs to the end of the
 * input — one number, never an allocation, since the component scan asks it for every comment of every render.
 *
 * Knowing only `-->` read `<p><!-->${value}</p>` as a comment swallowing the value, which the browser renders. Every
 * scanner here that meets a comment asks this one rule, and the client's scanner holds its twin.
 *
 * @param markup
 * @param open
 * @returns The index past the comment, or `-1`. The declared `number` is what makes a caller still reading the old
 *   `[dataEnd, end]` shape a compile error; `server-content.test.mjs` also pins every comment shape before a script.
 */
export const commentEnd = (markup: string, open: number): number => {
  const start = open + 4;
  if (markup[start] === '>') return start + 1;
  if (markup[start] === '-' && markup[start + 1] === '>') return start + 2;
  /** `indexOf` for the `--`, then the one or two characters after it: a regex here cost the component scan about 1%. */
  for (let at = markup.indexOf('--', start); at !== -1; at = markup.indexOf('--', at + 1)) {
    if (markup[at + 2] === '>') return at + 3;
    if (markup[at + 2] === '!' && markup[at + 3] === '>') return at + 4;
  }
  return -1;
};
/**
 * Where a comment's TEXT stops, given the end `commentEnd` answered: before `-->`/`--!>`, or at once when abrupt.
 *
 * @param markup
 * @param open
 * @param end
 */
export const commentDataEnd = (markup: string, open: number, end: number): number => (end - open <= 6 ? open + 4 : markup[end - 2] === '!' ? end - 4 : end - 3);
