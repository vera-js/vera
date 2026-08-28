---
'@verajs/reactivity': patch
---

`computed` refuses a non-function by name

`computed(undefined)` — what a mistyped argument or a missing import produces — was accepted, and
failed at the first read with `evaluate is not a function`. That names a local variable inside
`computed.ts` and neither the API that was called wrong nor what to pass instead.

It now says which function was called and shows the shape it wanted:
`computed(() => a + b)`, not `computed(a + b)`.

`__DEV__`-only, like the other diagnostics here, so production carries neither the check nor the
message.

Found by a sweep calling every public function in every package with wrong-typed input — 192 calls
across `@verajs/core` and 68 across both SSR entries named the API correctly, and this was the one
that did not.
