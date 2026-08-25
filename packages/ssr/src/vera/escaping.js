/**
 * Escaping at the render boundary, and the elements that must not be escaped at all.
 *
 * One place decides what becomes a character reference, because escaping in two places
 * double-escapes and escaping in none is an injection. `<style>`, `<script>`, `<textarea>` and
 * `<title>` hold **text**, not markup: a browser does not decode a character reference inside them,
 * so escaping there does not protect anything and does corrupt the content — a `static styles` with
 * `.a > .b` shipped a broken stylesheet until that was understood.
 */

const NEEDS_ESCAPE = /[&<>"']/;

const ESCAPE = /[&<>"']/g;

/**
 * Escaping is the hottest thing in a large render, and most values have nothing to escape.
 *
 * Asking first is worth it: 200 escapes of ordinary text measured 9.60 µs going straight to
 * `replace` against 3.03 µs testing first — and text that *does* need escaping came out slightly
 * ahead too (21.73 vs 20.03), because a global `replace` sets up more than a single `test` does. On
 * a 100-row table of clean data that is a quarter of the whole render.
 */

/** Precomputed, because building `'&#' + c.charCodeAt(0) + ';'` per character is the slow half. */
const ESCAPED = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' };

export const escapeHtml = (value) => {
  const text = typeof value === 'string' ? value : String(value);
  return NEEDS_ESCAPE.test(text) ? text.replace(ESCAPE, (character) => ESCAPED[character]) : text;
};

/**
 * Neutralise a `</style>` sequence inside CSS text.
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
export const escapeStyleText = (value) => String(value).replace(/<\/(style)/gi, '<\\/$1');

/**
 * The same neutralisation, for whichever RAWTEXT element the value landed in.
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
const RAW_TEXT_CLOSERS = { style: /<\/(style)/gi, script: /<\/(script)/gi };

export const escapeRawText = (value, tag) => {
  const closer = RAW_TEXT_CLOSERS[tag];
  return closer ? String(value).replace(closer, '<\\/$1') : escapeHtml(value);
};

/**
 * Elements whose content is text rather than markup. Setting `textContent` on one of these stores
 * the text as written: inside `<style>` or `<script>` a character reference is **not** decoded, so
 * escaping there does not protect anything and does corrupt the content.
 */
export const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'textarea', 'title']);
