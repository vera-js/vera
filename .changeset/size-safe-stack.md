---
'@verajs/core': patch
'@verajs/renderer': patch
---

The size audit's no-decision tier: −96 B gzipped on the counter app, nothing changes behaviour

Four levers, every one measured A-B-A on `bench/size.mjs`'s counter (6,197 → 6,101 B gzipped;
the keyed list moves 6,672 → 6,573):

- Terser is told what it is emitting — `ecma: 2020`, `module: true`, `pure_getters: true` — and
  keeps `@__PURE__` annotations in the min bundles so a consumer's bundler can tree-shake the
  module-scope calls that build core's `svg` and `mathml` tags, which every app carried whether it
  used them or not.
- Core opts into the property mangling the renderer has always had, with every cross-boundary name
  reserved by lookahead: `_p`, `_isSignal`/`_ignore`/`_delete`, `_root` (read by `@verajs/styles`),
  `_hooks` (the prod suite reads it — tests are a boundary, and `tests/minification-contracts`
  says so), and the `_$…$` family.
- `__HYDRATING__` folds per entry, exactly as `__DEV__` folds per mode: the three adoption
  branches in `AttrPart._commit` are reachable only from the hydrate entry, so the base bundle
  stops shipping them as dead code.
- The element-ref failure report keeps its full sentence in development and the `[vera]` prefix
  plus the error object in production.

Two candidates from the same audit were rejected by the suite's own recorded contracts and are
kept as-is: `init` and `createStore` name themselves in production (`tests/core-lifecycle`
asserts both messages there).
