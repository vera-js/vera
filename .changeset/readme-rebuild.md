---
'@verajs/core': patch
'@verajs/inserts': patch
---

Documentation. Core's README was eleven lines for the package everything else is built on; it is now
a full one, with a runnable recipe, tables for state, effects, rendering and extension, and the two
mistakes that actually bite — undeclared TypeScript class fields, and swapping subtrees where a
stable shape would do. It also no longer claims to have no dependencies while depending on
`@verajs/inserts`.

`@verajs/inserts` gains the part that was missing: what an extension *is*, with the four shipped
ones named as examples of the same five points and the same public function you have.
