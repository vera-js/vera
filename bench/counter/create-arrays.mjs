// Scenario: a store over a grid of 10 fresh arrays, every row read once, N times (each array meets the store: a cache
// miss and a handler decision per array).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
let sink = 0;
for (let k = 0; k < N; k++) {
  const s = createStore({ grid: [[k], [1], [2], [3], [4], [5], [6], [7], [8], [9]] });
  for (let i = 0; i < 10; i++) sink += s.grid[i][0];
}
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
