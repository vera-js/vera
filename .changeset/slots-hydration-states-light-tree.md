---
'@verajs/renderer': minor
---

Light-DOM slots: the server states the light tree, and hydration reads it instead of inferring it

**Breaking for server-rendered HTML cached from an earlier version.** `@verajs/renderer/slots` now
writes `data-vm-slotted="offset,count"` on the parent of every slot that received content (named
slots too, where before only the default slot's parent was marked) and `data-vm-light` on every
light host it renders, listing which of those ranges each light child went into, in light order.
Hydration reads both and strips them. Render and hydrate with the same version: markup from before
this change carries no `data-vm-light`, and a component host without it is treated as made on the
client.

What it fixes, measured by a new suite that hydrates real server output and compares it step by
step, with element identity, against the same component rendered on the client
(`tests/hydrate-slots-conformance.test.mjs`, eight scenarios, each asserted to have adopted rather
than fallen back):

- **A light component nested in another's template now hydrates.** The outer template adopts what
  it placed in the inner one from the inner host's stated light list. Before, it could not find that
  content in the inner host's server markup, fell back, and the inner component showed its fallback.
- **A fallback keeps every light child.** The host owns its light list from the moment hydration
  begins, so a mismatch returns the whole list to its slots, unnamed nodes and bare text included.
  Before, a mismatch before the first slot could lose what the marks did not cover.
- **A light component created on the client keeps its children under a hydrating renderer.**
  Measured before the fix: with `@verajs/renderer/hydrate` wired app-wide, a light component that a
  client template or the user created with children lost all of them on its first render (the
  render tried to adopt them as server output, failed and discarded them). A component host without
  `data-vm-light` now gets a client first render, and a fallback warning no longer fires for it.
