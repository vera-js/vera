// Scenario: a whole-array splice and push on a 1000-item store array that a sync effect reads at a few indices, N times.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore, effect } = await import(BUNDLE);
const s = createStore({ list: Array.from({ length: 1000 }, (_, i) => i) });
const list = s.list;
let sink = 0, runs = 0;
effect(() => { sink += list[0] + list[500] + list.length; runs++; }, { owner: {}, timing: 'sync' }).run();
for (let k = 0; k < N; k++) { list.splice(400, 1); list.push(k); }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 && runs > N ? "ok " + sink : "BAD runs=" + runs + " errors=" + ERRORS));
