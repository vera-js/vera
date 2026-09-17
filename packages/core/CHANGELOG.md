# @verajs/core

## 0.3.0

### Minor Changes

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
- 54412a4: Export `svg` and `mathml`, and stop re-exporting `connectInserts`.
  
  **`svg` and `mathml` were defined and never exported.** `@verajs/renderer` has always read
  `_$litType$` and wrapped markup in `<svg>` or `<math>` before parsing, precisely so the fragment
  lands in the right namespace — but nothing in core produced those types, so the support was
  unreachable. A user had to import lit-html's `svg` or hand-craft `{ _$litType$: 2, strings, values }`.
  
  Namespace is not a nicety here: `document.createElement('circle')` produces an `HTMLUnknownElement`
  that parses fine and never renders. Only a fragment parsed inside `<svg>` yields a real
  `SVGCircleElement`. Costs 32 B for both.
  
  **`connectInserts` is no longer re-exported from core.** It connects *a module's* registry to core's,
  so every documented use imports it from the module being connected — `@verajs/router` — never from
  here. Re-exporting it made core carry its replay loop for a call nothing makes, and core is 24 B
  smaller without it. The types are still re-exported, so `RendererInsert`, `InitInsert` and the rest
  remain available from `@verajs/core`; only the value is gone, and TypeScript reports its use
  precisely rather than failing at runtime.
  
  This is the breaking part, hence minor. Only `@verajs/core` and `@verajs/router` carry a registry at
  all — and by the time this releases neither does: the router is handed core's through
  `wire([router])`, and `connectInserts` is gone with the concept.
  
  Net effect on core: 2 577 B to 2 585 B, +8 B for two exported tags and a smaller insert surface.
- a5453bd: `mount()` commits a component's setup without drawing anything, and `render`'s template argument is
  now required.
  
  `init()` opens a component's setup and one of two calls closes it — running the first pass of every
  hook registered since `init()` and clearing the instance:
  
  ```js
  connectedCallback() {
    init(this);
    const state = createStore({ online: navigator.onLine });
    useEffect(() => report(state.online));
    mount();                       // a component with no markup
  }
  ```
  
  `render(template)` is exactly `useRender(template)` followed by that same commit — a compound over
  the base operation, not a second way to do the same thing, which is why a component only ever calls
  one of them.
  
  **Why this reverses an earlier decision.** A bare `render()` used to be how a side-effect-only
  component committed: legal, documented, and guessed by nobody, because "render" names the one thing
  the call is not doing. A standalone commit function was built once and rejected on size — 25 B
  against 6 B — and that comparison could not measure the failure it was trading away. Hooks that are
  never committed never run: no error, no render, an effect that simply does not happen. `mount()`
  costs 35 B gzipped in core and makes that failure findable.
  
  A bare `render()` still commits and warns, naming `mount()`. Refusing would turn a spelling
  preference into effects that silently never run — the exact failure this exists to prevent. The
  break is at the type level: `render()` with no argument no longer compiles, which is why this is a
  minor rather than a patch.
  
  Development warnings updated to match: the "registered N hooks but never committed" warning now
  names both calls, and "hook ignored" names the `render()` or `mount()` that ends setup.
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

- 57ab91d: Ten public APIs now name the mistake instead of leaking an internal
  
  The second audit sweep took passes 22 and 80's lens again — wrong-typed input to every public
  function — but **mechanically** this time: every export of all thirteen entry points, crossed with
  seven wrong values, filtered for errors that name an internal rather than the call. The hand-picked
  passes had found three defects; enumerating found six more.
  
  **The worst was silent.** `html('<p>hi</p>')` — the call form rather than the tagged form, which is
  how the same job is done in libraries that take a markup string — returned a template-shaped object
  with a *string* where the strings array belongs. It passed every shape check and failed much later
  inside the renderer with `Invalid value used as weak map key`, because the template cache is keyed by
  the strings array and a string is not a legal key. Nothing in that message mentions `html`. `svg` and
  `mathml` did the same; `css` threw `strings.reduce is not a function`.
  
  Also guarded: `untrack(state.a)` instead of `untrack(() => state.a)` — which reads the property
  *before* untrack is entered, so it is tracked after all, the opposite of what was asked — plus
  `renderInto` with no container, `keyed` with no template, `tag('h1')` called instead of tagged,
  `navigate(undefined)` (an async throw, so it surfaced as an unhandled rejection naming nothing), and
  both `@verajs/styles` entries.
  
  The template-literal check is `Array.isArray` and deliberately **not** `raw`: a hand-built
  `html([markup])` works and `ssr-scale.test.mjs` builds a hundred nested components that way. That
  shape does churn template identity, which is the render profiler's business to report rather than
  this guard's to forbid. The defect fixed here is the silent one.
  
  All `__DEV__`-only, so production carries none of it.
