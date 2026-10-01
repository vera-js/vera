---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A bound `javascript:` URL in an SVG animation's `to`, `from`, `by` or `values` is refused

`<animate attributeName="href" to=${url}>` (or `<set>`, or `values=`) writes its value onto the link it
animates, and every major engine runs a `javascript:` URL set that way when the link is clicked. A bound
`href` was already refused; a bound animation value, a spread `{ to }`, and a `values` list carrying the
payload in a later item were written. They are now refused on every element, whatever `attributeName`
says, by the client renderer, `spread` and the server alike — `values` is checked item by item. A
custom element's `.to` property gets the same string check as its `.href`.
