/**
 * **Styles' diagnostics, keyed by code — DEVELOPMENT ONLY.** Referenced only behind `__DEV__`, so production drops this
 * module whole. `scripts/sync-diagnostics.mjs` publishes it as `packages/styles/diagnostics.json` — the docs pages — and
 * `tests/diagnostics-tables.test.mjs` holds the codes raised and the entries together.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'css-called': (received) => [
    `expected a template literal and received ${received}.`,
    "It is a tagged template — write css`p { color: red }`, not css('p { color: red }').",
  ],
  'adopt-not-element': (received) => [
    `expected a component element and received ${received}.`,
    "It adopts the element's own class `static styles` — `adoptStyles(this)`.",
  ],
  'apply-not-element': (received) => [
    `expected a component element as the *second* argument and received ${received}.`,
    'The order is styles first — `applyStyles(sheet, this)`.',
  ],
  'apply-not-css': (received) => [
    `expected CSS and received ${received}.`,
    'Pass a css`…` result, a string of CSS, or an array of those — a falsy entry is fine and is skipped, so `[base, dark && darkSheet]` works.',
  ],
  'no-scope': (tag) => [
    `this engine has no \`@scope\`, so light-DOM \`static styles\` are hoisted to the document **unscoped** — every rule applies page-wide here and only to <${tag}> elsewhere.`,
    'Attach a shadow root to scope them everywhere, or write selectors that carry the tag.',
  ],
  'layer-order': (order) => [
    "this page's CSS uses cascade layers but does not say where `vera` goes, so a light component's defaults (in `@layer vera`) come after every other layer and beat its utilities.",
    `State the order first in your CSS, before the framework's import: \`${order}\` (a \`@verajs/ssr\` render's \`styles\` opens with it).`,
  ],
  'slotted-light': () => [
    'has no shadow root, and `::slotted()` only ever matches inside one — those rules do nothing here.',
    'In light DOM you do not need it: slotted content is in the same tree, so an ordinary descendant selector reaches it. For a component that renders BOTH ways, write both — `::slotted(img), [part="body"] img`.',
  ],
};
