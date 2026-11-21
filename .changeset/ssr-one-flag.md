---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

The server is marked by one global flag, which `isServer()` and the renderer read. `@verajs/ssr` still also sets the
old `globalThis.__veraSsrShimmed`, because `@verajs/renderer` 0.3.1 and earlier read only that flag. It will stop
setting it once no supported renderer version reads it.
