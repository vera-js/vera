---
'@verajs/core': patch
'@verajs/renderer': patch
---

The framework now survives your callbacks throwing, instead of quietly stopping.

**A cleanup that threw killed its effect for the life of the component.** `invoke` opened with a
bare `cleanup?.()`, so the throw took the whole call with it: the effect body never ran, `cleanup`
was never replaced, and the next pass called the same throwing function again. Every later write
reported the same error and changed nothing. `swapCleanup` already guarded exactly this on the
disconnect path, so the gap was the path a component spends its whole life on.

**A cleanup could run twice.** `cleanup = next` was the last statement, so an effect body that threw
left `cleanup` holding the previous pass's teardown — which had already run a line earlier. Invisible
for a teardown that removes a listener; not for one that releases a lock or closes a socket, and it
only happens while something else is already going wrong.

**A ref callback that threw emptied the component and it never rendered again.** A ref runs in the
middle of committing a template's parts, so the throw unwound the render and left the commit half
applied: the shadow root ended up empty and stayed that way. The error was reported, so the only
symptom was a component that had silently stopped existing. It is now named as a ref and the render
continues without it — the same judgement `handleEvent` already makes for a handler that cannot
listen.

Found by making user code throw at every point the framework calls it, and checking not just that
the throw was reported but that the framework was still usable afterwards.
