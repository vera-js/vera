---
'@verajs/ssr': patch
---

The server's DOM reads a NUL in a parsed attribute value as U+FFFD, as browsers do, so `getElementById`,
`getAttribute` and the selectors find `<p id="a\0b">` by the id a browser gives it. What the page receives is
unchanged: a parsed element serves the bytes it came from.
