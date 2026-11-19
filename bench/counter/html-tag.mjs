// Scenario: the `html` tag called N times with three values (the template result each render makes) — the code the
// @verajs/lite split moved within core's bundle (2026-11-17: the same function, placed by its own shared-utils entry).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { html } = await import(BUNDLE);
let sink = 0;
/** The sink stays an int32 (`| 0`): a running total past 2^31 turns into a double partway through a long run, and the
 *  slope then rises with N (measured: SpiderMonkey 371 → 380 per op from the short pair to the long one). */
for (let k = 0; k < N; k++) { const r = html`<p class=${k}>${k + 1}</p>${k}`; sink = (sink + r.values[1] + r.strings.length) | 0; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
