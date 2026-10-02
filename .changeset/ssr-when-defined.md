---
'@verajs/ssr': patch
---

`customElements.whenDefined` on the server resolves with the class, when the class is defined

On the server, `customElements.whenDefined(name)` resolved at once with `undefined` for any name. Code awaiting a
definition ran before the class existed and received nothing; the wait for a component that is only ever defined in
the browser settled on the server and never in the browser; and a name `define` refuses resolved anyway. It now
behaves as in a browser: it resolves with the constructor, immediately for a defined name and at its `define` for a
later one, returns one promise per name until then, and rejects with a `SyntaxError` for an invalid name.
