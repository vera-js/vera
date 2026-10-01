/**
 * HTML's own element grammar — the facts about tags that every package emitting or reading markup
 * has to agree on.
 *
 * These are not this framework's rules; they are the parser's, and a package that guesses at them
 * produces markup whose *parse* differs from what its author wrote. That failure is silent by
 * nature: nothing throws, the page renders, and the DOM simply has a different shape than the
 * source said. See `VOID_ELEMENTS` below for the two measured instances.
 *
 * **Why here.** These sets had grown copies in `@verajs/ssr`, `@verajs/cms` and (as a regex) the
 * renderer, all agreeing by luck rather than by construction. This file is the one source for
 * every package that can take a build-time import — `@verajs/shared-utils` is private and inlined,
 * so importing it costs a consumer nothing at runtime and adds no published dependency.
 *
 * **`@verajs/ssr` cannot import it** and keeps its own copies: that package publishes its `src`
 * with no dependencies at all, so an import of a package that is never published would break the
 * published tarball. The same constraint already forced a twin of `escapeStyleText` there. A copy
 * is acceptable; a copy nothing checks is not, so `tests/markup-grammar-homes.test.mjs` drives
 * every copy against this file source-to-source rather than trusting they get edited together.
 *
 * **A consumer may keep a different SHAPE for the same fact** where a hot path needs one — the
 * renderer matches raw-text tags with a case-insensitive regex rather than lowercasing a string to
 * probe a `Set`. The rule is agreement, not representation, and the homes test asserts agreement
 * across whatever shape each home uses.
 */

/**
 * Elements with no end tag, and therefore no children.
 *
 * Both directions of getting this wrong are silent, and both were live in this repo until the
 * audit of 2026-09-12 measured them:
 *
 * - **A non-void element written self-closing swallows what follows it.** HTML has no
 *   self-closing syntax outside foreign content, so `<div/><span>after</span>` parses as
 *   `<div><span>after</span></div>` — the sibling becomes a child. Every JSX toolchain treats
 *   `<div/>` as an empty element, which is exactly why authors write it.
 * - **A void element written with an end tag is duplicated.** A parser reads `</br>` as *another*
 *   `<br>`, so `<br></br>` renders two line breaks where the author wrote one.
 *
 * Inside `<svg>` and `<math>` the parser switches to foreign content, where XML self-closing *is*
 * honored — so neither rule applies there, and a consumer that checks must know where it is.
 */
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Elements a parser reads the children of as text rather than as markup.
 *
 * Two pieces of measured lore travel with this list and are the reason it is not read off a spec:
 *
 * - `iframe` and `noscript` were once absent from the SSR copy, which built a tree no browser
 *   builds — `<noscript><img src="x"></noscript>` produced an element, so
 *   `querySelectorAll('noscript img')` answered 1 where every engine answers 0.
 * - `noscript` is raw text only when scripting is ENABLED. Fragment parsing disables it, and
 *   Chromium and WebKit then parse the content as markup while Firefox parses it as text — so a
 *   binding inside `<noscript>` worked in two engines and painted the renderer's internal marker
 *   onto the page in the third. Listing it is safe in both parses.
 *
 * jsdom is not the oracle for either: it parses with scripting disabled and agrees with the old,
 * wrong list.
 */
export const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'textarea', 'title', 'iframe', 'noscript']);

/**
 * The hyphenated names SVG and MathML already define, which the custom-elements spec reserves — so a
 * dash in one of these does NOT make it a custom element.
 *
 * Measured, the one that matters: JSX treats a dash-named tag as a custom element and compiles its
 * attributes to PROPERTIES, which turned `<annotation-xml encoding="text/html">` into
 * `.encoding=${…}`. The HTML parser decides that element is an integration point from the
 * ATTRIBUTE on its start tag, so HTML content inside was moved out of the `<math>` entirely, and a
 * custom element there was built MathML-namespaced and never upgraded — silent on the server and
 * the client alike. That is also the exact spelling the renderer's own warning recommends.
 */
export const RESERVED_ELEMENT_NAMES = new Set([
  'annotation-xml', 'color-profile', 'font-face', 'font-face-src',
  'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph',
]);

/**
 * A URL whose scheme a browser reads as `javascript:` — navigating to one runs it, so a BOUND value
 * that parses this way is code arriving as data, never a link.
 *
 * Matched the way the URL Standard's parser reads a scheme, because that is the only reading that
 * matters: leading C0 controls and spaces are stripped, ASCII tab, LF and CR are removed anywhere, and
 * the scheme is case-insensitive. A check that only lowercases is bypassed by `" jAvA\tscript:"`,
 * which every engine navigates to. React's blocking pattern is the same rule.
 *
 * `@verajs/ssr` keeps a twin (it cannot import this package), held to this one by
 * `tests/url-sinks.test.mjs`, so a server never emits a link the client refuses.
 */
