---
'@verajs/core': patch
---

A render subscribes to what its template reads, not to what committing it runs

A component's render re-runs when state its template function read changes. Committing that template
runs other code — setting a property on a child element calls the child's accessors, and the renderer
reads a property before setting it — and that code's store reads used to subscribe the PARENT to the
child's state. A child whose getter returns a copy and whose setter writes its own state then
re-scheduled its parent on every pass: a template re-running every frame, forever, on an idle page.
The commit now runs untracked; the template function still subscribes exactly as before.

`shallowRef()`'s return type is `{ value: T }`. The store's internal `_ignore` flag no longer shows in
autocomplete on every `shallowRef`.
