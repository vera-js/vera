---
'@verajs/renderer': minor
'@verajs/jsx': minor
---

`keyed()` moves to `@verajs/renderer/keyed`

Keyed list reconciliation is the largest single algorithm in the renderer and most apps never
reorder a list, so it is now its own entry. An app that does not import `keyed` is **365 B gzipped
smaller**; one that does pays **34 B** over having it built in.

```js
- import { render, keyed } from '@verajs/renderer';
+ import { render } from '@verajs/renderer';
+ import { keyed } from '@verajs/renderer/keyed';
```

Buildless pages need the specifier in their import map. `@verajs/jsx` now injects the new path when
it compiles a `key={}`; pass `keyed: ['keyed', '@verajs/renderer']` to `transformJsx` to keep the
old one.

Nothing registers and there is no `wire()` call: `keyed()` stamps each result with the strategy that
reconciles it, so the algorithm travels with the values that need it and a list always names its own
reconciler. The entry is **additive** — it imports nothing and reaches whatever renderer is present
through mangling-exempt members — so it is safe alongside `/hydrate`, unlike the superset entries.