// eslint-disable-next-line no-control-regex
export const SCRIPT_URL = /^[\u0000- ]*j[\t\n\r]*a[\t\n\r]*v[\t\n\r]*a[\t\n\r]*s[\t\n\r]*c[\t\n\r]*r[\t\n\r]*i[\t\n\r]*p[\t\n\r]*t[\t\n\r]*:/i;

/**
 * **Every bound name whose value is checked for a `javascript:` URL — and how.** One test answers both.
 *
 * Captured, checked from the start: the attributes (and their reflecting properties) whose value a browser
 * NAVIGATES to or loads as a document — links and areas (`href`, SVG's `xlink:href`), forms (`action`,
 * `formaction`), frames (`src`), and `<object data>`. `src` is matched on every element — refusing one on an `<img>`
 * costs nothing, since an image never runs it. Resource-only attributes (`poster`, `srcset`) are fetched, never run,
 * so they are not listed.
 *
 * Not captured, checked ITEM BY ITEM (`SCRIPT_URL_ITEM`): an SVG animation's values — `to`, `from`, `by`, `values`.
 * `<animate attributeName="href" to="javascript:…">` (or `<set>`, or `values`) writes its value onto the link it
 * animates, and clicking the link then RUNS it: measured 2026-09-30 in Chromium, Firefox and WebKit, through `href`
 * and `xlink:href` alike. Refused on EVERY element and whatever `attributeName` says, because `attributeName` can
 * itself be bound or spread, a server spread has no element to ask, and no legitimate value of any attribute by these
 * names starts with `javascript:` (a component's `to`, a router link's, is a URL too). **Only these names are checked
 * item by item**: an unanchored test scans the whole value for `;`, which on a bound `src` holding a data URI costs
 * ~0.45 ms per MB per update in Chromium and Firefox (measured 2026-09-30), where the anchored `SCRIPT_URL` stops at
 * the first character.
 *
 * Case-insensitive, because property spellings (`formAction`) and attribute spellings meet here. `@verajs/ssr` keeps
 * a twin, held to this one by `tests/url-sinks.test.mjs`.
 */
export const URL_SINK = /^(?:(href|src|action|formaction|xlink:href|data)|to|from|by|values)$/i;

/**
 * `SCRIPT_URL` at the start of the value OR of any `;`-separated item of it — an animation's `values` list
 * (`"#a;javascript:…"`) applies every item in turn. Only for an animation's values (`URL_SINK`'s uncaptured names): a `;` inside an `href` is a path
 * character, and `/p;javascript:x` is a working link, never a script. Written out rather than derived from
 * `SCRIPT_URL`: the repeated text costs less gzipped than the code that would build it.
 */
// eslint-disable-next-line no-control-regex
export const SCRIPT_URL_ITEM = /(?:^|;)[\u0000- ]*j[\t\n\r]*a[\t\n\r]*v[\t\n\r]*a[\t\n\r]*s[\t\n\r]*c[\t\n\r]*r[\t\n\r]*i[\t\n\r]*p[\t\n\r]*t[\t\n\r]*:/i;

/**
 * **An inline event-handler attribute** — `on` and a letter, any case (`onclick`, `onLoad`, `onbeforeinput`): its
 * value is run as CODE, so a BOUND one is code arriving as data, refused by the template scanner, `spread` and the
 * server alike (a static `onclick="save()"` is the author's own and untouched). Broad on purpose — it also refuses a
 * bound `once=`/`online=` attribute; the precise rule would need the platform's list of handler names. `@verajs/ssr`
 * keeps a twin, held to this one by `tests/inline-handlers.test.mjs`.
 */
export const INLINE_HANDLER = /^on./i;

/**
 * **The properties that replace an element's whole content** — a binding to one owns the element's children, so it
 * cannot share the element with content of its own (markup, or a child binding the write would strand: a later commit
 * into it then throws on a missing parent). Development refuses the pair in the template scanner and in `spread` alike.
 */
export const CONTENT_PROPERTY = /^(?:textContent|innerHTML|innerText|outerHTML)$/;
export const contentClash = (tag: string, name: string): never => {
  throw new Error(
    `renderer: <${tag}> binds \`.${name}\`, which replaces the element's content, and also has content of its own — ` +
      `markup or a child binding, which the write would strand. Bind one or the other: the property alone ` +
      `(\`<${tag} .${name}=\${…}></${tag}>\`), or the content alone.`
  );
};
