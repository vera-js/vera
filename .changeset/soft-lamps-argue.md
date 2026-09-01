---
'@verajs/renderer': patch
---

Refuse a props bag that is not a plain object in **both** builds, not only in development.

`spread`'s refusal sat inside `if (__DEV__)` alongside its warning, so the two builds behaved
differently for the same code — and in the direction that hides the bug. Measured: `spread('text')`
applies nothing in development, so an app under test looks correct; in production the string is
iterated by character index and the element ends up with attributes named `0`, `1`, `2` and `3`.

The message stays development-only, which is what `__DEV__` is for. The guard does not: a branch that
changes what the program does cannot be dev-only, or the development build stops being a faithful
model of the production one.

Costs 27 B gzipped on `@verajs/renderer/spread` (842 → 869, measured A-B-A).
