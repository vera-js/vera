---
'@verajs/core': patch
'@verajs/renderer': patch
---

A component in a popped-out window or an iframe renders on that window's frames, with that window's elements

**`@verajs/core`:** renders and effects were scheduled on the `requestAnimationFrame` of the window
that loaded VeraJS, so an element moved into another window was redrawn on the opener's clock — one
opener call and none on the iframe's, measured — and would freeze when the opener's tab was hidden.
The default scheduler now uses the element's own window (`element.ownerDocument.defaultView`), with
the global as the fallback. A scheduler passed to `setRenderScheduler` now receives the element as a
second argument, `(run, element)`, so a custom one can do the same; one-argument schedulers are
unaffected.

**`@verajs/renderer`:** every template was imported through the module's `document`, so a custom
element in a template rendered into another window was constructed by the opener's registry, with the
opener's class — whose constructed stylesheets that window cannot adopt. Instances are now imported
into the document they will live in, so they are built by that window's own registry.
