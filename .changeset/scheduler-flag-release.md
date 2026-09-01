---
'@verajs/core': patch
---

A scheduler that throws no longer freezes the component forever

Every render and every effect passes through whatever `setRenderScheduler` holds, which makes it the
widest blast radius in core — and pass 92 was the first audit to point at it.

The coalescing flag is raised *before* the pass is handed to the scheduler and lowered *inside* it, so
a scheduler that never runs the pass left it raised and every later write returned early. The
component then stopped rendering **permanently**: measured frozen at its initial value, with no error
and no warning, and not revived by restoring the default scheduler. The effect path had the same
shape under a different flag name, so renders and effects both went silent.

Worse, it is invisible at the call site: `createHook` isolates a hook's error to the `'error'` insert
so one bad hook cannot take out its siblings, which means the throw never reaches the code doing
`state.n = 1`.

The flag is now released when the scheduler throws, and a pass **stranded** by a scheduler that drops
it is re-queued once that scheduler is replaced.

The second half was nearly left unfixed, on the reasoning that a dropped pass cannot be told apart
from a deferred one. That is true *at the moment of scheduling*, and that is not the only moment:
once the scheduler has been replaced, whatever the old one was holding is provably never going to
run, because nothing will ever call it again. `setRenderScheduler` bumps a generation — a live
binding, exactly as `revision` is in `@verajs/inserts` — and the coalescing guard stops honouring a
flag raised under a scheduler that no longer exists. A component that never renders again is not
something to leave standing behind an argument about contracts.

Coalescing is unaffected within a single scheduler, which the suite asserts directly: twenty writes
in one tick still produce exactly one render. 30 B gzipped.

`tests/core-scheduler.test.mjs` also executes the `flushSync` recipe `llms.txt` publishes for View
Transitions, verifying it renders synchronously and restores the previous scheduler, and exercises the
exported `microtask` scheduler.
