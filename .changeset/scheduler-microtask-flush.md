---
'@verajs/core': minor
'@verajs/ssr': patch
---

One queue, one flush: renders and effects run as a microtask, within a per-frame budget

**Breaking for timing.** Every queued render, layout effect and effect now runs in ONE flush — a microtask, as in Lit
and Vue — instead of on the element's next animation frame. After `await`, the DOM and its effects are current; a
write reaches the DOM in about 1–5 ms instead of 19–24.

- **Order:** layout effects, then renders, then effects — and parents before children, so a child re-rendered by its
  parent's new props renders once.
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

`@verajs/ssr`: each round of the server's drains runs core's flush first, so both `renderToString` and
`renderToStringAsync` serialize the same settled markup — a `useLayoutEffect`'s state now reaches the markup through
both (it reached only the asynchronous one).
