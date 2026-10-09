/**
 * **The jsx compiler's diagnostics, keyed by code — in EVERY build** (code-system phase 3, vera-5a, 2026-10-09). Unlike
 * every runtime table, this one is not behind `__DEV__`: a compile error is a build tool's only output, Vite and Node
 * load the compiler through the `default` condition (its production bundle), and the standalone loader imports it
 * lazily, only when something must be compiled. So the words stay and the code is added: `file:line:col — sentence fix
 * (code)`. Two facts are the renderer's `tag()` refusals too and live in shared-utils' table (`void-children`,
 * `style-object`). `scripts/sync-diagnostics.mjs` merges this with the standalone loader's table into
 * `packages/jsx/diagnostics.json`.
 */
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

/** A sentence and its fix, ending with the code that names its docs page — the compiler's message, every build. */
export const coded = (code: string, [sentence, fix]: readonly [string, string?]) => `${sentence}${fix ? ` ${fix}` : ''} (${code})`;
/**
 * Called as `coded('x', PROSE['x'](…))`, naming the code twice — `tests/diagnostics-tables.test.mjs` holds the two equal.
 * A `say(code, …args)` that looked the prose up itself was measured 16 B larger (2026-10-09): with literal keys the
 * production compiler carries each code once and no table object — every entry inlined at its call site.
 */
