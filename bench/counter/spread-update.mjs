// Scenario: `rows[i] = { ...rows[i], label }` on a 1000-row store, each op (a fresh record of primitives: the set trap's
// one-level copy scans its keys and finds no store).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
const s = createStore({ rows: Array.from({ length: 1000 }, (_, i) => ({ id: i, label: 'r' + i })) });
let sink = 0;
for (let k = 0; k < N; k++) { const i = k % 1000; s.rows[i] = { ...s.rows[i], label: 'x' }; sink += s.rows[i].id; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
