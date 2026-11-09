// Scenario: a key ADDED to a read record, then deleted, each op (two writes that notify the key and the key set), with a
// reader of the record's keys subscribed, so the wakes are real.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore, effect } = await import(BUNDLE);
const s = createStore({ r: { a: 1 } });
let runs = 0;
effect(() => { void Object.keys(s.r); void s.r.k; runs++; }, { owner: {}, timing: 'sync' }).run();
for (let k = 0; k < N; k++) { s.r.k = k; delete s.r.k; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + (runs > N ? 'woken' : 'NOT WOKEN ' + runs) : "BAD errors=" + ERRORS));
