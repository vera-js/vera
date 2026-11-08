// Scenario: atomic's UNREAD-array path, a push and a pop on a store array nothing ever read (only the wake count moves), N times. BUNDLE and N are baked in by count.
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
const s = createStore({ list: [1, 2, 3] });
const l = s.list;
let sink = 0;
for (let k = 0; k < N; k++) { l.push(k); sink += l.pop(); }
(globalThis.print ?? console.log)("ran " + N + " " + sink);
