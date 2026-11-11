// Scenario: a WATCHED computed (a sync effect reads it), its source written each op: the computed re-evaluates inside
// the write and wakes the effect.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore, computed, effect } = await import(BUNDLE);
const s = createStore({ n: 0 });
const c = computed(() => s.n * 2);
let runs = 0, sink = 0;
effect(() => { sink += c.value; runs++; }, { owner: {}, timing: 'sync' }).run();
for (let k = 1; k <= N; k++) s.n = k;
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 && runs === N + 1 ? "ok " + sink : "BAD errors=" + ERRORS + " runs=" + runs));
