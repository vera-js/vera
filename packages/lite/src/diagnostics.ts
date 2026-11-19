/**
 * **`@verajs/lite`'s own diagnostics — DEVELOPMENT ONLY** (production keeps the code and its link). The codes only lite
 * raises; the ones it shares with `@verajs/core` (`define`'s checks, `setup-returned-value`, `unfinished-tag`,
 * `forged-template`…) are shared-utils' (`SHARED`). Published as `packages/lite/diagnostics.json` by
 * `scripts/sync-diagnostics.mjs`.
 */
import type { Prose } from '@verajs/shared-utils';

/** Lite's own codes and their development sentences, keyed by code (`misuse` / `warnOnce` raise them). */
export const PROSE: Record<string, Prose> = {
  'tier-needs-core': (what) => [
    `${what} needs \`@verajs/core\`: \`@verajs/lite\` does not have it, so it does not work here (development says so; production is silent).`,
    'Import from `@verajs/core` and wire a renderer to use it: every component written for `@verajs/lite` runs there unchanged.',
  ],
  'tier-hole-position': () => [
    'a hole sits where the HTML parser does not keep it as a value (inside a comment, a `<script>` that is not a JSON data block, an element that is never shown such as `<noscript>`, `<iframe>` or `<template>`, a tag position such as `<p ${…}>`, a duplicate attribute, a binding name with a non-ASCII capital letter (the parser lowercases only ASCII), an element its parent cannot hold such as `<div>` in `<select>`), or a value is bound under an element whose content `.innerHTML` or `.textContent` replaces: a value would land where the template does not show it, so the template is refused, in every build. ON THE SERVER, one more cause: an HTML element written inside SVG or MathML content (`<div>` in an `<svg>`), which a browser moves out of it and `@verajs/ssr`\'s DOM does not reproduce, so a hole in that subtree is never found there.',
    "Keep holes in text, attribute values and the text of `<title>`, `<textarea>`, `<style>` or a JSON data block; a binding in a tag position (a ref, a spread) is core's. Put HTML inside SVG in a `<foreignObject>`, and inside MathML in an `<mtext>`.",
  ],
};
