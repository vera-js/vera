---
'@verajs/reactivity': patch
---

New package: reactivity primitives `@verajs/core` deliberately does not ship.

Ships `@verajs/reactivity/computed` — memoised derived values. `() => a + b` runs on every read;
`computed(() => a + b)` runs once per **change**, and only when something it actually read moves.
Reading it a hundred times in one render costs one evaluation and an unrelated store write costs
none, which is the whole reason the primitive exists — and the one property the older "computed is a
ten-line insert" recipe never had, because that one re-invokes on every read.

It is a store, so reading `.value` subscribes: a component re-renders when a computed it reads
changes, and computeds chain. The shape matches `ref()` deliberately. It derives through anything a
store tracks, including nested objects, arrays, `Map`, `Set`, `WeakMap` and `WeakSet`, and an
evaluation that throws reaches the `'error'` insert rather than escaping.

One package with one entry per primitive, rather than a package per primitive. Import the root and a
bundler tree-shakes to what you used; point an import map at a subpath and a buildless page
downloads only that. The subpath entries are **additive** — each keeps `@verajs/core` external
rather than inlining it, so loading two still leaves one core, one insert registry and one store
identity. `@verajs/core` grew two bytes for all of this, returning a function `createHook` already
constructed.
