# @verajs/store

## 0.1.2

### Patch Changes

- 4bfee3e: Every public export now has a copyable call shape in its README
  
  An export-vs-docs audit over the true public surface (each exports entry's own declarations) found
  exports that were named in prose or tables but never appeared inside a code fence anywhere — a
  reader had no call to copy. `revision` and `inserts` (inserts), `collectionMethod` and `GLOBAL`
  (store, with the real five-argument insert signature and the fact that core calls the chain's
  first entry and caches it), and `adoptStyles`/`applyStyles` (styles) now carry fenced usage
  written against the source.
- Updated dependencies [4bfee3e]
  - @verajs/core@0.3.1

## 0.1.1

### Patch Changes

- 9a53245: A chained `set` or `add` on a store's `Map` or `Set` now notifies for every link, and `forEach` hands
  its callback the store's collection rather than the raw one.
  
  `Map.prototype.set` and `Set.prototype.add` return the collection so they can be chained, and the
  wrapper returned what the underlying method gave it — the **unproxied** collection. So the second and
  third links of `tags.add(1).add(2).add(3)` ran past the proxy: the data was completely correct and
  subscribers were told once.
  
  The case that matters is a chain whose *first* link happens to change nothing — `add` of a value
  already present, `set` of the value already there. Then there is no first notification either,
  nothing else is pending, and the render never happens: the collection holds three items, the page
  shows one, and nothing throws or logs.
  
  `forEach` had the same escape by another door — its callback's third argument was the raw collection,
  so a callback writing through it mutated past the proxy.
  
  `@verajs/store/collections` grows 38 B gzipped, effectively all of it the `forEach` receiver;
  returning the receiver from `set` and `add` is free.
- 2f20123: Reactive `Map`/`Set` moves out of core, to `@verajs/store/collections`
  
  Most stores hold plain objects, and every app was carrying 367 B gzipped for collections it never
  created. An app without a `Map` in a store is now **292 B smaller**; one with a `Map` pays **24 B**
  over having it built in.
  
  ```js
  + import { collections } from '@verajs/store/collections';
  - wire([renderer]);
  + wire([renderer, collections]);
  ```
  
  Forget it and core raises a development error naming the package the first time a collection is read
  from a store — then the call throws, because native collection methods cannot run on a proxy. It
  fails loudly, not silently.
  
  It lands beside `computed` rather than as its own package because the opt-in boundary here is the **entry**, not the package — you download only the subpath you import either way — and a package buys independent versioning these two will never need.
  
  `@verajs/inserts` gains the `'collection'` insert point this rides on. Unlike `'proxy-handler'`,
  which runs on every read of every store, it is **type-keyed**: core dispatches it only when the
  target is already known to be a `Map` or `Set`, and resolves it once per process. That is what makes
  the split affordable — it is the same shape that made `@verajs/map-support` too expensive in its
  first incarnation.
- 8d0161d: Say that `computed` is eager, because the name promises the opposite everywhere else
  
  **A computed evaluates when it is created and re-evaluates on every dependency change, whether or not
  anything reads it.** Vue, Solid and Preact all defer to the read and cache until invalidated; this
  does not. Measured: five writes with no reader at all produce six evaluations.
  
  That is a consequence of how invalidation reaches a component rather than an oversight. Reading
  `.value` *subscribes*, so a component re-renders when the computed changes — and knowing it changed
  means having computed it. A lazy computed could only say "I might have changed", which would re-render
  every reader on every dependency write and lose the memoisation the module exists for.
  
  The consequence worth writing down is the cost: **an expensive derivation that nothing currently reads
  still runs on every write.** Reads are free and repeated reads are free; holding an unused computed is
  not. The README now says so and shows guarding the dependency rather than the read.
  
  Also documented: `.value` keeps serving the **last good value** when an evaluation throws, so a
  derivation that fails once does not blank out or take the render down. Both behaviours are now
  asserted, including the direction that would break if `computed` ever went lazy.
  
  Documentation and tests only — no behaviour changed.
- 181dec6: `computed` refuses a non-function by name
  
  `computed(undefined)` — what a mistyped argument or a missing import produces — was accepted, and
  failed at the first read with `evaluate is not a function`. That names a local variable inside
  `computed.ts` and neither the API that was called wrong nor what to pass instead.
  
  It now says which function was called and shows the shape it wanted:
  `computed(() => a + b)`, not `computed(a + b)`.
  
  `__DEV__`-only, like the other diagnostics here, so production carries neither the check nor the
  message.
  
  Found by a sweep calling every public function in every package with wrong-typed input — 192 calls
  across `@verajs/core` and 68 across both SSR entries named the API correctly, and this was the one
  that did not.
- a56ef5a: Correct three size claims that nothing regenerated
  
  The second audit sweep re-ran the drifted-numbers lens over every prose file, this time filtering out
  figures already inside a `<!--size:…-->` block so only the ungenerated ones remained. Eleven survived,
  and three were wrong.
  
  **The spread protocol contradicted itself.** `llms.txt` said `@verajs/renderer` costs **16 B** for it;
  `packages/renderer/README.md` said **8 B** — for the same protocol, both immediately followed by the
  same generated `spread.gzip` figure, so there was no ambiguity about what was being described.
  Measured by deleting the `_$apply$` branch and rebuilding: **5 B** (3 815 against 3 810). Both were
  wrong, in opposite directions. The figure is now dated and its method recorded, because nothing
  generates it.
  
  **`@verajs/store`'s "you pay 233 B for memoised derivations" is 241 B**, and now carries a
  `<!--size:computed.gzip-->` marker, so it is generated rather than remembered. Verified by corrupting
  it and watching `sync-size-claims --check` fail.
  
  `CLAUDE.md` already says a number nothing generates will be wrong. These are three more of them.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- eb35664: New package: reactivity primitives `@verajs/core` deliberately does not ship.
  
  Ships `@verajs/store/computed` — memoised derived values. `() => a + b` runs on every read;
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
- Updated dependencies [57ab91d]
- Updated dependencies [e6d06e4]
- Updated dependencies [1e89906]
- Updated dependencies [b67cd36]
- Updated dependencies [0db2f4e]
- Updated dependencies [4ad3d73]
- Updated dependencies [2f20123]
- Updated dependencies [54412a4]
- Updated dependencies [0bbabfc]
- Updated dependencies [a5453bd]
- Updated dependencies [053fd5d]
- Updated dependencies [dd76fb8]
- Updated dependencies [afd78b6]
- Updated dependencies [391a20d]
- Updated dependencies [507fdd6]
- Updated dependencies [c926257]
- Updated dependencies [8a792b4]
- Updated dependencies [a7336b5]
- Updated dependencies [c796080]
- Updated dependencies [e7e56f5]
- Updated dependencies [7392f46]
- Updated dependencies [cc7a3f0]
- Updated dependencies [c346153]
- Updated dependencies [98d9ce5]
- Updated dependencies [60cc173]
- Updated dependencies [845d31f]
- Updated dependencies [2cefc25]
- Updated dependencies [eb4e8e2]
- Updated dependencies [d73b937]
- Updated dependencies [fe2891b]
- Updated dependencies [b7adb81]
  - @verajs/core@0.3.0
