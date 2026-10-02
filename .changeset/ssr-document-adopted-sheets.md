---
'@verajs/ssr': patch
---

Every sheet adopted onto `document.adoptedStyleSheets` on the server is served, and the list reads back

On the server, `document.adoptedStyleSheets` read as an empty array and its setter served only the last sheet it
was given, so `document.adoptedStyleSheets = [a, b]` served `b` and dropped `a`, and code that adopted a sheet could
not see it afterwards. It is now a live list as in a browser: an assignment or a `push` serves each newly adopted
sheet's CSS, a read answers what was adopted during this render (each render starts empty, as a new page does), and
a value that is not an array, or an entry that is not a `CSSStyleSheet`, throws a `TypeError` before anything
changes. `@verajs/styles`, which adopts one sheet at a time, is unaffected.
