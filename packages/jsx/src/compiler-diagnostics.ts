/**
 * **The jsx compiler's diagnostics, keyed by code — DEVELOPMENT ONLY, like every other table** (code-system phase 3,
 * vera-5a; Brian, 2026-10-09). The production compiler is the file a buildless page fetches (`vera-jsx.min.js`, loaded
 * lazily by the standalone loader on a cold visit), so its words would be paid on every buildless JSX page: production
 * prints the position and the code's docs link, `file:line:col — https://verajs.dev/e/<code>`. **Node and Vite keep
 * the words** — the package's `"node"` export condition is the development build, so the build tool, which no page
 * ever downloads, says `file:line:col — sentence fix (code)`. Two facts are the renderer's `tag()` refusals too and
 * live in shared-utils' table (`void-children`, `style-object`). `scripts/sync-diagnostics.mjs` merges this with the
 * standalone loader's table into `packages/jsx/diagnostics.json`.
 */
import { DOCS } from '@verajs/shared-utils';
import type { Prose } from '@verajs/shared-utils';


export const PROSE: Record<string, Prose> = {
  'jsx-tag-mismatch': (open, close) => [
    `<${open}> is closed by </${close}>.`,
    `End <${open}> with </${open}>, before </${close}>.`,
  ],
  'jsx-unclosed-comment': () => [
    'a comment among the attributes is never closed (*/).',
    'Close it with */.',
  ],
  'jsx-empty-expression': (written) => [
    `${written} has no value.`,
    'Fill the braces, or remove them.',
  ],
  'jsx-key-placement': () => [
    'key belongs on the JSX root returned from a list callback.',
    'Move it to the element the callback returns.',
  ],
  'jsx-inner-html-shape': (given) => [
    `dangerouslySetInnerHTML expects {{ __html: expr }} — ${given}.`,
    'Sanitize the value first: it is written as HTML.',
  ],
  'jsx-sigil-value': (name) => [
    `${name} needs a value.`,
    `Write ${name}={…}.`,
  ],
  'jsx-uncontrolled': (name, tag, undone, initial) => [
    `${name}={…} makes this <${tag}> controlled: every render writes it back, so ${undone} unless onInput/onChange keeps the bound value in step.`,
    `For an initial value use ${initial}; for a fixed one, add readOnly.`,
  ],
};

/**
 * The compiler's message: in development a sentence and its fix, ending with the code that names its docs page; in
 * production (the prose folded away at the call, `__DEV__ && PROSE[…]`) the docs page itself.
 */
export const coded = (code: string, prose: false | readonly [string, string?]) =>
  prose ? `${prose[0]}${prose[1] ? ` ${prose[1]}` : ''} (${code})` : `${DOCS}${code}`;
/**
 * Called as `coded('x', __DEV__ && PROSE['x'](…))`, naming the code twice — `tests/diagnostics-tables.test.mjs` holds
 * the two equal. A `say(code, …args)` that looked the prose up itself was measured 16 B larger (2026-10-09, when the
 * words still shipped): with literal keys each entry inlined at its one call site, and a lookup keeps the whole table.
 */
