---
'@verajs/core': patch
---

Name a self-feeding render loop in development, without stopping it

`useEffect(() => { state.total = sum(state.rows) })` next to a template reading `state.total` pegs a
core for as long as the page is open: 11 runs in 10 frames, forever, with no error, no warning, and
nothing to search the console for. `useSyncEffect` has stopped and named its own recursion for a
while; the coalesced path — `useEffect`, `useLayoutEffect`, and a template that writes what it reads
— said nothing at all.

It warns rather than throws, and this is the whole design question rather than a hedge. Vera's
default scheduler is an animation frame, so an effect that writes what it reads already runs once per
frame — which is also how you write an animation. React draws exactly this line (`throw` on the
synchronous cascade, `console.error` on the coalesced one, neither shipped to production) and Lit
warns without stopping and names the legitimate case inside the warning text. Both are followed here.

**What is counted is not frames.** It is consecutive passes that fed *themselves*, reset by the first
pass that does not — React's `nestedUpdateCount` rule. A write that lands outside the pass, from your
own `requestAnimationFrame`, a timer or an event, never trips it at any threshold, so an animation
driven that way is silent by construction rather than by tuning. The count is kept per element **and**
per hook: shared globally, fifty unrelated components that each write once look like one component
looping fifty times, and keyed on the last element to feed, two instances of one buggy component
alternate and neither is ever reported.

**`allowRenderLoop(element)`** marks a loop as deliberate for a component that means it — the escape
hatch Lit ships and React does not, and the one the animation framework needs. A no-op in production.

`__DEV__`-only: **+14 B gzipped** for the detection and **+12 B** for the exported opt-out, and the
production bundle contains neither the counters nor the text. Three collections are marked
`@__PURE__` because a bare `new WeakSet()` at module scope is a constructor call the minifier must
assume has side effects — production was keeping the allocations with their bindings dropped.
