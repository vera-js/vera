---
'@verajs/ssr': patch
---

A `URL` or `Set` made in another realm (jsdom's window's `URL`, a `vm` context's `Set`) is accepted as the module URL,
`base`, `location` or `seen`; `instanceof` refused it as the wrong kind of option.
