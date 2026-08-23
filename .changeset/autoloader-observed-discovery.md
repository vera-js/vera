---
'@verajs/autoloader': minor
---

Discovery is observed rather than polled, which closes three holes it could not previously reach.

An `autoloader`-marked component is watched once with a `MutationObserver`, so an undefined element
is found **whenever it enters the DOM** — put there by a render, by `innerHTML`, by a third-party
widget, or by having been in the HTML file all along. Creating an autoloader also sweeps the document
once, so a hand-written page works with nothing rendering at all.

Measured as MISSED before, and now found: an element inserted after discovery was set up, a subtree
that arrives whole, and static markup no component ever renders. A rescan can only ever see what a
render put there, so none of them were reachable by tuning it.

**Faster on anything but a small component, and flat instead of linear.** The old model re-scanned a
marked component's entire tree on every render, forever: 0.46 µs at 10 nodes, 3.4 µs at 100, and
32.5 µs at 1 000 (Chromium). Watching costs ~0.6 µs per mutation batch regardless of size. One
observer object watches every marked root, and a mutation only notifies observers on its own
ancestor chain — 1 000 registrations left unrelated DOM work at 0.900 µs against 0.933 µs with none.
Watching `document` instead would have been the expensive shape, taxing every mutation in the app by
~47%.

**One module per tag.** `<x-y>` and `<x-y autoload-dir="alt">` are two URLs for one tag. Both used to
import, and the second module's `customElements.define('x-y')` threw `NotSupportedError` — surfacing
as a failed load for a component that had in fact loaded. The second location is now tried only if
the first attempt fails.

**A failure is reportable.** A failed load dispatches `vera:autoload-error` on the element — bubbling,
composed, `detail: { tag, src, error }` — as well as logging, so an app can render around a component
that is not coming. An event rather than core's `'error'` insert, because this package deliberately
does not depend on core and reaching for `insert` from `@verajs/inserts` would write to a registry
core never reads in a production build.

583 B to 905 B gzipped: 187 B for the observation machinery and the tag fix, 77 B for the document
sweep, 58 B for the error event. The last two are separable features rather than part of the rewrite.
