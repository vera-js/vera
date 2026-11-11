// Scenario: an UNWATCHED computed read in plain code, N times, its source written every 10th op (a cached read 9 of 10;
// a re-evaluation on the 10th).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore, computed } = await import(BUNDLE);
const s = createStore({ n: 1 });
const c = computed(() => s.n * 2);
let sink = 0;
for (let k = 0; k < N; k++) { if (k % 10 === 0) s.n = k; sink += c.value; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