- e6d06e4: Document what a shadow root does to ARIA, and prove the ways through
  
  `docs/CODE-PRINCIPLES.md` says accessibility is not a follow-up, `init(this, { mode: 'open' })` is the
  documented way to write a component, and nothing anywhere said what that costs.
  
  **Every ID-based ARIA relationship resolves within a single tree.** `aria-labelledby`,
  `aria-describedby` and `<label for>` all match by ID, and IDs do not cross a shadow boundary — so a
  page-level label cannot name a control inside a component. There is no error and no warning, just an
  element with no accessible name. That is the platform's rule, not this framework's, and it is now in
  the core README beside the `init` entry that creates it, and in `llms.txt`.
  
  Three ways through, each with a browser test rather than a claim: keep the relationship inside one
  template; put a role and name on the **host** with `ElementInternals`, which lives in the outer tree
  (`attachInternals()` before `init`, which does not clobber it); or use light DOM, where `static
  styles` still applies. `delegatesFocus: true` forwards host focus to the first focusable child.
  
  Documentation only — no behaviour changed. `tests/browser/aria-shadow-boundary.test.js` establishes
  the platform rule and executes all three recommendations in Chromium, Firefox and WebKit, because
  advice that has not been run is a guess.
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
- b67cd36: `render()` with no template commits a component's setup without drawing anything.
  
  It has always done two jobs — declare the markup, and end the setup by running the first pass of
  every hook registered since `init()`. A component whose whole job is a side effect (analytics,
  syncing, focus management, a store subscription) has nothing to draw and had to write
  `render(() => html``)` to get its effects to run at all: ceremony that pretends to draw. Forget it
  and nothing happens, silently — the hooks exist and nobody runs them.
  
  ```js
  connectedCallback() {
    init(this);
    useEffect(() => track(session.page));
    render();
  }
  ```
  
  Existing light DOM is untouched, since nothing renders into it.
  
  Two alternatives were built and measured first. A separate `commit()` cost 25 B against 6 B and
  added a second function to choose between. Committing automatically after `connectedCallback` cost
  31 B and ran a headless component's effects a microtask later than a rendering component's — the
  same code with two orderings depending on whether it drew anything.
  
  Development also warns when `render()` is never called, naming the component and its hook count.
  Detected without carrying any state, since `render()` clears the current instance; the check can
  miss a case when another component mounts first, but cannot invent one. Production carries neither
  the check nor the message.
