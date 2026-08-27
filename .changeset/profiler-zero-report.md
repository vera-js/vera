---
'@verajs/renderer': patch
---

A profiling session that observed nothing now says why

`@verajs/renderer/profiler` and `@verajs/renderer/hydrate` are both drop-in replacements for the
whole public API, and each bundles its own renderer with its own instrumentation hook. So an app can
have one of them or the other, not both — **a hydrating app cannot be profiled**, and profiling one
observes an instance nothing renders into.

That much is a design consequence. The defect was its silence: a report of all zeros is exactly what a
healthy idle app produces, so the one result that cannot be interpreted was the one being returned.
Measured — a hydrating app driven through three renders reported `0 frames` while the page updated
correctly.

`formatReport` now explains a zero report where the confusion happens, naming the cause and the fact
that `/hydrate` and this entry are mutually exclusive. A real session is untouched. The limitation is
now in the renderer README and the profiler's own header rather than left to be inferred from "each
re-exports the whole public API".

Development-only, like the rest of this entry, which is not built for production at all.
