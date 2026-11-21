---
'@verajs/ssr': patch
---

A server process with web storage is told so once, in every build (`ssr-process-storage`): Node 26 gives every process
a `sessionStorage` shared by all its requests, and `--localstorage-file` adds a `localStorage`, and components render
against the process's own globals, so a `typeof` storage test passes on the server. The warning, the README and the
two diagnostics that named `globalThis.__veraSsrShimmed` now point to `isServer` from `@verajs/core`, which reads a
flag this version sets (`__veraSsrShimmed` is still set, for code that tests it). The DOM-surface check no longer
counts globals the runtime brings itself (Node 26's `Temporal` and `sessionStorage`) as this DOM's.
