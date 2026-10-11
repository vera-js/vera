---
'@verajs/core': minor
---

A hook priority that is not a finite number throws (`priority-not-finite`, in every build), and hooks run in exact priority order

**Breaks:** `useHook(fn, priority)` and `createHook({ priority, … })` with `NaN`, `Infinity` or `-Infinity` used to
return `undefined` and register nothing, silently — a priority read from config with `parseInt` left an effect that
never ran, with no message in either build. They now throw, as `wire` already did for the same mistake. Give a finite
number: lower runs first; 25 runs before the render, 50 is the render, 60 `useLayoutEffect`, 75 `useEffect`.
`createHook` still returns `undefined` when there is no callback.

**Fixes:** hooks were ordered by one number, `priority × 1e9 + a page-wide creation count`. Close fractional priorities
could run in the wrong order (`50.000001` after `50.000002` once enough hooks were created between them), priorities
above about 9 million collided, and on a page that had created a billion hooks a priority-50 hook was read as 51 — it
ran after priority-51 hooks and a property arriving late no longer re-rendered it. Priority and creation order are now
compared separately: any finite priority runs in exact order, then creation order within it.
