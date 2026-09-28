---
'@verajs/core': patch
---

`shallowRef()`'s public type drops the internal `_ignore` flag, and the README says to set up on every connection

`connectedCallback` runs again every time an element is put back in the page, and `init()` there is
what gives it current markup and live effects again; the core README now says so plainly — set up on
every connection, keep state on the element or in a store.

`shallowRef()`'s return type is `{ value: T }`; the store's internal `_ignore` flag no longer shows in
autocomplete on every `shallowRef`.
