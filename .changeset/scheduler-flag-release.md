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

The flag is now released when the scheduler throws, on both paths. A scheduler that *drops* the pass
without throwing is left alone deliberately and asserted as such — it cannot be told apart from one
legitimately deferring, which is the whole of what a scheduler does, and `RenderScheduler` is
documented as deciding *when* to run the pass rather than whether.

`tests/core-scheduler.test.mjs` also executes the `flushSync` recipe `llms.txt` publishes for View
Transitions, verifying it renders synchronously and restores the previous scheduler, and exercises the
exported `microtask` scheduler.
