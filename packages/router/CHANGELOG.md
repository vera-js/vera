# @verajs/router

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
- b2a1300: Five navigation defects fixed, two of them breaking.
  
  **A newer navigation now supersedes an older one.** Every `await` in a route change — a guard, an
  `action`, a `component` that fetches — was a point where the user could click elsewhere, and the
  slower earlier pass finished last and won: the app landed on the route the user had abandoned, in
  both the view and the URL, with nothing reported. Each pass now takes a ticket and stops at its next
  checkpoint once a newer one exists, committing no render, no history entry and no title.
  
  **Params are percent-decoded** (breaking). `/u/John%20Doe` handed components the literal string
  `John%20Doe`, so every param carrying a space, slash or accent was wrong — while the code's own
  comment promised path-to-regexp's structure, which decodes. Wildcard segments decode individually. A
  malformed escape yields the raw text rather than throwing out of routing.
  
  **Route events reach the router element, and `preventDefault()` works** (breaking). `vera:*` events
  were dispatched on `element.ownerDocument`, so a listener on the router element never fired, and
  `bubbles`, `composed` and `cancelable` were all inert. They are dispatched on the element now: they
  bubble to document as before, cross shadow boundaries, and cancelling either `before-` event cancels
  the navigation, exactly as a handler returning `false` does.
  
  **`navigate(path)` defaults to a real navigation.** Omitting the trigger routed the view while
  silently leaving the URL behind — invisible to TypeScript users, a trap for plain JS.
  
  **Routes are matched once per navigation, not twice.** The redirect scan discarded the match it had
  just computed and the routing pass recomputed it, so every route's `RegExp` ran twice and a `path`
  function was called — and its pattern recompiled — twice as well.
- dd714f8: Everything Vue Router or React Router has that this did not. Three of these change behaviour.
  
  **Nested routes render the whole chain** (breaking). `children` prefixed paths and nothing else:
  `/settings/profile` rendered the child alone and the parent's `component` never ran. It now renders
  outermost first, each level into an outlet the level above rendered — the settings layout into the
  router's outlet, the profile view into the `<section view="main">` that layout produced. A view name
  is resolved *inside* the level above, so a nested outlet may reuse the router's own name. A parent
  that renders no matching outlet stops the route, and says so in development.
  
  **The most specific route wins** (breaking), not the first registered. A static segment outranks a
  `:param`, a required param outranks an optional one, and a `*wildcard` ranks below everything, summed
  over the pattern. `/users/new` now beats `/users/:id` and a catch-all sits last wherever it was
  declared. React Router ranks the same way, and for the same reason: which line a route went on
  should not decide whether it is reachable.
  
  **`beforeEnter`** — a guard for one route, run after the router's `before-route` handlers and before
  its `action`. On a nested route the chain runs outermost first, so a parent can refuse before a child
  does any work.
  
  **`alias`** — one route reachable at other paths, keeping whichever URL was used. Relative to the
  parent exactly as `path` is.
  
  **`removeRoute(name)`** — the inverse `addRoutes` never had, for a route that arrives with a
  permission or a feature flag. Takes the route's aliases with it.
  
  **`back()`, `forward()`, `go(n)`** exported alongside `navigate`.
  
  **Relative hrefs on routed links** (breaking), resolved as the browser resolves them: from
  `/docs/intro`, `href="edit"` is `/docs/edit`. Deliberately not React Router's `<Link to>` semantics,
  which would give `/docs/intro/edit` — a `route` attribute must not change where a link points, or the
  same markup would go to two different places depending on whether the script ran. A cross-origin
  href is now left to the browser instead of being hijacked and dead-ended.
