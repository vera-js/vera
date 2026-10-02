---
'@verajs/ssr': patch
---

On the server DOM, inserting a fragment works through every method, and `toggleAttribute` reports the old value

`appendChild` moved a document fragment's children in and left it empty, as browsers do, but `insertBefore`,
`replaceChild`, and therefore `before()` and `replaceWith()`, inserted a fragment as its markup text: its children never
arrived where they belong and the fragment still held them. Every insertion now goes through one path. Markup that
arrives after an element has been queried is now seen by the next query. `toggleAttribute` told
`attributeChangedCallback` the old value only after removing it, so a removal reported `null`; it now reports the
value the attribute had.
