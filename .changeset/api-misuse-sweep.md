---
'@verajs/core': patch
'@verajs/renderer': patch
'@verajs/router': patch
'@verajs/styles': patch
---

Ten public APIs now name the mistake instead of leaking an internal

The second audit sweep took passes 22 and 80's lens again — wrong-typed input to every public
function — but **mechanically** this time: every export of all thirteen entry points, crossed with
seven wrong values, filtered for errors that name an internal rather than the call. The hand-picked
passes had found three defects; enumerating found six more.

**The worst was silent.** `html('<p>hi</p>')` — the call form rather than the tagged form, which is
how the same job is done in libraries that take a markup string — returned a template-shaped object
with a *string* where the strings array belongs. It passed every shape check and failed much later
inside the renderer with `Invalid value used as weak map key`, because the template cache is keyed by
the strings array and a string is not a legal key. Nothing in that message mentions `html`. `svg` and
`mathml` did the same; `css` threw `strings.reduce is not a function`.

Also guarded: `untrack(state.a)` instead of `untrack(() => state.a)` — which reads the property
*before* untrack is entered, so it is tracked after all, the opposite of what was asked — plus
`renderInto` with no container, `keyed` with no template, `tag('h1')` called instead of tagged,
`navigate(undefined)` (an async throw, so it surfaced as an unhandled rejection naming nothing), and
both `@verajs/styles` entries.

The template-literal check is `Array.isArray` and deliberately **not** `raw`: a hand-built
`html([markup])` works and `ssr-scale.test.mjs` builds a hundred nested components that way. That
shape does churn template identity, which is the render profiler's business to report rather than
this guard's to forbid. The defect fixed here is the silent one.

All `__DEV__`-only, so production carries none of it.
