---
'@verajs/core': patch
---

`isServer`, a boolean: `true` while `@verajs/ssr` renders, `false` in a browser. Guard per-user state with it
(`if (!isServer) …`) rather than `typeof localStorage` or `typeof sessionStorage`: Node 26 gives every server process
a working `sessionStorage`, shared by all its requests, so a `typeof` test passes on the server and could render one
visitor's stored state into markup served to everyone. It reads a flag `@verajs/ssr` 0.3.3 sets, so it needs that
version or later. 21 bytes gzipped.
