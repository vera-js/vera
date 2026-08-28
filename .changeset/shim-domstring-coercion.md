---
'@verajs/ssr': patch
---

Refuse a symbol wherever a DOM string is expected, as every engine does

The shim coerced with `String(value)`, which answers `'Symbol(s)'` for a symbol where the WebIDL
`DOMString` conversion the platform performs throws a `TypeError`. Eleven members were affected —
`setAttribute` (name and value), `getAttribute`, `hasAttribute`, `removeAttribute`,
`toggleAttribute`, `setAttributeNS`, `className`, `id`, `textContent` and `createElement`.

Being the lenient one server-side does not avoid the failure, it relocates it: the server wrote
`class="Symbol(s)"` happily and the client threw on the same assignment during hydration, with
nothing left to say where the value came from. Measured across Chromium, Firefox and WebKit
(`tests/browser/dom-string-coercion.test.js`); all three refuse all eleven.

`insertAdjacentHTML` also reported two different failures as one. A position that is not one of the
four now throws the platform's `SyntaxError` `DOMException`; `beforebegin`/`afterend` still throw
the explanation that a server-rendered component has no parent, which is a real constraint and a
different problem from a typo'd position.

**For a static SSR consumer** this turns silent nonsense into a throw. Code that passed a symbol was
already rendering `Symbol(s)` into the page and already failing on the client; it now fails on the
server, where the stack points at the call.
