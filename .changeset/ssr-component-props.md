---
'@verajs/ssr': patch
---

A property bound on a component tag is delivered to its server render, not dropped

The serializer's rule was ".prop → mirrored for form state, else dropped — client concerns", which
left a prop-driven child rendering its empty state server-side and hydration repainting it. Now a
property bound on a REGISTERED component tag — written `.prop`/`!prop` or `props()`/spread — is
delivered by identity to the instance the nested-component scan renders, before its lifecycle,
exactly where `renderToString`'s own `props` option always put the entry component's. The markup
never changes: no property becomes an attribute, `.value` on a component is that component's prop
rather than the form-state mirror, and an unregistered dashed tag passes through untouched for the
client. A getter with no setter is refused by name without failing the render (the client's rule);
a setter that throws stays the component's own error, named against the tag and property. The
shim's `style` now assigns through to `cssText` as the platform's `[PutForwards]` does, and the
hydration fixture carries a component-props page so the server→client handoff is exercised for
real.
