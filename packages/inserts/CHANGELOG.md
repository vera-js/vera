# @verajs/inserts

## 0.2.3

### Patch Changes

- cbf6b05: `@verajs/ssr/named-references`: every named character reference of the HTML Standard for the server DOM, as a module
  to wire (`wire([namedReferences])`). The server's parser decodes six names itself (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
  `&apos;`, `&nbsp;`) and every numeric reference; wired, every other name reads back as the text a browser gives in
  `textContent`, attributes, `.value` and a bound `<select>`'s options, by the tokenizer's rules: a legacy name without
  its `;` decodes too (`&amp` in text is `&`), the longest name wins (`&notin` in text is `¬in`), and in an attribute
  value a legacy name before `=` or a letter or digit stays as written (`&ampx=1`). A server that does not wire it never
  loads the table and reads such a name back as written, as before, and now says so once per name written with its `;`
  (`ssr-named-reference-unwired`). The served markup is unchanged. `'reference'` is the new insert point the module wires
  on (types only).

## 0.2.2

### Patch Changes

- 194266a: SVG and MathML in JSX are parsed where they land — and buildless JSX loads whole apps
  
  ```jsx
  const Frame = ({ children }) => <svg viewBox="0 0 24 24">{children}</svg>;
  <Frame><path d="M0 0h24" /><circle cx="12" cy="12" r="4" /></Frame>
  ```
  
  built its shapes as HTML. `<path>` parsed as HTML is an `HTMLUnknownElement` — right tag name, no
  geometry, nothing drawn — so an entire header of icons vanished for the app that reported it. The
  call site cannot know what `Frame` renders, and JSX has no `` svg`…` `` to reach for, so no spelling
  worked.
  
  **`@verajs/renderer/namespaces`: a template is parsed in the namespace of the position it lands
  in.** Wire it — `wire([renderer, namespaces])` — and an `html` template placed inside an `<svg>` is
  SVG, inside a `<math>` is MathML, and inside a `<foreignObject>` or a `<div>` is HTML, exactly as the
  same markup written inline there would be. Which position means which namespace is asked of the
  browser's own parser, once per parent name (and, under a MathML parent, per child tag — `<svg>` in
  `<annotation-xml>`, `<mglyph>` in `<mi>`), rather than read from a list — so the integration points,
  the breakout names and `<annotation-xml encoding>` behave as the parser has them. A hand-written
  `` svg`…` `` or `` mathml`…` `` keeps the namespace it was written with. It is 742 B gzipped, and
  the renderer without it pays nothing on its render paths beyond a flag check.
  
  **`@verajs/jsx` 0.4.0 — breaking.**
  
  - **Every template is `html`, and every compiled module wires `@verajs/renderer/namespaces`**
    (`import { namespaces } …; import { wire } …; wire([namespaces]);`, prepended). Wiring from every
    module means no JSX template can be built before the resolver exists, whichever chunk loads first;
    wiring the same descriptor again is idempotent. `namespaces: false` opts out, and `inject: false`
    leaves the wiring to the caller along with every other import.
  - **Requires `@verajs/renderer` 0.3.0 or later**, the first with the `./namespaces` entry.
  - **The `svg` and `mathml` options are removed** — the compiler no longer decides a namespace, so
    there is nothing for them to name.
  - **`@verajs/jsx/standalone` is a module loader.** `<script type="text/vera-jsx">` blocks, inline or
    `src`, run as real ES modules, and a file they import — `.jsx` or `.js`, relatively — is loaded
    the same way, so a self-hosted buildless app is ordinary files beside its page and a three-entry
    import map (`@verajs/core`, `@verajs/renderer`, `@verajs/jsx`). `import()` in any form — a template
    literal, a computed path, a full same-site URL, with options — `import.meta.url`,
    `import.meta.resolve`, a JSON or CSS module and a file behind a redirect all resolve as written, and
    a package name in them resolves through the map exactly as from the file itself. Any `@verajs/renderer/<entry>` —
    the helpers compiled JSX imports, and `slots` or `tag` if the app imports them — is found beside
    wherever the map puts `@verajs/renderer`, so copy the renderer's whole `dist` folder. The
    compiler is loaded only when something must compile, and each file's compiled output — an inline
    block's too — is kept in `localStorage` and reused only for the exact text it came from (a
    fingerprint of the file, not a server header), so a repeat visit compiles nothing on any static
    server; a plain `.js` file keeps only where its imports are, never its text. A circular import is reported
    with its chain, a missing file names the file that imported it, and a renderer helper missing
    from beside the renderer is named. The entry is 2 236 B gzipped, down from 5 933 in 0.3.2, plus
    the 5 737 B compiler on a visit that compiles. It no longer exports `transformJsx`; import that from `@verajs/jsx`.
  
  **Fixed in the compiler along the way** — each of these produced a module that died or silently
  lost its JSX:
  
  - an injected import is renamed around a name the module already binds — a destructured binding, a
    second declarator, a parameter, a TypeScript annotation — instead of colliding with it;
  - `import html from './x'` from another module is a binding, not the tag;
  - string, template-literal and regular-expression contents are never read as code, including a
    nested template literal and a regex at statement position;
  - a TypeScript postfix `!` ends an expression, a keyword before `!` is a prefix, and a TSX type
    parameter list (`<T extends object = {}>`) is never markup;
  - `hidden=""` and a literal `checked` mean true, an empty attribute expression is an error with a
    position, and an injected import goes under a hashbang rather than above it;
  - `<annotation-xml>` is not a custom element though its name has a dash, so its `encoding` stays an
    attribute the parser can read.
  
  **`@verajs/renderer`: development names a namespace mismatch.** An element built in one namespace and
  placed where the parser would have used another — a hand-written `` html`<path/>` `` handed into an
  `<svg>` with the resolver not wired, or a `` mathml`…` `` in an `<svg>` — is named once, with the
  remedy that fits it. Nothing of it survives minification.
  
  **`@verajs/inserts`: a `'template'` insert point**, called once when each template is built, which is
  how `@verajs/renderer/namespaces` plugs in.
