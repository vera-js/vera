---
'@verajs/core': patch
'@verajs/inserts': patch
---

Hooks run in exact priority order, and a non-finite priority is refused the same way in both builds — development says why

**Fixes:** hooks were ordered by one number, `priority × 1e9 + a page-wide creation count`. Close fractional priorities
could run in the wrong order (`50.000001` after `50.000002` once enough hooks were created between them), priorities
above about 9 million collided, and on a page that had created a billion hooks a priority-50 hook was read as 51 — it
ran after priority-51 hooks and a property arriving late no longer re-rendered it. Priority and creation order are now
compared separately: any finite priority runs in exact order, then creation order within it.

**A priority that is not a finite number** (`NaN` — what `parseInt` of a missing config value gives — `Infinity`,
`-Infinity`): `useHook` and `createHook` register nothing and return `undefined`, in both builds, as before; development
now also prints `[vera] … (priority-not-finite)` naming the call, where it used to say nothing. `wire` follows the same
rule: it used to throw in development only and, in production, wire the entry and misbehave; it now refuses in both
builds — nothing is wired — and development prints `(wire-priority)`. **In production the refusal is SILENT** (no
message is shipped): an effect with a bad priority simply never runs, so check development's console.
