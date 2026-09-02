---
'@verajs/autoloader': patch
'@verajs/core': patch
'@verajs/eslint-config': patch
'@verajs/inserts': patch
'@verajs/jsx': patch
'@verajs/reactivity': patch
'@verajs/renderer': patch
'@verajs/router': patch
'@verajs/ssr': patch
'@verajs/styles': patch
'@verajs/tsconfig': patch
---

Every published package declares `engines: node >= 20`

No published package declared an `engines` field at all, so a consumer was told nothing about which
Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
private and never published, so it governed only this repo's own development.

It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
Declaring the one we actually test is a fix rather than a restriction, and it is what lets
`@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