- 17ee251: `navigate()` now resolves a path exactly as a routed link does.
  
  It re-resolved through `new URL()` only when the path *looked* absolute — `//host` or a scheme —
  while `methods.ts` puts every clicked `href` through the same call and takes `.pathname`. So the two
  entry points disagreed about every other shape a URL can take. Measured from a page at `/shop/items`,
  seven of eight inputs silently matched nothing where the identical value in an `<a route href>`
  worked: `edit`, `./edit`, `../a/b`, `/a/./b`, `/a/c/../b`, `#top`, `?q=1`. The README's own motivating
  example for the feature — `navigate(params.get('next'))` honouring a `?next=` redirect — is a direct
  route to it.
  
  **This changes behaviour**, hence a minor: `navigate('login')` from `/shop/items` now navigates to
  `/shop/login` instead of dead-ending with a warning, so a typo becomes a wrong page rather than a
  visible failure. That is the same trade `<a route href="login">` has always made.
  
  A base the URL parser rejects — `about:blank`, a `srcdoc` iframe, a blank `window.open` — falls back
  to the raw path instead of throwing `Invalid URL` out of an async function.
  
  21 B **smaller** gzipped: the removed condition cost more than the fallback added.

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
- 73d72ce: Say which of the two guard redirects settles inside the promise `navigate()` returns.
  
  The warning for a `beforeEnter` that returns a path offered two fixes as interchangeable: "use the
  `redirect` route option, or call `navigate()` and return false". They are not. Measured from `/a`:
  
  | | after `await navigate('/guarded')` |
  | --- | --- |
  | `redirect: '/b'` on the route | already at `/b` |
  | guard calls `navigate('/b')`, returns `false` | still at `/a` — `/b` a task later |
  
  `redirect` is handled inside that navigation, so the promise covers it. A guard calling `navigate()`
  starts a separate navigation the promise knows nothing about; awaiting it reports only that the
  guarded route was cancelled. That matters because the README makes awaiting the supported way to
  handle an outcome.
  
  Documentation only — no behaviour change. The README gains the same table, and the asymmetry is now
  asserted rather than described.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- fc0b799: Say something when a route guard returns a path instead of `false`
  
  **Only `false` cancels a navigation**, which is what the README documents and what the code does:
  `if ((await link.beforeEnter?.(…)) === false) return false;`. Every other return value is truthy, so
  the route proceeds.
  
  That makes `beforeEnter: () => '/login'` — the Vue Router habit, where returning a path redirects
  there — render the guarded route anyway. Silently. In an auth guard that is the entire purpose of the
  guard defeated, and nothing said a word.
  
  Development now warns, naming the fix: this router redirects with the `redirect` route option, or by
  calling `navigate()` and returning `false`. It is **warned rather than obeyed** — making a returned
  string redirect would be a second way to do what `redirect` already does, and the two would disagree
  the moment a route set both.
- c80dd32: `renderToStringAsync` — a render that waits for the component
  
  `renderToString` is synchronous end to end, so an `async connectedCallback` is refused: its markup
  would be empty, and saying so beats shipping it. `renderToStringAsync` waits — for the callback, and
  for promises to settle between frame rounds.
  
  Two things that were impossible now work:
  
  - **A component that loads data renders with it.** `async connectedCallback` is awaited.
  - **A routed component renders its route.** Its first navigation is scheduled on a frame and is
    asynchronous, so the markup used to be serialized while the route was still resolving and the
    outlet went out empty. The first view is now in the first response instead of only after
    hydration. `@verajs/router` returns the promise from that frame callback rather than dropping it,
    which is what gives anything a chance to wait for it.
  
  **The two chains share what decides *what* to emit** — the scanner, the serializer, the instance
  preparation, the page assembly — and differ only in when they may wait.
  `tests/ssr-async-parity.test.mjs` renders every fixture through both and compares markup, styles and
  title, because two paths that must agree forever is the failure this package has spent a week
  deleting.
  
  The scan stays synchronous in both: a component tag becomes a placeholder and its render a promise,
  and the placeholders are substituted once everything settles. Awaiting inside the scan would have
  meant a second copy of the parser, and an async recursion measures **2.45x even when nothing
  suspends** — which the synchronous path is not going to pay for a feature it never uses. A generator
  driven two ways, which is how Lit does it, measured **6.31x** and was rejected for the same reason.
  
  **Asynchronous renders take a turn each.** The per-render bookkeeping is module-level, and being
  synchronous end to end is what makes concurrent `renderToString` calls safe; a render that pauses
  does not have that protection. One at a time is the version that cannot be wrong, and it costs
  concurrency only between *asynchronous* renders. `renderToString` is untouched.
- 700a11e: `router({ animate: true })` — the connector is a dual now: wire it bare as before, or call it
  with options first. With animate on, every navigation wraps its routed renders in the platform's
  view transition (the landing render never animates; reduced motion and unsupporting engines
  route instantly; a throwing guard still rejects `navigate()`). Routes gain `load`, the
  chunk-warming half of a lazy route, resolved before the transition wraps so an import never
  stalls a frozen page.
