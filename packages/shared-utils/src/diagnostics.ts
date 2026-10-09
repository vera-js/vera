/**
 * **The codes more than one package prints — DEVELOPMENT ONLY** (vera-5a, 2026-10-09). A fact said by two emitters has
 * ONE docs page and ONE text, so its prose lives here, in the lowest dependency every emitter shares, and each raises
 * it as `SHARED['code']` — never a second sentence in a second table (the dev line would stop being the docs page's
 * text). Referenced only behind `__DEV__`, so production drops it whole. `scripts/sync-diagnostics.mjs` publishes it
 * as `packages/shared-utils/diagnostics.json`; the uniqueness check sees each code here once.
 *
 * Also the home of messages shared-utils' OWN code prints on a renderer's behalf (adopt-property, markup-grammar,
 * isSelection) — the same rule: the emitter is shared, so the text is.
 *
 * **One named export per code, never one object** (vera-5a, measured 2026-10-09): rollup cannot drop an unused KEY of
 * an object literal, so a shared `PROSE` object put every shared message into every importer's development bundle.
 * A named export is dropped per function. **The export's name IS the code** — `tagCalled` is `tag-called` — so the
 * map sync and the tests read is derived (`proseOf`, scripts/diagnostic-tables.mjs), never kept by hand, and a call
 * `SHARED.tagCalled(…)` names its code exactly once.
 */
import type { Prose } from './types.js';

/** core's `html`/`svg`/`mathml` and the renderer's `tag` — a tagged template called as a function. */
export const tagCalled: Prose = (tag, received) => [
  `expected a template literal and received ${received}.`,
  `It is a tagged template — write ${tag}\`<p>hi</p>\`, not ${tag}('<p>hi</p>').`,
];
/** core's props adoption on an `init()` element, and the renderer's on any other element. */
export const getterOnlyProp: Prose = (key) => [
  `received a bound property \`.${key}\`, but its class declares \`${key}\` as a getter with no setter — the value cannot be delivered and the binding is ignored.`,
  'Add a setter, or stop binding it.',
];
