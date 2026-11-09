// Scenario: a fresh record HOLDING a store object written each op, then read through (`{ id, child: s.pool[j] }`): the
// one-level copy stores the child raw; without it the raw data holds the child's proxy.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
const s = createStore({ row: null, pool: Array.from({ length: 10 }, (_, i) => ({ v: i })) });
let sink = 0;
for (let k = 0; k < N; k++) { s.row = { id: k, child: s.pool[k % 10] }; sink += s.row.child.v; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
