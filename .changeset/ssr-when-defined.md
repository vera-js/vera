---
'@verajs/ssr': patch
---

`customElements.whenDefined` on the server resolves with the class, when the class is defined

On the server, `customElements.whenDefined(name)` resolved at once with `undefined` for any name. Code awaiting a
definition ran before the class existed and received nothing; the wait for a component that is only ever defined in
the browser settled on the server and never in the browser; and a name `define` refuses resolved anyway. It now
behaves as in a browser: it resolves with the constructor, immediately for a defined name and at its `define` for a
later one, returns one promise per name until then, and rejects with a `SyntaxError` for an invalid name.

A wait for a tag the server never defines (one that is lazily loaded, client-only, or simply not registered on the
server) therefore no longer resolves on the server either: `renderToStringAsync` ends it at its `timeout` and the
warning names the tag and the component waiting on it, with the fix: return before the wait on the server
(`if (globalThis.__veraSsrShimmed) return;`), which serves the component's state from before the wait, exactly what the
browser shows first, at once and without a warning.