- 0db2f4e: An element that removes itself inside its own effect still runs that effect's cleanup
  
  `disconnectedCallback` runs every cleanup and clears the set. A cleanup is registered when the effect
  *returns*, so an effect that calls `this.remove()` — a toast dismissing itself, a component that
  redirects — finished **after** that sweep and added its cleanup to a set nothing would ever drain
  again. The interval, listener or subscription it was meant to release ran forever, silently: exactly
  the failure the cleanup registry exists to prevent, reached by the one ordering that steps around it.
  
  A cleanup registered after the sweep now runs immediately, which is what the teardown would have done
  a moment earlier.
  
  The element is tracked as removed rather than tested with `isConnected`, because a component rendered
  into a detached container has never been connected and is still owed a later removal.
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
- 0bbabfc: `_cleanups` joins the mangle exemptions — it is a cross-boundary contract
  
  Core's production build mangles `_`-prefixed properties, with an exemption list for the names
  other bundles reach structurally: `_p`, `_isSignal`, `_ignore`, `_delete`, `_root`, `_hooks`,
  `_$…`. `_cleanups` was not on it, and it is exactly such a contract: `@verajs/motion`'s vera
  adapter registers each component's release into `element._cleanups`, which core drains on
  `disconnectedCallback`. In every production build the drain read a renamed property, the
  adapter's optional-chained read came back `undefined`, and component roots were never released
  on unmount — silently, and in production only, the same failure shape `_hooks`' own docblock
  warns about.
  
  Found by a cross-package sweep for structural `_` reads (2026-09-01): the full set reaching
  across bundles is `_root` (styles' closed-shadow-root fallback, and the motion adapter) and
  `_cleanups` (the motion adapter) — the first was already exempt, the second now is.
  `tests/core-structural-contracts.test.mjs` pins both on a live element, in the production run
  where the defect lived; verified to fail against the unfixed build.
- 053fd5d: Stop shipping a development warning to production, and give `useEffect` the swappable scheduler.
  
  **A `console.warn` was not behind `__DEV__`.** The "hook ignored — register between init() and
  render()" message shipped in every production bundle, message text and all. Guarding it removes
  **65 B**, 2.4% of the package, for a diagnostic no production user can act on. Every other warning in
  core was already guarded; this one was missed.
  
  **`useEffect` hardcoded its own `requestAnimationFrame`,** byte-for-byte identical to
  `animationFrame` in `setRenderScheduler` — including the `typeof` guard for off-browser
  environments. Beyond the duplication, it meant `setRenderScheduler(microtask)` moved renders and
  left effects on animation frames: an author who chose microtask scheduling precisely to escape the
  frame boundary still waited one for every effect. Measured — the order stayed `layout → render →
  effect`, but the effect arrived up to a frame later than the other two. Both now use one scheduler.
  
  Also removes 26 lines of commented-out lit code from `store.ts`, a third of that file, sitting
  unlabelled beside production code.
  
  Core is 2 686 B to 2 620 B.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- afd78b6: The framework now survives your callbacks throwing, instead of quietly stopping.
  
  **A cleanup that threw killed its effect for the life of the component.** `invoke` opened with a
  bare `cleanup?.()`, so the throw took the whole call with it: the effect body never ran, `cleanup`
  was never replaced, and the next pass called the same throwing function again. Every later write
  reported the same error and changed nothing. `swapCleanup` already guarded exactly this on the
  disconnect path, so the gap was the path a component spends its whole life on.
  
  **A cleanup could run twice.** `cleanup = next` was the last statement, so an effect body that threw
  left `cleanup` holding the previous pass's teardown — which had already run a line earlier. Invisible
  for a teardown that removes a listener; not for one that releases a lock or closes a socket, and it
  only happens while something else is already going wrong.
  
  **A ref callback that threw emptied the component and it never rendered again.** A ref runs in the
  middle of committing a template's parts, so the throw unwound the render and left the commit half
  applied: the shadow root ended up empty and stayed that way. The error was reported, so the only
  symptom was a component that had silently stopped existing. It is now named as a ref and the render
  continues without it — the same judgement `handleEvent` already makes for a handler that cannot
  listen.
  
  Found by making user code throw at every point the framework calls it, and checking not just that
  the throw was reported but that the framework was still usable afterwards.
- 391a20d: Fold a subscription's priority order in beside its callbacks
  
  `addCallback` kept each element's priority-ordered callback sets in one place and the parallel
  priorities in a **separate `WeakMap` keyed by that array** — so every tracked read paid a
  `WeakMap.get` to recover something only the insert path ever looks at. `runCallbacks` walks the slots
  by index and never consults the order at all; the comment above the declaration claimed otherwise.
  
  They are one fact, so they now travel together as `PropSubscriptions`: one object where there were two
  arrays and a `WeakMap` entry.
  
  Worth ~10% of a server render — **5.53 and 5.54 µs against a baseline of 6.16 to 8.40**, fastest of
  nine rounds over 20 000 renders, with the baseline re-measured after restoring. The folded runs are
  also markedly tighter, which is the allocation showing up as GC variance. A client micro-benchmark
  that reads one property 200 000 times sees no change at all, and that is the point: it is maximally
  cache-friendly, while every subscription on a server is built cold and thrown away.
  
  2 B gzipped.
- 507fdd6: Stop allocating a closure on every tracked read
  
  `addCallback` ends with `prioritySlot(byPriority, order, priority, () => new Set())`, and that arrow
  was built on **every tracked property read** while only ever being called on the first one — directly
  contradicting the comment two lines above it, which says the steady state is allocation-free. It was
  not. `createHook` carried the same shape.
  
  Found by heap-profiling a server render, where the proxy's `get` trap accounts for **43% of all
  allocation per render**: on a server every render is cold, so the subscription graph is built once and
  discarded, and nothing reaches the steady state the hot path is tuned for.
  
  Hoisting the factory to a module constant is behaviour-identical — `prioritySlot` still takes a
  factory so the slot is built only when missing, which is worth keeping; only the factory stops being
  rebuilt. Measured on the SSR component render, fastest of nine rounds over 20 000 renders, twice:
  **6.14 and 6.37 µs against 6.73 and 6.79** inline. 7 B gzipped.
- c926257: Warn in development when a component registers hooks but never calls `render()`.
  
  `render()` is what drives the first pass: it calls `runHooks()` and then clears the current
  instance. A component that registers effects and never renders therefore does nothing at all — the
  hooks exist and nobody runs them. Silent, and easy to write, because a component whose whole job is
  a side effect (analytics, syncing, focus management) has no obvious reason to render markup.
  
  Detected without adding state: if the element is still the current instance once the synchronous
  `connectedCallback` has finished, `render()` was never reached. A component mounting after this one
  moves that pointer, so the check can miss a case but cannot invent one. `__DEV__`-only — the
  production bundle is unchanged at 2 680 B and contains neither the check nor the message.
  
  `tests/core-hook-lifecycle.test.mjs` covers the rest of the lifecycle alongside it: cleanup on
  removal, no renders while detached, four attach/detach cycles leaving exactly one live hook, error
  isolation across hooks in both directions, and `untrack`.
- 8a792b4: Say when a second `init()` discards the hooks registered before it
  
  `init()` starts a fresh generation of hooks, and dropping the previous one is correct and
  load-bearing: `connectedCallback` runs again every time an element is re-added — a router navigating
  back, a list reordering, a conditional subtree returning — and a fresh generation is what stops
  effects from doubling.
  
  Called **twice in one setup** it is a mistake instead, and every hook registered between the two
  calls was silently discarded. `init(); useEffect(fn); init(); render(...)` never ran `fn`, with no
  error and no warning — an effect that looks registered and is not.
  
  It now says so, names how many hooks were lost, and explains why they were. The reconnect path stays
  silent, which is asserted alongside: a diagnostic that fired on every router navigation would be
  worse than none.
  
  `__DEV__`-only; production carries neither the check nor the message.
- a7336b5: Explain a write the language refused, instead of leaving the engine to talk about proxy traps.
  
  A store is a proxy, so a refused write has to be reported by returning `false`, and the engine turns
  that into `TypeError: 'set' on proxy: trap returned falsish for property 'n'` — a message about the
  trap, which is internals the reader never wrote. The same assignment to an unproxied frozen object
  says `Cannot assign to read only property 'n'`, so putting a store in front of an object made the
  diagnosis worse. `createStore(Object.freeze(defaults))` is an ordinary thing to write, and a frozen
  constants table nested in state is how it usually turns up.
  
  Development now names the rule that refused — frozen, sealed with a new key, non-extensible,
  `writable: false`, or a getter with no setter — for both `set` and `delete`. It reports rather than
  repairs, because every one of these is a language invariant and not a framework decision.
  
  `__DEV__`-only: **0 B in production**, verified against the built bundle, and it throws in both builds
  either way.
- c796080: Say "no renderer wired" in production too, not only in development
  
  Core ships no renderer of its own, so a component that renders with nothing wired produces an empty
  page. Three separate mistakes end there — `wire` never called, wired with an import name that
  resolved to nothing, or handed something that is not a module — and every one of them was
  **completely silent in production**: no warning from `render()`, none from `wire`, nothing anywhere.
  A blank page and no explanation.
  
  That matters because **buildless is a first-class mode**. Someone pasting `vera.min.js` into CodePen
  from a CDN never runs a development build, so a `__DEV__`-only diagnostic is invisible to exactly the
  person most likely to have forgotten the wiring — and this is the framework's most likely first
  mistake.
  
  `render()` now warns in both builds. Development keeps the full message with the two lines that fix
  it; production carries a short one. Warned **once per process** and only on the failing path, so a
  working app never reaches it. Costs 36 gzipped bytes.
  
  Found by running the same behavioural matrix against the development and production builds and
  diffing the results — 13 behaviours, one of which differed.
- e7e56f5: A dead-code and consistency sweep from the full-line read — no behaviour changes
  
  Every removal was verified unreachable before it went: core's `runHooks` kept an optional call on a
  value already guarded, and `runCallbacks` re-fetched through two map lookups the very set it was
  iterating; the ssr serializer's final `raw` ternary sat below the early return that makes it
  unreachable, an entity-table entry could never match its own regex branch, and the fragment parser
  carried a variable it only ever `void`ed; the JSX transform now initialises `usedSpread` beside its
  two siblings instead of relying on undefined-is-falsy.
  
  Also in `@verajs/ssr`: the Set-diff that recovered "the entry `setRenderer` registered" around the
  `wire()` call was a leftover from an API that registered a wrapper. `wire` registers the function it
  is handed, so the renderer-displacement guard now asks the chain for `serverRenderer` by identity —
  same check, two lines and one allocation fewer, and the comments above it stop teaching a removed
  API.
  
  Net −16 B gzipped on `@verajs/core`; size claims re-synced.
- 7392f46: Notify on array appends and on `delete`. **Two reactivity bugs.**
  
  **Appending to an array moved `length` without reporting it.** Assigning `list[3]` on a
  three-element array updates `length` as an internal consequence, so nothing passes through the `set`
  trap for `length` and a hook that read it was never told. `push` and `unshift` were silently inert;
  `splice` and `pop` worked, because those assign `length` explicitly. A list rendered from
  `items.length` simply stopped updating when you appended to it, with no error.
  
  **Deleting a property notified nothing at all.** The `deleteProperty` trap returned success without
  running callbacks, so a hook reading that property kept the value it last saw.
  
  Both are fixed at the trap. Precision is unchanged and asserted: an append does not wake a hook that
  read only `list[0]`, a non-index key on an array is not treated as growth, deleting an absent or
  unread property stays silent, and an explicit `length` write still notifies exactly once.
  
  Costs 63 B gzipped.
- cc7a3f0: Documentation. Core's README was eleven lines for the package everything else is built on; it is now
  a full one, with a runnable recipe, tables for state, effects, rendering and extension, and the two
  mistakes that actually bite — undeclared TypeScript class fields, and swapping subtrees where a
  stable shape would do. It also no longer claims to have no dependencies while depending on
  `@verajs/inserts`.
  
  `@verajs/inserts` gains the part that was missing: what an extension *is*, with the four shipped
  ones named as examples of the same five points and the same public function you have.
- c346153: Name a self-feeding render loop in development, without stopping it
  
  `useEffect(() => { state.total = sum(state.rows) })` next to a template reading `state.total` pegs a
  core for as long as the page is open: 11 runs in 10 frames, forever, with no error, no warning, and
  nothing to search the console for. `useSyncEffect` has stopped and named its own recursion for a
  while; the coalesced path — `useEffect`, `useLayoutEffect`, and a template that writes what it reads
  — said nothing at all.
  
  It warns rather than throws, and this is the whole design question rather than a hedge. Vera's
  default scheduler is an animation frame, so an effect that writes what it reads already runs once per
  frame — which is also how you write an animation. React draws exactly this line (`throw` on the
  synchronous cascade, `console.error` on the coalesced one, neither shipped to production) and Lit
  warns without stopping and names the legitimate case inside the warning text. Both are followed here.
  
  **What is counted is not frames.** It is consecutive passes that fed *themselves*, reset by the first
  pass that does not — React's `nestedUpdateCount` rule. A write that lands outside the pass, from your
  own `requestAnimationFrame`, a timer or an event, never trips it at any threshold, so an animation
  driven that way is silent by construction rather than by tuning. The count is kept per element **and**
  per hook: shared globally, fifty unrelated components that each write once look like one component
  looping fifty times, and keyed on the last element to feed, two instances of one buggy component
  alternate and neither is ever reported.
  
  **`allowRenderLoop(element)`** marks a loop as deliberate for a component that means it — the escape
  hatch Lit ships and React does not, and the one the animation framework needs. A no-op in production.
  
  `__DEV__`-only: **+14 B gzipped** for the detection and **+12 B** for the exported opt-out, and the
  production bundle contains neither the counters nor the text. Three collections are marked
  `@__PURE__` because a bare `new WeakSet()` at module scope is a constructor call the minifier must
  assume has side effects — production was keeping the allocations with their bindings dropped.
- 98d9ce5: The warning for `render()` with no template no longer says something untrue.
  
  It read: *"render() needs a template. If this component has no markup, call mount() instead — it
  commits the setup and runs the hooks, which is what a bare render() used to do."* Both halves are
  false of the function printing them. It does not need a template, and it still commits exactly as it
  always did — the paragraph directly above the message in the source says so: *"It commits anyway.
  Refusing would convert a naming preference into a component whose effects never run."*
  
  Read at runtime by someone debugging, it says "your hooks are not running", which sends them looking
  for a fault that is not there. The message now says what happens — the setup is committed and the
  hooks run — and recommends `mount()` as the name for it.
  
  Behaviour is unchanged. The test that covered this matched the literal old string, which is how the
  message was able to drift into contradicting the assertion two lines above it; it now requires the
  warning to name `mount()` and to make no claim that the hooks failed to run.
- 60cc173: A scheduler that throws no longer freezes the component forever
  
  Every render and every effect passes through whatever `setRenderScheduler` holds, which makes it the
  widest blast radius in core — and pass 92 was the first audit to point at it.
  
  The coalescing flag is raised *before* the pass is handed to the scheduler and lowered *inside* it, so
  a scheduler that never runs the pass left it raised and every later write returned early. The
  component then stopped rendering **permanently**: measured frozen at its initial value, with no error
  and no warning, and not revived by restoring the default scheduler. The effect path had the same
  shape under a different flag name, so renders and effects both went silent.
  
  Worse, it is invisible at the call site: `createHook` isolates a hook's error to the `'error'` insert
  so one bad hook cannot take out its siblings, which means the throw never reaches the code doing
  `state.n = 1`.
  
  The flag is now released when the scheduler throws, and a pass **stranded** by a scheduler that drops
  it is re-queued once that scheduler is replaced.
  
  The second half was nearly left unfixed, on the reasoning that a dropped pass cannot be told apart
  from a deferred one. That is true *at the moment of scheduling*, and that is not the only moment:
  once the scheduler has been replaced, whatever the old one was holding is provably never going to
  run, because nothing will ever call it again. `setRenderScheduler` bumps a generation — a live
  binding, exactly as `revision` is in `@verajs/inserts` — and the coalescing guard stops honouring a
  flag raised under a scheduler that no longer exists. A component that never renders again is not
  something to leave standing behind an argument about contracts.
  
  Coalescing is unaffected within a single scheduler, which the suite asserts directly: twenty writes
  in one tick still produce exactly one render. 30 B gzipped.
  
  `tests/core-scheduler.test.mjs` also executes the `flushSync` recipe `llms.txt` publishes for View
  Transitions, verifying it renders synchronously and restores the previous scheduler, and exercises the
  exported `microtask` scheduler.
- 845d31f: The size audit's no-decision tier: −96 B gzipped on the counter app, nothing changes behaviour
  
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
- 2cefc25: `renderToString(url, { static: true })` — about 3x, for a page that will not be interactive
  
  A server render is one shot: the subscriptions built while it runs are never fired afterwards, so
  tracking every property read to create them is pure cost. Measured on a component rendering twenty
  rows, the proxy behind `createStore` is the **entire** reactivity overhead of a server render — about
  40 µs against a 15 µs baseline — while effects and the scheduler cost nothing detectable. With
  `static` on, `createStore` hands back the object it was given and reads are ordinary property access.
  
  **The markup is identical**, and that is the whole safety of it. It is not asserted on an example:
  `tests/ssr-static-mode.test.mjs` renders *every* fixture in the suite both ways and compares markup,
  styles and title. A mode that cannot drift is why this is a flag rather than a second renderer.
  
  **A store written to during a static render throws**, naming the option, rather than rendering markup
  that reflects none of the writes. That guard is deliberately **not** development-only, unlike most of
  this framework's diagnostics: a server runs the production build, so folding it away would remove it
  from the only place it matters. It is free — the proxy has no `get` trap, which is where the cost of
  a reactive store actually is.
  
  `@verajs/core` gains `setStaticStores`, which is what `@verajs/ssr` calls. It is server-side only:
  leaving it on in a browser gives you a framework that does not update.
  
  **Size:** an app that uses `createStore` grows **47 gzipped bytes** (6 026 → 6 073 B), which moves it
  from 5th to 6th in the comparative table — 42 B behind Preact, where it was 5 B ahead. An app that
  does not use `createStore` is **unchanged at 5 005 B**, because the branch tree-shakes away with the
  store it belongs to.
- eb4e8e2: Assigning a nested object back into its own slot is no longer treated as a change.
  
  The set trap read the previous value off the raw target while the getter hands out that object's
  proxy, so `state.o = state.o` compared proxy against raw, notified every subscriber that nothing had
  happened, and wrote the proxy into the target — where code still holding the object the store was
  built from saw its own property stop being what it passed in.
  
  The idiom it cost is the common one. `state.items = update(state.items)`, where `update` returns its
  input untouched when there is nothing to do, is how "no change" is normally written, and it bought a
  render pass every time with no symptom other than work nobody asked for. The primitive half of the
  rule was already there — `state.n = 1` was correctly quiet — which makes this a gap rather than a
  decision.
  
  Core grows 11 B gzipped. Primitive writes are unaffected (the check short-circuits on `typeof`);
  an object-identity write costs one `WeakMap` lookup, measured at 5.4 ns.
- d73b937: `@verajs/styles` exports a `styles` module, so it wires like every other package:
  
  ```js
  wire([renderer, styles]);
  ```
  
  Previously this package alone made an app entry hand-write `{ on: 'init', fn: adoptStyles, priority:
  50 }` — knowing which insert point style adoption belongs to, and that 50 is the number, in order to
  use a package whose whole job is one registration. `renderer`, `router`, `autoloader` and
  `collections` all export a module; `styles` was the exception.
  
  `adoptStyles` is unchanged and still exported: the longhand is what to write for a non-default
  priority. It is now marked so that `wire([adoptStyles])` — a bare function, which `wire` would
  otherwise treat as a connector and silently register nothing — throws and names `styles` instead, the
  same way `render` names `renderer`.
  
  Costs 40 B gzipped in `@verajs/styles`. Core's "nothing is adopting them" warning now prints the
  short form.
- fe2891b: Make `WeakMap` and `WeakSet` reactive.
  
  They were the one collection gap against Vue, which supports all four. Mutating one in a store used
  to succeed and simply not re-render, leaving the DOM stale — a silent staleness rather than an error.
  
  The obstacle was never the proxying, it was where dependencies live. Per-key dependencies are keyed
  by the collection's own entry keys, and the ordinary `Map` container would have held every tracked
  key alive for as long as the collection — exactly the retention the weak types exist to avoid.
  Supporting them naively is a memory leak, which is worse than not supporting them.
  
  A weak collection now gets a `WeakMap` container instead, chosen once on the first tracked read so
  the hot path never pays for the check. The two shapes stay interchangeable because only `get` and
  `set` are ever called on the container, and a weak collection never reaches the string `'_global'`
  channel: `set`/`add`/`delete` *notify* it, which is a `get` and misses harmlessly, while only
  `entries`/`keys`/`values`/`forEach` *track* it — and none of those exist on a weak collection.
  
  Proven weak rather than assumed: three keys tracked, dereferenced and collected under
  `--expose-gc`. Per-key precision holds — a key nothing read does not re-run — and object-keyed
  regular `Map`s keep the strong container and their `size` channel.
  
  `Date` and `RegExp` remain unproxied, as they are in Vue. Their methods read internal slots, so a
  bare proxy throws, and reactivity would mean wrapping every mutator for a case whose idiom is
  replacement: `state.when = new Date(t)` is a property write and already reactive.
  
  Costs **30 B gzipped** in core. (Stated as a delta rather than a before-and-after: several changes
  release together, so an absolute figure written here would be wrong by the time it publishes.)
- Updated dependencies [1e89906]
- Updated dependencies [4ad3d73]
- Updated dependencies [2f20123]
- Updated dependencies [dd76fb8]
- Updated dependencies [5a28ddf]
- Updated dependencies [cc7a3f0]
- Updated dependencies [e3a0a4d]
- Updated dependencies [b7adb81]
  - @verajs/inserts@0.2.0

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
