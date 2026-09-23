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
 * honoured — so neither rule applies there, and a consumer that checks must know where it is.
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