- 51702c8: Mount the app at a subpath. Routes stay written at the root (`/users`, not `/app/users`) and the
  base is added when the router writes to the address bar, stripped when it reads one back. It comes
  from `<base href>`, or from `setBasePath('/app')` for an app that does not want `<base>` rebasing
  its assets as well.
  
  Also fixes link resolution: a clicked link now resolves through `document.baseURI` rather than
  `location.href`, which is what the browser does. The two differ exactly when a `<base>` is present,
  so on such a page a relative `<a route href>` used to send the router somewhere other than where
  the browser would have gone.
- 71be3cc: Relative navigation for components that don't know where they're mounted, without a second
  resolution grammar. `resolve()` and `navigate({ name })` fill missing params from the current route
  — from `/users/5/profile`, `navigate({ name: 'user-settings' })` goes to `/users/5/settings` with
  nothing threaded down; explicit params win, an explicit `undefined` still omits an optional
  segment, and with nothing routed yet behaviour is unchanged. A new `currentRoute()` returns
  `{ path, params }` page-wide (a copy, Node-safe), so any gesture the shorthands don't cover is
  plain string work. Development builds also diagnose the one URL rule that reads as a router bug —
  a relative word replacing a `:param` segment — naming both correct spellings.
- aa2bdb1: Refuse a protocol-relative `navigate()` target when the document's base cannot resolve an origin.
  
  `navigate()` resolves every string against `window.location.href` and refuses one that names another
  origin. When the parser throws it falls back to the raw path, on the reasoning that "an absolute path
  is already the form the matcher wants" — true of `/a`, and not true of `//evil.test/x`, which is a
  host rather than a path.
  
  An opaque base — `about:blank`, `about:srcdoc`, a sandboxed iframe, a freshly `window.open`ed window —
  makes the parser throw for every *relative* form, while an absolute URL parses fine and is checked
  normally. So the one shape that names another origin without being absolute was the one shape that
  reached `pushState` unchecked, where the browser refuses it with the uncaught `SecurityError` that
  block exists to prevent. The open-redirect payload still took the page down, in exactly the context
  the fallback carved out.
  
  Same-origin protocol-relative targets are unaffected: `//your.host/path` on your own host routes
  exactly as the absolute form does, and that half is now pinned by a test too.
- 62e5266: Four features, one hot-loop rewrite, and the generic collection helper dropped.
  
  **`meta`** — arbitrary data attached to a route and carried to every guard, action and component on
  the snapshot. The router never reads it, which is what lets a guard decide on the route's own terms
  (`to.meta.requiresAuth`) instead of re-parsing the path it was handed. Route data was previously
  unreachable outside the route's own callbacks.
  
  **`router.currentRoute`** — where that router is now, params and query already parsed. Reading
  `location.pathname` gave the string back but not the match.
  
  **Optional params** — `/users/:id?` matches both `/users/5` and `/users`. The slash goes inside the
  optional group, so the shorter path routes rather than requiring a trailing slash; an unmatched
  optional param is absent from `params` rather than empty.
  
  **`scrollBehavior`** — replaces where the page scrolls to after routing, for a list that should keep
  its offset, a view that scrolls its own container, or smooth scrolling. `saved` carries the position
  stamped on the entry a back/forward traversal landed on.
  
  **Active links are 1.1–1.2× cheaper**, and cost the DOM writes that matter rather than one per link.
  The clear-then-re-add shape rewrote `class` on every routed link on every navigation, because
  `classList.remove` runs its update steps whether or not the token was there — 80 attribute writes
  for a 40-link nav bar to change two. `toggle(token, force)` already writes only on a real change,
  and `removeAttribute` on an absent attribute is a no-op.
  
  The generic `get` chaining helper from `@verajs/shared-utils` is gone from this package, replaced by
  a local get-or-create. Its Array branch, `instanceof` helper and throwing fallback were all inlined
  into the standalone bundle and none of them were reachable — 58 B gzipped.
  
  **Named routes.** `{ path: '/users/:id', name: 'user' }` plus `resolve('user', { id: 5 })`, so a
  link is built from a handle rather than by hand and renaming the path leaves every caller alone —
  the reason both Vue Router and React Router have this. Values are encoded, so a param round-trips
  through the decoding that happens on the way back in; an omitted optional param takes its whole
  segment; a wildcard takes an array. `navigate({ name, params })` is the same call in Vue's shape.
  
  **The fragment is on every snapshot** as `to.hash`. A hash-only change does not re-route, but each
  router's `currentRoute` takes the new fragment and `after-route` fires with `trigger: 'hashchange'`
  — which nothing produced before, despite the trigger being in the public type since 0.1.0.
  
  **Two fragment-navigation bugs, found by asking a real browser.** A fragment navigation fires
  `popstate` as well as `hashchange` — in Chromium, Firefox and WebKit alike. The `popstate` listener
  routed to `location.pathname`, dropping the fragment, so every anchor click read as a move away from
  `/docs#install` to `/docs`: the component ran a second time, guards re-ran under a `'popstate'`
  trigger, and because `popstate` focuses every routed view, an in-page link stole focus. The listener
  now carries the fragment, which also makes traversing back to `/docs#install` restore it instead of
  dropping it. Separately, `currentPath` was recorded after the URL was touched, and touching the URL
  re-enters `navigate` synchronously — so the re-entry compared against a stale path and routed again.
  It is recorded first now.
