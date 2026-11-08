// Scenario: a nested read of a NEW object each time, so every read misses the proxy cache and goes through handlerFor (the type door) and wrap, N times.
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
const s = createStore({ o: null, rows: [] });
let sink = 0;
for (let k = 0; k < N; k++) { s.o = { a: k, b: { c: k } }; sink += s.o.a + s.o.b.c; }
(globalThis.print ?? console.log)("ran " + N + " " + sink);