- 8854735: Hooks run in exact priority order, and a non-finite priority is refused the same way in both builds — development says why
  
  **Fixes:** hooks were ordered by one number, `priority × 1e9 + a page-wide creation count`. Close fractional priorities
  could run in the wrong order (`50.000001` after `50.000002` once enough hooks were created between them), priorities
  above about 9 million collided, and on a page that had created a billion hooks a priority-50 hook was read as 51 — it
  ran after priority-51 hooks and a property arriving late no longer re-rendered it. Priority and creation order are now
  compared separately: any finite priority runs in exact order, then creation order within it.
  
  **A priority that is not a finite number** (`NaN` — what `parseInt` of a missing config value gives — `Infinity`,
  `-Infinity`): `useHook` and `createHook` register nothing and return `undefined`, in both builds, as before; development
  now also prints `[vera] … (priority-not-finite)` naming the call, where it used to say nothing. `wire` follows the same
  rule: it used to throw in development only and, in production, wire the entry and misbehave; it now refuses in both
  builds — nothing is wired — and development prints `(wire-priority)`. **In production the refusal is SILENT** (no
  message is shipped): an effect with a bad priority simply never runs, so check development's console.
- c300bb3: A module can own a key on a component's options: core hands `init({ host, … })`'s object to every `'init'` hook, and `wire` hands a connector itself
  
  **Feature (for module authors):** an `'init'` hook now receives the component's options object beside the element, or
  `undefined`. A module reads only its own key (slots reads `observeSlots`), and core never reads, copies or validates one.
  For the key's type, a module adds it to the global `VeraInitOptions` interface that `InitOptions` extends
  (`declare global { interface VeraInitOptions { myKey?: boolean } }`), so the key exists only where that module is
  imported. For development's unknown-option check, it sets `$keys` on its hook function. Two modules claiming one key are
  reported once (`option-claimed-twice`). An unknown key is ignored in both builds, as before, and development names it.
  
  **Feature:** a connector, a function `wire` calls with the registry, is now also handed `wire` itself, so a module made
  of several insert points can take options and still be wired bare, as `slots` does. Existing connectors ignore the second
  argument. Production core grows by 1 B.
- d220d2c: A throwing `&ref` reaches the `'error'` insert, and an error nothing handles reaches `window.onerror`
  
  **`@verajs/renderer`:** an element ref that threw was caught and printed with `console.error`, but
  never reached the `'error'` insert a throwing effect reaches, so an error boundary could not see it.
  It now goes through the same chain, handed the component being rendered (a shadow root resolves to
  its host), exactly as core hands a hook's error. The render still continues past it.
  
  **`@verajs/core` and `@verajs/renderer`:** with no `'error'` handler wired, a hook or ref error went to
  `console.error` alone — so `window.onerror`, error trackers and test runners that listen for page
  errors stayed silent while a component had stopped updating. It now goes to `reportError`, which
  fires the window's `error` event without unwinding, so one failure still never stops its siblings.
  Development prints the `[vera]` sentence beside it; off-browser, where there is no `reportError`, the
  console is used as before.
  
  **`@verajs/inserts`:** the `'error'` insert's documentation says what now reaches it.
