---
'@verajs/renderer': patch
---

The hydrate entry's `renderer` wirable now binds the hydrating render

`@verajs/renderer/hydrate` re-exported the base entry's `renderer` descriptor verbatim, whose
`fn` is the base, non-adopting `renderInto` — so the natural
`import { renderer } from '@verajs/renderer/hydrate'; wire([renderer])` wired a renderer that
never hydrated. The failure was silent by construction: a first render into a full container
clears it and renders fresh, so the page looked right while every byte of the server's work was
discarded. It survived because the docs taught the manual
`wire({ on: 'render', fn: renderInto, priority: 50 })` form for hydration, so nothing exercised
the descriptor path.

The entry now exports its own `renderer`, `fn` bound to the adopting render (the rest of the
descriptor is shared deliberately — `connect` operates on this bundle's copy of the renderer
state, which both functions read), and its raw `renderInto` carries the same development-time
wire-misuse guard as the base entry's. The header's promise — point the importmap at the hydrate
bundle "and nothing else changes" — is true for `wire([renderer])` now.

The docs and examples stop teaching the hand-built descriptor for our own renderer:
`wire([renderer])` is the one wiring in every entry, and the kitchen sink's hydrating mode now
goes through the descriptor, so the browser suite exercises this path for real. The manual form
remains documented where it is the point — wiring a third-party renderer such as lit-html.
