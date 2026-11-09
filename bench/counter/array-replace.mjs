// Scenario: a 100-row list replaced by a reordered copy of itself (`s.rows = [last, ...rest]`, its items the store's
// proxies), then every row read: the one-level copy stores the items raw; without it the raw array holds proxies.
/* global BUNDLE, N -- the counter writes both in front of the scenario */
globalThis.queueMicrotask ??= (f) => { Promise.resolve().then(f); }; let ERRORS = 0; globalThis.console ??= {}; for (const k of ["log", "error", "warn"]) { const prev = console[k]; console[k] = (...a) => { if (k !== "log") ERRORS++; (prev ?? print)(...a); }; }
globalThis.HTMLElement ??= class {}; globalThis.customElements ??= { define() {}, get() {} };
const { createStore } = await import(BUNDLE);
const s = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ id: i })) });
let sink = 0;
for (let k = 0; k < N; k++) {
  const rows = s.rows;
  const next = [rows[99]];
  for (let i = 0; i < 99; i++) next.push(rows[i]);
  s.rows = next;
  const now = s.rows;
  for (let i = 0; i < 100; i++) sink += now[i].id;
}
(globalThis.print ?? console.log)("ran " + N + " " + (ERRORS === 0 ? "ok " + sink : "BAD errors=" + ERRORS));
