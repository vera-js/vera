---
'@verajs/core': patch
---

A re-attached component's effect cleanups run once, and setting up only once is named in development

A component's `connectedCallback` runs again every time it is put back in the page, and `init()`
there is what gives it current markup and live effects again. A component that set up only once
(`if (this.started) return`) had its effects torn down as soon as they ran after a re-attach, with
nothing said: development now names the element and says to call `init()` on every connection. And
an effect's last cleanup, already run when the element left the page, is no longer run a second
time on its next pass — harmless for a listener, wrong for a socket, a lock or a count. The core
README states the pattern: set up on every connection, keep state on the element or in a store.

`shallowRef()`'s return type is `{ value: T }`; the store's internal `_ignore` flag no longer shows in
autocomplete on every `shallowRef`.
