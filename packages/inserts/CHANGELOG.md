# @verajs/inserts

## 0.2.0

### Minor Changes

- b7adb81: `setAutoloader` and `connectInserts` are gone; one way to install a module
  
  Every module now hands `wire` a descriptor, and the registry package no longer knows about any
  particular consumer.
  
  **`setAutoloader(fn)` → `wire(instance)`, and `initAutoloader` is now `autoloader`.** The instance is
  also its own descriptor, so configuring and installing are one call, and the name matches every
  other module you hand `wire`:
  
  ```js
  - import { setAutoloader } from '@verajs/core';
  - import { initAutoloader } from '@verajs/autoloader';
  - setAutoloader(initAutoloader(import.meta.url, 'components'));
  + import { wire } from '@verajs/core';
  + import { autoloader } from '@verajs/autoloader';
  + wire([renderer, router, autoloader(import.meta.url, 'components')]);
  ```
  
  `wire` now tests for a descriptor — anything naming an insert point — *before* the connector case, so
  a module can be both a function and a descriptor. Without that order such a module is called as a
  connector and silently never registers.
  
  **`connectRouter` is now `router`.** `wire` is the verb, so what you hand it is named for the thing,
  not the act — and whether a given module is a descriptor or a connector is an implementation detail
  an app should not have to read off a name:
  
  ```js
  - wire([connectRouter]);
  + wire([renderer, router, collections, autoloader(import.meta.url, 'components')]);
  ```
  
  **`domRender` is now `renderer`**, in `@verajs/renderer` and `@verajs/renderer/hydrate` alike — so
  swapping to hydration really is swapping one import. `render` is still exported for direct use, and
  because the two names are close, wiring the wrong one now **throws in development** naming the one
  you meant. It used to be silent: a bare function has no `on`, so `wire` read it as a connector,
  handed it the registry and registered nothing.
  
  **`connectInserts` is removed.** It replayed one registry's chains into another; nothing needs that
  now that every module takes the registry it writes to (`router` for the router, `wire` from
  core for everything else). Two copies of `@verajs/inserts` in one page is a mistake with no repair
  function, rather than a supported arrangement.
  
  **`@verajs/eslint-config` restricts `wire`, not `insert`.** The rule named an import that stopped
  existing at the 0.2.0 rename, so the production-silent registry mistake it exists to catch had been
  unguarded since.

### Patch Changes

- 1e89906: Audit fixes: falsy guards, write suppression, and a 13% faster read path
  
  Three correctness defects in core, all the same shape — a legal falsy value tested for truth:
  
  - **`css` dropped a zero.** `margin: ${0}px` produced `margin: px` and `z-index: ${0}` produced
    `z-index: `, declarations the parser discards, so a rule silently lost a property. Every zero out
    of a computed layout hit it.
  - **Hook priority `0` registered nothing.** Lower runs earlier, so zero is the earliest priority
    there is and the obvious choice for a hook that must run first — and it was the one value that did
    not work. Now the same finite-number rule `wire` uses, which also catches `NaN`.
  - **`defineProperty` suppression was process-wide.** Any write in flight suppressed every definition
    anywhere, so a setter that defined a property — on another key, or another store — notified nobody.
  
  Two more found by probing stores over unusual targets:
  
  - **`createStore(Object.freeze(config))` threw**, and under it a proxy-invariant violation: reading
    any nested object out of a frozen store threw a `TypeError` from the engine.
  - **`createStore(x)` twice returned two proxies**, so the same nested object read through each was
    two different values.
  
  **Reads are 13% faster.** The `'proxy-handler'` chain was resolved from a `Map` on every property
  read of every store; it is now cached against a registry revision. Measured on
  `bench/reactivity.mjs`: a tracked flat read 150 → 131 ns/op, two hops 478 → 442.
  
  Development-only diagnostics, all free in production: a string in tag position is refused rather
  than rendered as escaped punctuation; an un-hoisted `_$child$` applier is named; a self-feeding
  `useSyncEffect` is stopped at depth 50; and the missing-`@verajs/store/collections` error is raised once
  per page rather than once per read, and from a `size` read as well as a method read.
