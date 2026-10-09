---
'@verajs/core': minor
'@verajs/ssr': patch
---

One queue, one flush: renders and effects run as a microtask, within a per-frame budget

**Breaking for timing.** Every queued render, layout effect and effect now runs in ONE flush — a microtask, as in Lit
and Vue — instead of on the element's next animation frame. After `await`, the DOM and its effects are current — unless
that frame's flush budget was already spent, when they land on the next frame; `flush()` drains at once for code that
must read the DOM now. A write reaches the DOM in about 1–5 ms instead of 19–24.

- **Order:** renders, then layout effects, then effects — and parents before children, so a child re-rendered by its
  parent's new props renders once.
- **`useLayoutEffect` now means what it means in React:** it runs right after the render, so it measures the DOM that
  render made, and a write it makes re-renders in the same flush, before paint. It used to run BEFORE the render and
  see the previous render's DOM — a measurement ported from React measured stale layout. A layout effect now also runs
  after `@verajs/directives` has applied an element's directives. A hook of your own made with `createHook` at a
  priority between 25 and 60 that relied on running after layout effects on the first pass now runs before them.
- **The budget:** past about 4 ms of flush work in a frame, the next flush waits for the element window's frame (or a
  short timer where there are no frames — a hidden tab, a test, a server). Fifty events landing in one frame render
  about once, as they did on frames; a plain microtask rendered them fifty times.
- **Loops:** a hook may run twice in one flush — so an effect that measures what was just rendered and stores it lands
  before paint — and a third run waits for the next frame. A self-feeding effect never freezes the page; development
  warns after 50 consecutive frames, naming the hook that writes. `allowRenderLoop(element)` silences it.
- **`flush()`** runs everything queued, synchronously — replacing the swap-the-scheduler `flushSync` recipe.
- **`setRenderScheduler(fn)`** now decides when a FLUSH runs; `microtask` is the same timing without the budget.
- **Effects run before paint**, after their flush's renders: a slow `useEffect` delays its own update's paint.
- A window with no animation frames updates after a microtask, like every other, rather than synchronously.
- **`useHook(callback, priority, element?)`** is new: a hook of your own, scheduled as the built-in ones are, at a
  priority you choose — `25` runs before the render and reads the DOM the last render left. `createHook` stays the
  raw primitive, which runs inside every write it hears, unbatched.

`@verajs/ssr`: each round of the server's drains runs core's flush first, so both `renderToString` and
`renderToStringAsync` serialize the same settled markup — a `useLayoutEffect`'s state now reaches the markup through
both (it reached only the asynchronous one).
