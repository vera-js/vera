// Scenario: creating a store over a fresh record and an array, with one read of each, N times (createProxy: cache miss, handlerFor, wrap).
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
let sink = 0;
for (let k = 0; k < N; k++) { const s = createStore({ a: k, rows: [k, k + 1] }); sink += s.a + s.rows[1]; }
(globalThis.print ?? console.log)("ran " + N + " " + sink);
