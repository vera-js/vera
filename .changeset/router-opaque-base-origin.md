---
'@verajs/router': patch
---

Refuse a protocol-relative `navigate()` target when the document's base cannot resolve an origin.

`navigate()` resolves every string against `window.location.href` and refuses one that names another
origin. When the parser throws it falls back to the raw path, on the reasoning that "an absolute path
is already the form the matcher wants" — true of `/a`, and not true of `//evil.test/x`, which is a
host rather than a path.

An opaque base — `about:blank`, `about:srcdoc`, a sandboxed iframe, a freshly `window.open`ed window —
makes the parser throw for every *relative* form, while an absolute URL parses fine and is checked
normally. So the one shape that names another origin without being absolute was the one shape that
reached `pushState` unchecked, where the browser refuses it with the uncaught `SecurityError` that
block exists to prevent. The open-redirect payload still took the page down, in exactly the context
the fallback carved out.

Same-origin protocol-relative targets are unaffected: `//your.host/path` on your own host routes
exactly as the absolute form does, and that half is now pinned by a test too.
