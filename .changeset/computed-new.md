---
'@verajs/computed': minor
---

New package: memoised derived values.

```js
const total = computed(() => cart.items.reduce((n, i) => n + i.price, 0));
```

`() => a + b` runs on every read. `computed(() => a + b)` runs once per **change**, and only when
something it actually read moves — reading it a hundred times in one render costs one evaluation,
and an unrelated store write costs none. That is the whole reason the primitive exists, and it was
the one property the "computed is a ten-line insert" recipe never had: that one re-invokes the
function on every read.

It is a store, so reading `.value` subscribes — a component re-renders when a computed it reads
changes, and computeds chain. The shape matches `ref()` deliberately. It derives through anything a
store tracks, including nested objects, arrays, `Map`, `Set`, `WeakMap` and `WeakSet`, and an
evaluation that throws reaches the `'error'` insert rather than escaping.

233 B, and `@verajs/core` grew two bytes for it. Unlike the other modules this one keeps
`@verajs/core` external in every build rather than inlining it: it is built *on* core, and a
standalone copy would hand a CDN page a second core, a second insert registry and a second store
identity.
