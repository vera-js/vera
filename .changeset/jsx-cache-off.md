---
'@verajs/jsx': patch
---

`@verajs/jsx/standalone` keeps nothing in `localStorage` on a page that serves
`<meta name="vera-jsx-cache" content="off">`, and compiles on every visit instead. The kept output is storage any
script on the origin can write, and it runs on later visits; the README now says so, and how to turn it off.
