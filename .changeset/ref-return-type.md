---
'@verajs/core': patch
---

Fix `ref()` and `shallowRef()` returning a union that made `.value` unusable.

`ref<T>()` declared `{ value: T } | { value: { value: T } }`, so `.value` typed as
`T | { value: T }` at every call site. Neither `count.value++` nor `count.value = 1` compiled —
`ref` was effectively unusable from TypeScript, which no test caught because the `.mjs` suites run
against built JavaScript and never see the `.d.ts` layer.

The union originates in `createHandler`, typed `ProxyHandler<T | { value: T }>` to cover the wrap
`createProxy` performs for a non-proxyable target. `new Proxy(target, handler)` infers its type
parameter from the handler as well as the target, so the union propagated out as `createProxy`'s
return type. `createStore` never showed it only because it already casts (`as Store<T>`); `ref`
did not. Both `ref` and `shallowRef` now cast the same way — provably sound, since an object
literal is always proxyable and the wrapping branch is unreachable for them.

Types only. The emitted JavaScript is byte-identical, so no runtime behaviour and no bundle size
changes.

Guarded by `tests/types/public-api.ts`, a type-level suite that fails `tsc` rather than running,
now covered by `npm run typecheck`.
