---
'@verajs/ssr': patch
'@verajs/autoloader': patch
---

Two failures that only appear when a real app's wiring meets the server.

**A displaced server renderer is reported instead of rendering everything empty.** `setRenderer`
registers on `'render'` at priority 50, and registering at a taken priority replaces — so an app
entry doing the ordinary thing, `setRenderer(renderer)`, displaced the server renderer the moment
that module was imported server-side. Every component then rendered as
`<my-el><template shadowrootmode="open"></template></my-el>`: empty, with no error and nothing in the
output to suggest why. `renderToString` now checks its renderer is still in the chain and says what
happened.

**`autoloader` is importable in Node again.** It built its `MutationObserver` in the constructor,
so an app entry that wires the autoloader threw `MutationObserver is not defined` under SSR and could
not be imported server-side at all. The observer is created on first use, which is how
`@verajs/router` has always handled its window listeners.
