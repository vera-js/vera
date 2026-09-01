# @verajs/core

## 0.2.1

### Patch Changes

- fce7683: Fix `ref()` and `shallowRef()` returning a union that made `.value` unusable.
  
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

## 0.2.0

### Minor Changes

- a6a6509: **Breaking:** `static styles` adoption has moved out of core into the new `@verajs/styles` package,
  and `adoptStyles` is no longer exported from `@verajs/core`. Wire it once at your app entry:
  
  ```js
  import { insert } from '@verajs/core';
  import { adoptStyles } from '@verajs/styles';
  insert('init', adoptStyles, 50);
  ```
  
  A component declaring `static styles` with nothing adopting them now warns once in development,
  naming the three lines to add. Production is unaffected — the warning is behind `__DEV__`.
  
  Core drops from 3 101 B to 2 801 B gzipped, and a working app (core + renderer) from 6 091 B to
  5 759 B — below Lit and Preact + signals again. Apps that use `static styles` add `@verajs/styles`
  (520 B) back; apps that do not simply stop paying for it.
  
  `@verajs/inserts` gains a fifth extension point, `'init'`, which core dispatches once per element
  after its shadow root exists and before its first render. That is the seam the extraction needed,
  and it is available to any module that wants to see every component as it comes to life.
- 3160255: **Breaking:** core no longer ships a default renderer. `@verajs/core` on its own cannot render;
  wire one once at your app entry:
  
  ```js
  import { setRenderer } from '@verajs/core';
  import { render as renderer } from '@verajs/renderer';
  setRenderer(renderer);
  ```
  
  `render()` with no renderer registered now warns once in development, naming those exact lines.
  Production carries no warning — it is behind `__DEV__`.
  
  The default renderer existed so core alone would render *something* without a renderer module. It
  did not deliver that: it serialized to a string and assigned `innerHTML`, so `@event`, `.prop` and
  `?bool` bindings ended up in the DOM as literal attributes. Both README quick-starts relied on it
  and both were broken — they rendered `<button @click="">Clicked 0 times</button>` and clicking did
  nothing. Both are fixed and verified in this release.
  
  Core drops from 2 801 B to 2 577 B gzipped, and a working app from 5 759 B to 5 588 B.
  
  `defaultRenderer` is no longer exported. If you were using it deliberately, the closest equivalent
  is `@verajs/renderer`, which is what every documented path already used.

### Patch Changes

- cbf56b2: Correct the published size figures and generate them from the build instead of maintaining them by
  hand. Every `~N KB gzip` claim in a package README is now produced by `scripts/sync-size-claims.mjs`
  from the actual `dist` bundle, and CI fails if any of them drifts.
- Updated dependencies [a6a6509]
- Updated dependencies [cbf56b2]
  - @verajs/inserts@0.1.3

## 0.1.2

### Patch Changes

- Fix a renderer crash, and ship the license text.
  
  **Renderer.** `ChildPart._clear()` could walk off the end of the child list and throw
  `Cannot read properties of null (reading 'nextSibling')`, aborting the render pass and leaving a
  half-updated DOM. `TextPart` upgrades to a `ChildPart` on its first non-primitive value, and it
  borrowed `this._text.nextSibling` as its exclusive end — a node owned by the *next* part, which
  that part removes when it upgrades and clears its own text. The upgrade now inserts its own end
  marker, so a part owns both anchors and `_end === null` means only "root part", which makes the
  `textContent = ''` fast path sound. The removal loop also stops at the end of the child list
  rather than throwing, so a broken invariant degrades into a missed removal.
  
  Triggered by several sibling child-expressions in one parent each toggling between a template and
  `''` — a shape any conditional-heavy template can reach. Costs 19 bytes gzipped and nothing
  measurable in the DOM benchmarks. Covered by `tests/renderer-sibling-parts.test.mjs`.
  
  **Licensing.** Every package now ships the MIT `LICENSE` text rather than only declaring `"MIT"`
  in its manifest, and `author` names a person.
- Updated dependencies
  - @verajs/inserts@0.1.2

## 0.1.1

### Patch Changes

- 5228f8d: Pin the canonical `git+https://` form of `repository.url`.
  
  npm normalizes this field on publish, and the registry compares the normalized
  value against the provenance statement's source repository — a mismatch is
  rejected with a 422. Carrying the normalized form in the manifest removes the
  dependency on auto-correction.
  
  This is also the first release published from GitHub Actions via npm Trusted
  Publishing, so these are the first `@verajs` tarballs to carry a provenance
  attestation.
- Updated dependencies [5228f8d]
  - @verajs/inserts@0.1.1
