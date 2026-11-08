// Scenario: a signal read by a sync effect; each op is one write (the effect re-runs) and 10 plain reads, N times.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { signal, effect } = await import(BUNDLE);
const s = signal(0);
let sink = 0, runs = 0;
effect(() => { sink += s.value; runs++; }, { owner: {}, timing: 'sync' }).run();
for (let k = 1; k <= N; k++) { s.value = k; for (let i = 0; i < 10; i++) sink += s.value; }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 && runs === N + 1 ? "ok " + sink : "BAD runs=" + runs + " errors=" + ERRORS));