- 70d8416: Security and accessibility fixes from a principles audit.
  
  **A view name is no longer interpolated into a selector.** `view` may be a function whose result
  derives from URL params, so the name is attacker-influenced, and it was being built into
  `[view="…"]` with only `"` escaped. Escaping a quote is not enough: `a\"` becomes `a\\"`, which CSS
  reads as a literal backslash followed by a string terminator, so the value escapes the string it was
  quoted into. A crafted URL threw a `DOMException` out of `navigate` — an unhandled rejection that
  killed the navigation — and a payload that parsed would have selected an element the author never
  marked as an outlet. Nothing builds a selector from the name now; the attribute is compared as a
  string, so there is no grammar left to escape into. 3 B.
  
  **A focused view no longer joins the tab order.** When a routed view has no focusable content the
  router focuses its root, and it did so by setting `tabIndex = 0` — which makes the element focusable
  *and* inserts it into the tab sequence, permanently, since nothing takes it back out. Every
  navigation to such a view left another tab stop behind. `-1` is the standard shape for a
  programmatic focus target: focusable from script, absent from the tab sequence.
  
  Also removed: three `Route` fields nothing ever set (`pattern`, `keys`, `regExp`, duplicating
  `ParsedPattern`), a `stripTrailingSlash` re-export nothing imported, and three stale `TODO` comments
  describing minified-error work that never happened.
- 557e329: Active-link marking now works for relative hrefs. `href="hello"` was compared as written against a
  path of `/hello` — two spellings of the same destination — so a nav bar built with relative links
  never highlighted. Hrefs are resolved through `document.baseURI` first, the same source the
  link-click handler uses, so a link is judged active by exactly the URL clicking it would reach. A
  cross-origin href never matches, though its pathname could collide.
- 097a239: `resolve(name, params)` returns the mounted path under a base — `/app/users/5` rather than
  `/users/5` — so its result goes straight into an `href`. `navigate()` accepts it unchanged, because
  every path it is given is resolved and stripped, so one return value is now correct in both places.
  At the origin root it is the same string it always was.
  
  Development builds also warn when a routed link's `href` points outside the base. Such a link
  navigates correctly, because the router re-bases what it writes to history, and is a wrong URL
  everywhere the router is not involved.
- 38d42e2: Route params are typed from the path, at zero runtime cost.
  
  ```ts
  router.addRoutes([
    { path: '/users/:id',        component: (params) => params.id },      // string
    { path: '/files/*rest',      component: (params) => params.rest },    // string[]
    { path: '/u/:id/edit/:tab?', component: (params) => params.tab },     // string | undefined
  ]);
  ```
  
  `params.nope` is a compile error, and so is treating a wildcard as a single string — with no
  annotation at the call site, no schema and no code generation. `component`, `action`, `beforeEnter`,
  `title`, `view` and `redirect` all get it.
  
  `ParseRouteParams` and `TypedRouteAction` shipped as exported types that nothing referenced, and
  `TypedRouteAction` named `Route` where it meant `RouteSnapshot`, so anyone who had reached for it
  would have got the wrong shape. Both are wired in and corrected. `ParseRouteParams` now also
  understands `*wildcards`, optional `:params?`, tokens that are not a whole segment (`/fellow/john:id`
  is a real pattern), and several tokens in one segment — and a non-literal path falls back to the
  loose record rather than to a type with no properties at all.
  
  A `path` function, and any route under `children`, keeps the loose shape: threading the parent
  pattern into children needs a second inferred type parameter, and adding one collapses inference for
  the whole array.
- d3c1af1: `navigate({ name })` with an unknown name now returns `false` instead of `true`. The empty path an
  unknown name resolves to used to meet the same-path early return and report a successful
  navigation — to exactly the code the docs tell you to write (`await navigate()` and handle the
  failure). The page never moves either way; the promise now says so.

## 0.1.3

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
