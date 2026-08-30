---
'@verajs/inserts': patch
---

`@verajs/inserts` documents seven extension points instead of five.

`'collection'` and `'value'` were both declared in `InsertFunctionMap` and absent from the README —
from the table that lists the points and from the section that says what happens when one throws. The
first is the point `@verajs/reactivity/collections` ships to implement; the second is the documented
way to claim a child-position value of a type you do not own. An author of either had no description
of the signature and no answer to "what happens if mine throws".

Both are now in the table with their signatures, and both are in the throws section — they behave as
that section's own reasoning predicts, surfacing at the mutation or the render that invoked them,
which is now asserted rather than described.

The table also now says which values reach a `'value'` insert: strings, numbers, `null` and
`undefined` take a fast path and never do, so it cannot be used to intercept text. That is not
obvious from the signature and is the first thing an author would try.

`tests/insert-failure-contract.test.mjs` reads the declared points out of the type and requires each
one to appear in the README's table, so adding a point and forgetting the documentation now fails.
