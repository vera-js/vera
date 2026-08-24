---
'@verajs/ssr': patch
---

The server element behaves like an element.

`toggleAttribute`, `append`, `replaceChildren`, `attributes`, `getAttributeNames`, `dataset` and
`style` were all absent, so ordinary component code — `this.toggleAttribute('open')`,
`this.dataset.userId = id`, `this.style.color = c`, `this.append(node)` — either threw or silently
did nothing. `dataset` and `style` are views over an attribute, so an assignment that does not reach
the markup is one the server loses; both write through.

`tests/ssr-dom-surface.test.mjs` pins the whole surface as a matrix — 50 members, each asserted to
work rather than merely exist — so the next gap fails there instead of being found by probing.
`insertBefore` and `cloneNode` stay absent on purpose: they need a real tree, and faking them would
misplace content silently.
