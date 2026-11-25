---
'@verajs/ssr': patch
---

Markup the server DOM parses no longer reads a name `Object.prototype` holds as a character reference: `&constructor;`,
`&valueOf;` or `&toString;` in text or an attribute value read back (and was served from `textContent`) as a function's
source text. They now stay as written, as in every engine.
