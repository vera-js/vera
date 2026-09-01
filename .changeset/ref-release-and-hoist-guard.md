---
'@verajs/renderer': patch
'@verajs/styles': patch
---

An element ref is told when its element goes away, and styles hoist once across copies

**Refs are released.** A ref was told about attachment and never about detachment, so it kept a
detached node alive and a component reading `myRef.value` after a subtree was replaced got the old
element back. A function ref is now called with `null` and an object ref has `.value` set to `null`,
which is also the hook an exit animation needs.

The cost had to land only on templates that contain one. `_clear`'s bulk removal is what makes
emptying a 1 000-row table ~5 ms against lit-html's ~22 ms, and walking parts on every removal is
exactly the per-node work it exists to skip — so the scan records whether a template holds a `&` part
and the walk is gated on that. Measured: `clear 1k` unchanged, +86 B gzipped.

A **self-applying** value (`_$apply$`, which is how `@verajs/renderer/spread` ships) is deliberately
not released: it receives the part and owns its own lifecycle, so writing through it here would be a
second protocol contradicting the first.

**Light-DOM styles hoist once per class however many copies of `@verajs/styles` are loaded.** A
production `.min.js` inlines its dependencies, so two copies on a page each had their own
"already hoisted" set and neither saw the other's: the same rules reached the document twice and the
browser parsed and applied them twice for the life of the page. The mark now lives on the component
class — the one object both copies can see — under a name exempt from property mangling. +20 B.
