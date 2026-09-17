# @verajs/autoloader

## 0.2.0

### Minor Changes

- 1e89906: Both packages check a URL where it is built, not only where it is used
  
  **`autoloader.url()` refuses a directory that escapes the base.** `autoload-dir` is an ordinary HTML
  attribute, so on any page whose markup is partly authored elsewhere it is an input, and
  `autoload-dir="//evil.test"` resolves to a different origin. The loader always refused before
  fetching; `url()` did not, and `url()` is public and documented for preloading — so it handed the
  caller the exact fetch this module declines to make. It now throws, and discovery catches the throw,
  reports it once and moves on. A custom `resolve` is covered by the same check.
  
  **`navigate()` checks the origin, as a routed link already does.** `navigate(params.get('next'))` is
  the ordinary way an app honours a `?next=` redirect: a protocol-relative path went straight to
  `pushState`, which the browser refuses with a `SecurityError` nothing caught, so an open-redirect
  payload took the page down instead of being declined. It now returns `false` and warns in
  development. A same-origin absolute URL is normalised to the path form the matcher expects — which
  is what a link already passes, and which used to fall through to the catch-all.
  
  **The router sees the query on initial load and on traversal.** The path was built from
  `pathname + hash`, so `?page=2` and every filter in a bookmarked URL were invisible on a deep link, a
  refresh or a back traversal — and present when you clicked through to the same place.
- 60d7e5a: One function, three shapes, two helpers — and 184 B lighter than the version that had five.
  
  ```js
  const autoload = autoloader(import.meta.url, 'components');
  wire(autoload);                 // watch every component as it renders
  autoload();                     // scan whatever is already on the page
  autoload(widget.shadowRoot);    // watch a root nothing marked
  autoload.url('user-card');      // the URL it would fetch
  autoload.retry(element);        // forget that this element's tag failed
  ```
  
  **`autoload()` replaces the sweep that used to happen by itself.** Creating an autoloader now has no
  side effects at all — no scanning, no `DOMContentLoaded` listener. The implicit version was wrong
  twice over: it fired once, so markup arriving later was never seen and nothing said so, and two
  autoloaders on a page each adopted every marked host and raced to load the same tags from their own
  directories, which needed a `sweep: false` option to switch off. As a shape of a function that
  already existed it costs almost nothing, can be called again whenever new markup lands, and takes
  the option with it.
  
  **`url(tag)` replaces `preload(...tags)`.** Building the URL was all `preload` really did, and having
  it in hand does more than the helper could — `modulepreload`, a lower-priority prefetch, priming a
  service worker, or just printing it to answer "why is it fetching *that*?".
  
  **`retry(element)` replaces `retry(tag)`**, and `vera:autoload-error` now carries `element` so the
  thing you retry is the thing the event hands you. Retrying one element rather than re-scanning every
  watched root also drops the iterable set of roots that the old shape required.
  
  **Observers are never disconnected, and do not need to be.** A removed node observed by a live
  observer is still collectable — measured in Chromium with `--expose-gc` and pinned by
  `tests/browser/memory.test.js`, which guards its own control. jsdom reports the opposite, and reports
  it even after `disconnect()`; that is jsdom's bookkeeping, not the observer contract.
  
  905 B to 1 002 B gzipped for all of it — the API surface went from five public things to three
  while gaining four capabilities.
  
  **The three attributes are watched, not read once.** Marking a component `autoloader` after it
  already has a shadow root now reaches inside it — an observer cannot see through a shadow boundary,
  so the attribute is the only thing that can. Repointing `autoload-dir` after a failed attempt tries
  the new location, and removing `autoload-ignore` lets an element load. None of these needed the
  element to be inserted again before anything noticed, which is not a thing that happens. 56 B of the total above.
- 0bd6016: Discovery is observed rather than polled, which closes three holes it could not previously reach.
  
  An `autoloader`-marked component is watched once with a `MutationObserver`, so an undefined element
  is found **whenever it enters the DOM** — put there by a render, by `innerHTML`, by a third-party
  widget, or by having been in the HTML file all along. Creating an autoloader also sweeps the document
  once, so a hand-written page works with nothing rendering at all.
  
  Measured as MISSED before, and now found: an element inserted after discovery was set up, a subtree
  that arrives whole, and static markup no component ever renders. A rescan can only ever see what a
  render put there, so none of them were reachable by tuning it.
  
  **Faster on anything but a small component, and flat instead of linear.** The old model re-scanned a
  marked component's entire tree on every render, forever: 0.46 µs at 10 nodes, 3.4 µs at 100, and
  32.5 µs at 1 000 (Chromium). Watching costs ~0.6 µs per mutation batch regardless of size. One
  observer object watches every marked root, and a mutation only notifies observers on its own
  ancestor chain — 1 000 registrations left unrelated DOM work at 0.900 µs against 0.933 µs with none.
  Watching `document` instead would have been the expensive shape, taxing every mutation in the app by
  ~47%.
  
  **One module per tag.** `<x-y>` and `<x-y autoload-dir="alt">` are two URLs for one tag. Both used to
  import, and the second module's `customElements.define('x-y')` threw `NotSupportedError` — surfacing
  as a failed load for a component that had in fact loaded. The second location is now tried only if
  the first attempt fails.
  
  **A failure is reportable.** A failed load dispatches `vera:autoload-error` on the element — bubbling,
  composed, `detail: { tag, src, error }` — as well as logging, so an app can render around a component
  that is not coming. An event rather than core's `'error'` insert, because this package deliberately
  does not depend on core and reaching for `insert` from `@verajs/inserts` would write to a registry
  core never reads in a production build.
  
  583 B to 905 B gzipped: 187 B for the observation machinery and the tag fix, 77 B for the document
  sweep, 58 B for the error event. The last two are separable features rather than part of the rewrite.
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