- f96bfc4: `@verajs/renderer/elements`: attach behavior to elements in templates
  
  A new wired module. A claimant is an ordinary `'element'` insert, asked about each element of a
  template once — its tag and static attributes — and answering with a shared `{ mount?, unmount? }` or
  `undefined`. Every instance of the template runs `mount(element, { root, adopted })` once the render
  that created it has finished, with the tree in place, and `unmount(kept, element)` at teardown with
  what `mount` returned. `hold()` is not teardown; several claimants may claim one element. An app that
  wires no claimant pays nothing.
  
  ```js
  const autofocus = { mount: (element) => element.focus() };
  wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('autofocus') ? autofocus : undefined), priority: 50 }]);
  ```
  
  That example is a real platform gap: on Chromium, Firefox and WebKit only the first `autofocus`
  rendered after page load takes focus, so every later form an app shows ignores it.
  
  **`@verajs/renderer`:** an instance hook's `$m` now runs once the render that created the instance has
  finished, rather than straight after its first update, when the instance was still in a detached
  fragment. An instance torn down before its render ends never gets `$m`.
  
  **`@verajs/inserts`:** declares the `'element'` insert point.
- 2cea5ce: Light-DOM slots live in `@verajs/renderer/slots` — an app without them no longer ships their code
  
  **`@verajs/renderer` — breaking for custom slot strategies, which are retired.** Finding a template's `<slot>`s,
  mounting them after the first update, parking them at teardown and marking the render's own output
  in a light host all moved out of the renderer into `@verajs/renderer/slots`. The renderer keeps
  generic points they plug into: an **instance hook** a `'template'` hook may set on a template
  (`{ $c, $m, $q }` — called for every instance before its first update, once its render has finished, and at teardown,
  with nothing on the hot path for templates that have none). Slotted creation measures level with the renderer before this change on Chromium, Firefox
  and WebKit.
  
  **What it weighs, against 0.2.2, gzipped.** The renderer is 4 893 B (0.2.2: 4 679), now carrying the
  `'template'` hook `@verajs/renderer/namespaces` plugs into and the fixes below; an app that does not
  use slots is 7 403 B (7 141). The slots module is 3 874 B (3 424), and a slotted light component
  bundled with both is **10 831 B, up from 10 028 — about 800 B more** for the apps that use slots: the
  contract now crosses a bundle boundary, and those apps carry it.
  
  - `wire([renderer, slots])` is unchanged in what you write — but it needs `@verajs/core` 0.3.2 or
    later, whose `wire` accepts the nested array `slots` now is. An older core wires nothing from it,
    silently.
  - `slots` is now an array; code that read `slots.fn` or `slots.on` no longer finds them.
  - Development warns when the slots module and the renderer come from different versions of the
    package: they are one contract across a bundle boundary. An older slots module beside this
    renderer is treated as unwired in both builds — its fallback shows and nothing is lost.
  - `slotDiscovery` claims each `<slot>` through `@verajs/renderer/elements` (an `'element'` claimant)
    and carries `elements` with it; an app wiring `elements` for its own claims as well gets one
    module, not two. A `'template'` hook that sets an instance hook before `elements` is replaced, and
    development says so.
  
  **Fixed — also in 0.2.2: with slots wired, a light component's own top-level `${…}` lost its
  content on update.** `${busy ? spinner() : list()}` as a component's whole template rendered the
  spinner and then an empty host; a top-level list grew to one row of three. It hit components with
  no `<slot>` at all, because every light host is captured once slots is wired. A nested render during
  a slotted template's first update — a ref that renders a tooltip — no longer loses the slot's content
  either.
  
  **`@verajs/inserts` and `@verajs/core`: `wire` takes nested arrays**, so a module made of several
  descriptors and connectors is itself an array and sits in an app's list like any other module. The
  `Wireable` type names what `wire` accepts.

## 0.2.1

### Patch Changes

- 4bfee3e: Every public export now has a copyable call shape in its README
  
  An export-vs-docs audit over the true public surface (each exports entry's own declarations) found
  exports that were named in prose or tables but never appeared inside a code fence anywhere — a
  reader had no call to copy. `revision` and `inserts` (inserts), `collectionMethod` and `GLOBAL`
  (store, with the real five-argument insert signature and the fact that core calls the chain's
  first entry and caches it), and `adoptStyles`/`applyStyles` (styles) now carry fenced usage
  written against the source.

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
