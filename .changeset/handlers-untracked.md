---
'@verajs/renderer': patch
---

A bound event handler never subscribes the hook that happens to be running

An effect that fires an event synchronously (`button.click()`, `input.focus()`, `dispatchEvent`) runs the handler
inside itself, and the handler's reads subscribed that effect — a handler doing `state.count++` re-ran the effect on
every later click, and a handler that read what the effect wrote fed a loop. `@event` bindings and spread's `@event`
key now run their handler untracked. A listener added with `addEventListener` is outside the renderer: read through
`untrack()` there if a hook fires it synchronously.
