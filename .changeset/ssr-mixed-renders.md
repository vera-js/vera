---
'@verajs/ssr': patch
---

A synchronous `renderToString` fired during an asynchronous one no longer destroys it.

The turn queue was introduced holding only the asynchronous renders, on the stated reasoning that
`renderToString` "is unaffected and still runs whenever it likes". That holds for two synchronous
renders against each other — they are synchronous end to end, so neither can interleave. It does not
hold for a synchronous render fired **inside an asynchronous one's suspension window**: it runs to
completion on this package's module-level bookkeeping, and the async render resumes into the
wreckage.

Measured, the async component came back as `<slow-a><template shadowrootmode="open"></template>
</slow-a>` — empty — while core reported `render() did nothing, no component is being set up`,
because the setup it was closing had been replaced.

A server that renders some routes synchronously and others asynchronously is the ordinary case, so
"do not mix them" was never a restriction anyone could keep, and the failure is silent: the markup is
individually plausible and only wrong relative to what that request asked for.

Both entry points now take a turn from the same queue. `renderModule` is `async` and every caller
already awaits, so this is invisible to them; with nothing in flight it costs one microtask, which is
unmeasurable against a ~30 µs render.
