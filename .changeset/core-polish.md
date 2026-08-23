---
'@verajs/core': patch
---

Stop shipping a development warning to production, and give `useEffect` the swappable scheduler.

**A `console.warn` was not behind `__DEV__`.** The "hook ignored — register between init() and
render()" message shipped in every production bundle, message text and all. Guarding it removes
**65 B**, 2.4% of the package, for a diagnostic no production user can act on. Every other warning in
core was already guarded; this one was missed.

**`useEffect` hardcoded its own `requestAnimationFrame`,** byte-for-byte identical to
`animationFrame` in `setRenderScheduler` — including the `typeof` guard for off-browser
environments. Beyond the duplication, it meant `setRenderScheduler(microtask)` moved renders and
left effects on animation frames: an author who chose microtask scheduling precisely to escape the
frame boundary still waited one for every effect. Measured — the order stayed `layout → render →
effect`, but the effect arrived up to a frame later than the other two. Both now use one scheduler.

Also removes 26 lines of commented-out lit code from `store.ts`, a third of that file, sitting
unlabelled beside production code.

Core is 2 686 B to 2 620 B.
