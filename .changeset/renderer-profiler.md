---
'@verajs/renderer': patch
---

Add `@verajs/renderer/profiler`, a development-only render profiler. It counts templates committed
in place against templates that replaced a *different* template — which destroys and rebuilds the
subtree while looking identical from the outside — and names the template pairs that churn, where
they are, and how often. `formatReport()` prints a summary; `showProfiler()` mounts a live panel
in the corner of the page for feedback while clicking through the app.

Production is unaffected: the instrumentation sits behind a `__DEV__` constant the build folds
away, and `vera-renderer.min.js` is byte-identical with and without it.
