---
'@verajs/renderer': patch
'@verajs/lite': patch
'@verajs/static': patch
---

The client's template scanners read whitespace as HTML does: tab, line feed, form feed, carriage return and space, and
nothing else, as `@verajs/ssr` does. U+000B, U+00A0 and JavaScript's other non-HTML spaces are part of a name or an
unquoted value to a browser. Development now refuses a hole one of them joins to an attribute name
(`name-expression`), as the server does, and the scanners read tag and attribute names where a browser ends them.
