// Scenario: a store array of 100 row objects that a sync effect reads, sorted by a field one way and back, N times
// (every comparator call hands the comparator two rows through the store).
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore, effect } = await import(BUNDLE);
const s = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ id: i, rank: (i * 37) % 100 })) });
const rows = s.rows;
let sink = 0, runs = 0;
effect(() => { sink += rows[0].id + rows.length; runs++; }, { owner: {}, timing: 'sync' }).run();
for (let k = 0; k < N; k++) { rows.sort((a, b) => a.rank - b.rank); rows.sort((a, b) => b.id - a.id); }
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 && runs > N ? "ok " + sink : "BAD runs=" + runs + " errors=" + ERRORS));
