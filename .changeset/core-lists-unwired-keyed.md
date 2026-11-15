---
'@verajs/core': patch
---

A keyed list over a store array no longer prints the `lists-unwired` development warning

The warning tells you that a store array's `.map` of templates is matched by position, and suggests wiring `lists` or
using `keyed()`. It also fired when every row already used `keyed()`, including the JSX `key={id}` form, which compiles
to `keyed()`, so it advised the fix you had already applied. Keyed rows are matched by key, so they no longer warn.
Rendering was always correct; this changes the development warning only, and production is byte-for-byte unchanged.
