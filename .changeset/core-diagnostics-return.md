---
'@verajs/core': patch
---

Core's diagnostics return, and two behaviors are corrected

The diagnostics the 0.3 rebuild set aside are back, each tied to a code with a docs entry. Development only (zero
production bytes) unless noted:

- **No renderer wired** is said once per page **in every build** — a CDN page never runs a development build.
- A self-feeding `useSyncEffect` is stopped and named at depth 50; `html`/`svg`/`mathml` called with a string,
  `untrack`/`setRenderScheduler` given a non-function, `init`/`allowRenderLoop` given a non-element are named; a write a
  store's source object refuses (frozen, sealed, non-writable, getter-only) names the rule instead of the engine's
  trap message; a `Map`/`Set` in a store with nothing to make it reactive is said once; a bound property meeting a
  getter-only member is refused and said once; a setup that registered hooks but was never committed, and a second
  `init()` in one setup, are said; markup addressed to an unwired directives engine is said.
- A bare `render()` (no template) commits the setup without registering a render — it no longer draws `undefined`
  over the root — and development names `mount()`.
- **A cleanup that throws now reaches the app's `'error'` chain**, like a hook that throws, attributed to its
  component — apps with a chain wired will now see cleanup errors they did not before. With no chain it prints
  `[vera] a cleanup threw:`.
- `init` and `allowRenderLoop` accept an element from another window (a popped-out window's component failed the
  opener's `instanceof Element`).
- Each copy of core tears down only the components it initialized: a page holding two copies (a bundle that inlines
  core) threw on removing a component, as one copy read fields the other never set.
