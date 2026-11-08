// Scenario: creating a signal and reading it once, N times (the cell's object and accessor pair, or a store's proxy).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { signal } = await import(BUNDLE);
let sink = 0;
for (let k = 0; k < N; k++) sink += signal(k).value;
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
