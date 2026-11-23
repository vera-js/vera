---
'@verajs/core': patch
---

Three scheduler and store fixes:

- An `'error'` handler that rethrows no longer strands the hooks queued behind the failing one: they are queued again
  and a flush is asked for, so they run (before, no later write could queue them, and a hook on an unrelated signal
  never ran again).
- `setRenderScheduler` called from inside a flush with a scheduler that runs at once no longer stops rendering for good.
- `Object.defineProperty` on a store array tells `length`'s readers when it moves `length`, and a shorter `length`
  tells the readers of the indices it drops, as an assignment does.
