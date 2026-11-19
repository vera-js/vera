/**
 * **`@verajs/static`'s own diagnostics — DEVELOPMENT ONLY** (production keeps the code and its link). The codes only
 * static raises; the ones it shares with `@verajs/core` and `@verajs/lite` (`define`'s checks, `tag-called`,
 * `forged-template`) are shared-utils' (`SHARED`). Published as `packages/static/diagnostics.json` by
 * `scripts/sync-diagnostics.mjs`.
 */
import type { Prose } from '@verajs/shared-utils';

/** Static's own codes and their development sentences, keyed by code (`misuse` / `warnOnce` raise them). */
export const PROSE: Record<string, Prose> = {
  'static-hole': () => [
    'a hole sits where a value could become code or choose markup: in a tag or attribute name (`<${…}>`, `<p ${…}>`), or inside a `<script>` that is not a JSON data block (in any namespace), an `<iframe>`, `<noscript>`, `<template>` or an obsolete raw-text element. The template is refused, in every build.',
    'Put values in text and attribute values; bind behavior with `@verajs/directives`, or move the component to `@verajs/lite` or `@verajs/core`, which bind events and properties. An `<iframe>` is set through its attributes (`src`, `title`, `allow`): its content is fallback no browser shows. A `<noscript>` shows only with scripting off, when this tier never runs, so write it in the served page or render it with `@verajs/ssr`; one with no value inside renders here. (`@verajs/core` writes a value there as text.)',
  ],
  'static-needs-renderer': (what) => [
    `${what} needs \`@verajs/lite\` or \`@verajs/core\`: \`@verajs/static\` renders markup once, so it does not work here (development says so; production renders nothing for it).`,
    'Bind behavior with `@verajs/directives`, or import the component from `@verajs/lite` or `@verajs/core`: the same source runs there.',
  ],
};