- 4ad3d73: `init(element, { mode: 'closed' })` works.
  
  `init` called `attachShadow` and discarded what it returned, and everything downstream read
  `element.shadowRoot` — which is `null` for a closed root, by definition. So a closed component
  rendered its content into the **light DOM**, never adopted its styles, and left an empty unreachable
  shadow root behind. Measured with no SSR involved: `mode: 'closed'` put `<p>content</p>` in the light
  DOM while `mode: 'open'` put it in the shadow root.
  
  The root is kept on the element as `_root` — a cross-boundary contract like `_hooks`, read by the
  `'render'` insert and by `@verajs/styles`, and never mangled. A second `init` on a closed element is
  guarded, which `shadowRoot` alone could not do.
  
  `tests/browser/shadow-modes.test.js` covers every mode as a matrix rather than testing the one bug:
  content lands in the root, styles adopt into it and actually apply, and nothing leaks to the light
  DOM. Light DOM is asserted to create no root at all.
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
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- 5a28ddf: `@verajs/inserts` documents seven extension points instead of five.
  
  `'collection'` and `'value'` were both declared in `InsertFunctionMap` and absent from the README —
  from the table that lists the points and from the section that says what happens when one throws. The
  first is the point `@verajs/store/collections` ships to implement; the second is the documented
  way to claim a child-position value of a type you do not own. An author of either had no description
  of the signature and no answer to "what happens if mine throws".
  
  Both are now in the table with their signatures, and both are in the throws section — they behave as
  that section's own reasoning predicts, surfacing at the mutation or the render that invoked them,
  which is now asserted rather than described.
  
  The table also now says which values reach a `'value'` insert: strings, numbers, `null` and
  `undefined` take a fast path and never do, so it cannot be used to intercept text. That is not
  obvious from the signature and is the first thing an author would try.
  
  `tests/insert-failure-contract.test.mjs` reads the declared points out of the type and requires each
  one to appear in the README's table, so adding a point and forgetting the documentation now fails.
- cc7a3f0: Documentation. Core's README was eleven lines for the package everything else is built on; it is now
  a full one, with a runnable recipe, tables for state, effects, rendering and extension, and the two
  mistakes that actually bite — undeclared TypeScript class fields, and swapping subtrees where a
  stable shape would do. It also no longer claims to have no dependencies while depending on
  `@verajs/inserts`.
  
  `@verajs/inserts` gains the part that was missing: what an extension *is*, with the four shipped
  ones named as examples of the same five points and the same public function you have.
- e3a0a4d: `static styles = [base, isDark && darkSheet]` no longer crashes the component.
  
  That idiom produces `[sheet, false]`, and it broke both of `applyStyles`' paths, differently, and
  neither of them legibly. In the shadow DOM `escapeStyleText(false)` threw `value.replace is not a
  function` out of `connectedCallback`, from a file the author has never opened, taking the component
  with it. In the light DOM nothing threw at all: `false.cssText` is `undefined`, so the literal text
  `undefined` was joined into the stylesheet and hoisted to the document. A ternary yielding `null`
  threw a third message one step earlier.
  
  A falsy entry now means "no styles here", which is what the top of `applyStyles` already reads a
  falsy `styles` argument to mean — the same rule applied to the members of an array. CSS that is
  genuinely not CSS is refused by name in development, as `adoptStyles` and the element argument
  already were.
  
  Separately, `wire` no longer warns that "the second replaced the first" when the second **is** the
  first. An app whose entry points share a wiring module wires `styles` from each of them; the callback
  was identical, nothing was replaced, and the advice it gave — use different priorities — would have
  made it run twice. It fired in this repo's own kitchen-sink example, which is the reference
  application, and a warning the reference app trips on is one people learn to scroll past. Two
  *different* modules claiming one priority still warn, which is the failure it exists for.

## 0.1.3

### Patch Changes

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
- cbf56b2: Correct the published size figures and generate them from the build instead of maintaining them by
  hand. Every `~N KB gzip` claim in a package README is now produced by `scripts/sync-size-claims.mjs`
  from the actual `dist` bundle, and CI fails if any of them drifts.

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
