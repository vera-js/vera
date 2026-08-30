---
'@verajs/renderer': patch
---

`showProfiler()` now replaces its panel instead of stacking a second one.

Two panels are positioned in the same corner, so they overlap and neither reads — but the failure was
not cosmetic. Each panel owns a `setInterval` and each teardown calls `stopProfiling()`, which is
global: closing the second stopped profiling for the first, which kept repainting a frozen report on
its own timer with nothing to indicate it had stopped.

The way a person reaches this is a console — `showProfiler()`, look at it, `showProfiler()` again —
where the first return value is already gone, so that first interval could never be stopped at all.

It replaces rather than returning the existing handle, so a second call's `options` take effect.