- 2d17591: A broken default, a new extension point, and 29 B off — from a principles audit.
  
  **`componentsDir` is optional and never worked when omitted.** The default was `'/'`, which built
  `'//tag.js'` — a protocol-relative URL, so `new URL` read the tag name as a *host*. Every resolved
  URL then landed outside the entry's directory and was refused. `autoloader(import.meta.url)`,
  the natural call for components sitting beside the entry file, therefore loaded nothing at all, and
  `autoload-dir="/"` did the same. An empty or root-only directory now means the entry's own
  directory, which is the only place a bounded URL can point anyway.
  
  **`resolve(tag, dir)`** replaces URL building for a layout `dir/tag.ext` cannot express —
  `tag/tag.js`, `tag/index.js`, anything. The result is still resolved against the entry file and
  still bounded by it, so a custom layout cannot reach anywhere the default one could not. Principle
  #6 names this module's hard-coded `.js` as the example of the shape to avoid; the path around it was
  the same problem one level out.
  
  **Smaller, at 583 B.** The discovery loop re-checked `localName.includes('-')` and
  `customElements.get(tag)` on every match, which `:not(:defined)` already guarantees — a dashless
  unknown tag is `:defined`, and an element leaves the set the moment its definition lands. Both are
  now pinned in a real engine rather than assumed.
- 88c6619: Report a module that imports cleanly and defines nothing
  
  `await import(src)` then `await customElements.whenDefined(tag)` — and if the module loads but never
  defines *that* tag, `whenDefined` simply never settles. The `catch` never runs, so there is no console
  line, no `vera:autoload-error` event, and the element sits unupgraded for the life of the page. A
  blank space with a clean console.
  
  The everyday cause is a typo: markup says `<my-widget>`, the file defines `my-wdiget`. It is now
  reported through both channels, with a message naming the likely cause.
  
  A dynamic `import()` resolves only after the module has fully evaluated, top-level `await` included,
  so by that point every `customElements.define` the module was going to run has run. Two microtask
  turns are drained first anyway, covering a define deferred by a resolved promise. The wait is **not**
  abandoned — `whenDefined` is still awaited, so a definition that does arrive late still upgrades and
  still gets watched. The error is a report, not a refusal.
- 4107182: Refuse an `autoload-dir` containing `?` or `#` instead of quietly fetching the wrong module.
  
  The default layout builds `${dir}/${tag}${extension}` as text, and URL syntax then reads the result
  rather than the intent. Both characters end the path, so `autoload-dir="components?v=2"` — an
  ordinary cache-buster, which is why this is a mistake someone makes rather than an attack — resolved
  to `components?v=2/my-card.js`. The request went to `components` with the tag name inside the query
  string, and the component file was never asked for. A fragment is worse: it never reaches the network,
  so `components` is fetched outright. `autoload-dir="?"` resolved to the entry module itself, under a
  URL distinct enough to evaluate the whole application a second time.
  
  The containment check could not catch any of this, because every one of those URLs is genuinely
  inside the entry's own directory — that is the only question containment asks.
  
  `resolve` is unaffected: it replaces URL building entirely and is the supported way to add a query,
  so `resolve: (tag, dir) => `${dir}/${tag}.js?v=2`` keeps working, and it still receives a `dir` with a
  query rather than having it refused first.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- 5201e74: Two failures that only appear when a real app's wiring meets the server.
  
  **A displaced server renderer is reported instead of rendering everything empty.** A DOM renderer
  registers on `'render'` at priority 50, and registering at a taken priority replaces — so an app
  entry doing the ordinary thing, `wire([renderer])`, displaced the server renderer the moment that
  module was imported server-side. Every component then rendered as
  `<my-el><template shadowrootmode="open"></template></my-el>`: empty, with no error and nothing in the
  output to suggest why. `renderToString` now checks its renderer is still in the chain and says what
  happened.
  
  **`autoloader` is importable in Node again.** It built its `MutationObserver` in the constructor,
  so an app entry that wires the autoloader threw `MutationObserver is not defined` under SSR and could
  not be imported server-side at all. The observer is created on first use, which is how
  `@verajs/router` has always handled its window listeners.

## 0.1.3

### Patch Changes

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
