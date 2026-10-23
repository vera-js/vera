---
'@verajs/core': patch
---

`persist: seconds`, and an async setup is never run twice for one element

A removed component can now be kept for a while: with `persist: seconds` (an `init` and `define` option), removal
PAUSES it — every effect's cleanup runs, its state and DOM are kept — and re-adding it within that many seconds resumes
it (every hook runs once, so a change it missed is drawn; its setup does not run again). Past the window it is torn
down. The default, 0, keeps today's behavior.

The same pause fixes a bug: a component removed and re-added while its **async setup** was still awaiting started a
SECOND setup, and an effect the first one registered after its `await` then ran twice on every change. Now, removed
while pending, a component waits up to 5 s: re-added in time, the in-flight setup carries on (one setup, one fetch);
still out, it is torn down — and development says so.
