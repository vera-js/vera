---
'@verajs/reactivity': patch
---

Say that `computed` is eager, because the name promises the opposite everywhere else

**A computed evaluates when it is created and re-evaluates on every dependency change, whether or not
anything reads it.** Vue, Solid and Preact all defer to the read and cache until invalidated; this
does not. Measured: five writes with no reader at all produce six evaluations.

That is a consequence of how invalidation reaches a component rather than an oversight. Reading
`.value` *subscribes*, so a component re-renders when the computed changes — and knowing it changed
means having computed it. A lazy computed could only say "I might have changed", which would re-render
every reader on every dependency write and lose the memoisation the module exists for.

The consequence worth writing down is the cost: **an expensive derivation that nothing currently reads
still runs on every write.** Reads are free and repeated reads are free; holding an unused computed is
not. The README now says so and shows guarding the dependency rather than the read.

Also documented: `.value` keeps serving the **last good value** when an evaluation throws, so a
derivation that fails once does not blank out or take the render down. Both behaviours are now
asserted, including the direction that would break if `computed` ever went lazy.

Documentation and tests only — no behaviour changed.
