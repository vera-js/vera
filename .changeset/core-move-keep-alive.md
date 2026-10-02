---
'@verajs/core': minor
---

A component moved by one DOM operation is no longer torn down and set up again — and core no longer touches custom elements that are not its own

**Breaking for code that relied on a move re-running setup.** Moving a Vera component (one that ran `init()`) that
is already in the page in ONE operation — `append` or `insertBefore`, which is how a keyed list reorders and how
light-DOM slots place a slotted component — used to run its whole teardown and then its whole setup again:
its effect cleanups, its `disconnectedCallback`, its `connectedCallback`, a second render, and a second fetch if it
fetched in its setup. A Vera component moved by one DOM operation is no longer re-rendered or set up again: neither
callback runs, its effects stay live, and its state is untouched. Core tells a move from a removal the way the platform
lets it — a moved element is still connected when its `disconnectedCallback` runs. A removal (`remove()`, or a hop
through a `DocumentFragment`) tears down exactly as before, synchronously, and a move into another document (a
popped-out window) still tears down and sets up again, since its listeners and frame clock belong to the old window.

**Fixed: core wrote to third-party custom elements.** Core wraps `customElements.define` to run effect cleanups on
removal, and that wrapper sees every class defined after core loads. On every disconnect it set a field of its own on
the element — in production a one-letter name (`t` in 0.3.1) — so a minified third-party component keeping a field of
that name had it overwritten with `true` whenever it left the page. The wrapper now touches only elements `init()` has
run on; any other custom element gets exactly its own callbacks, with nothing read from it or written to it.

The wrapped `connectedCallback` also returns what the component's own returned, so a server render still awaits an
`async connectedCallback`.
