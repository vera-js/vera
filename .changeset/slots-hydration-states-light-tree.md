---
'@verajs/renderer': minor
'@verajs/ssr': minor
---

Light-DOM slots: the server states the light tree, and hydration reads it instead of inferring it

**Breaking for server-rendered HTML cached from an earlier version.** `@verajs/ssr` now distributes
light-DOM slots itself, while `@verajs/renderer/slots` is wired. Each filled slot's content sits
between the same two comments the client keeps around a filled slot (`<!--[-->` … `<!--]-->`), and
every light host carries `data-vm-light`: a format number, then which of those ranges each light
child went into, in light order. A hydrating page reads them through a new opt-in module,
`@verajs/renderer/hydrate-slots` — `wire([renderer, hydration, slots, hydrateSlots])` — which only an
app that hydrates light slots loads. Without it, a server-rendered slots host is left exactly as
served and a coded error (`hydration-slots`) names what to wire. Render and hydrate with matching
releases: a page in another format renders fresh, its content kept, and the warning says so; a
component host without `data-vm-light` is treated as made on the client. Serve the server's HTML
unmodified, comments included — stripped markers mean the host renders fresh.

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
  Measured before the fix: with hydration wired app-wide, a light component that a
  client template or the user created with children lost all of them on its first render (the
  render tried to adopt them as server output, failed and discarded them). A component host without
  `data-vm-light` now gets a client first render, and a fallback warning no longer fires for it.
