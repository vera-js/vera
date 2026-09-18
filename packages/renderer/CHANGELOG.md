# @verajs/renderer

## 0.2.2

### Patch Changes

- 3e72abd: A boolean child renders nothing in JSX, and is named in a template
  
  `{items.length > 0 && <em/>}` is the most common JSX conditional, and when the test failed it put
  the word "false" on the page. Each grammar now answers the way its own users expect.
  
  **JSX drops it**, React's rule. The transform filters child expressions — element children and a
  component's children alike — through a module-local helper, so the value reaching the renderer and
  `@verajs/ssr` is `null`, which both already drop: no renderer change, no serializer change, and no
  new import specifier. Only booleans, so `{0 && <x/>}` still renders `0` exactly as React does. A
  module that compiles no JSX children carries none of it, and the helper steps aside if your module
  already uses the name.
  
  **A template keeps lit's behaviour exactly** — anything not nullish renders — and development now
  names a boolean child at the binding, once per distinct value. That is the one value semantic on
  which JSX and a hand-written template differ, so the warning is also what meets JSX-shaped code
  pasted into a template. Production carries neither the check nor the message: the renderer bundle
  is byte-identical.
  
  Measured: the filter's cost is below the noise floor in all three engines.
- d490915: `spread()` accepts a props type declared as an `interface`
  
  `spread()` was typed `Record<string, unknown>`, which a TypeScript **interface** does not satisfy —
  a type alias carries an implicit index signature and an interface does not. So a user who declared
  their props the way the TypeScript handbook teaches got `TS2345: Index signature for type 'string'
  is missing in type 'CardProps'`, while the sibling `props()` accepted the identical value because
  it is generic. Two functions in one module disagreeing about the caller's own type is not something
  people report as a bug; they stop using the one that refused them.
  
  The parameter is now `object | null | undefined`. Nullish stays admissible deliberately: JSX
  compiles `{...maybe}` straight to a call here, and the runtime already answers a bad bag with a
  development warning rather than a throw, so narrowing the type would move that failure to compile
  time for a pattern the runtime tolerates on purpose.
  
  Type-only — the bundle is byte-identical, and every call that compiled before still does.

## 0.2.1

### Patch Changes

- 4bfee3e: Components receive bound properties with no declaration
  
  A parent binds properties — `.date=${…}` in a template, `props({ date })` in either surface, a
  sigil-keyed spread bag — and the component reads them off `this`, reactively: a read in a render
  is tracked, the parent's next commit lands in the setter and re-renders, and stores and refs
  arrive by identity and stay live. No `static properties`, no props argument to `init()`, no
  `declare`.
  
  `props()` is the new `@verajs/renderer/spread` export: a typed bag of property bindings
  (`props<CalendarDay>({ dat })` is a compile error naming the misspelling), one call in template
  and JSX alike, idempotent under the JSX compilation shape `spread(props({…}))`.
  
  Both arrival orders work. An eagerly-defined component's values are recorded before `init()` runs;
  a lazily-defined one's are recorded before upgrade and re-applied after it, which repairs the
  ES2022 class-field clobber in BOTH spellings (`item;` and `item = default`) — a bound value
  outranks a class default. A key arriving after `init()` — a hydrated child's late parent commit, a
  spread bag growing a key — is adopted live and re-runs only the render hooks, never effects.
  A class declaring its own `get`/`set` pair keeps it: values arrive through the setter, and a
  getter with no setter refuses the binding by name in development instead of throwing — one rule
  in every arrival order. Platform properties (`title`, `id`, `slot`, `style`) land on the platform
  accessors that own them; elements that never call `init()` get plain writes exactly as before,
  with the pre-upgrade clobber warning now firing once per binding instead of once per commit.
  
  Measured: production custom-element property commits are unchanged in all three engines;
  development commits got 3–8× faster (the old clobber detector ran `customElements.get` per
  commit; detection now costs one subscription per binding).

## 0.2.0

### Minor Changes

- 29cc8db: `keyed()` moves to `@verajs/renderer/keyed`
  
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
- 0a9617b: `render(result, container)` is now `renderInto(result, container)`, in `@verajs/renderer`,
  `@verajs/renderer/hydrate` and `@verajs/renderer/profiler` alike.
  
  ```js
  import { renderInto } from '@verajs/renderer';
  renderInto(html`<p>${count}</p>`, document.querySelector('#app'));
  ```
  
  Nothing else changes: same signature, same lit-html argument order, same behaviour. `wire([renderer])`
  registers this function, so a component's `render()` still ends up here.
  
  **Why.** `render` named two different public functions. Core's takes a template *function*, subscribes
  it to every store it reads, and commits a component's setup; the renderer's takes a template *result*
  and a container, and writes once. Both were documented, so a reader who knew one misread the other.
  
  `renderElement` and `renderDom` were considered and rejected — this renders *into* a container, not
  *an* element, and the container is a `Node`, so a shadow root and a fragment are both valid and
  "element" would be a lie in the type. `renderIn` reads identically to `renderLn` in most sans-serif
  faces.
  
  `tests/docs-moved-render.test.mjs` guards it, because `tests/docs-removed-apis.test.mjs` structurally
  cannot: that list is keyed by name, and `render` still exists — in the other package.
- eb35664: Move `spread` into `@verajs/renderer/spread`. **Breaking:** `@verajs/spread` is retired.
  
  ```js
  - import { spread } from '@verajs/spread';
  + import { spread } from '@verajs/renderer/spread';
  ```
  
  Nothing about the implementation changes. It extends the renderer's template language and speaks the
  renderer's `_$apply$` protocol, so a separate top-level name put it where nobody would look for it.
  A package earns its own name when it is a capability you install on purpose; a primitive extending
  something else's surface belongs as an entry in that thing.
  
  It is the one renderer entry that is **additive** rather than a substitute. The others inline
  `./renderer.js` and carry their own template cache, so two must never load together; this one
  imports nothing at all and is safe alongside any of them.
  
  `@verajs/jsx` emits the new specifier for `{...props}`, configurable as before.

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
- 664d20f: Report an expression in attribute-name position, as the server already did
  
  `<b ${name}="x">` is not a dynamic attribute name. The marker is not preceded by `=`, so it reads as
  an element ref, and the `="x"` after it stays literal markup — the parser then makes `<b ="x"="">`
  out of it, attributes nobody wrote. `<b data-${n}="1">` and `<b a${n}b="1">` are the same mistake in
  the middle of a name.
  
  `@verajs/ssr` already refused this and its README called it *"malformed on both sides"*, but only the
  server acted on it. So a developer rendering in a browser saw malformed output with no clue, and
  adding SSR later turned the same code into a throw with no obvious connection to what they wrote.
  
  The renderer now reports it and names `@verajs/renderer/spread`, which exists for names that are not
  known until runtime.
  
  An element ref is the *legitimate* reading of an expression in that position, so the two are told
  apart by what follows: a ref is always followed by whitespace, `>` or `/`. Every ref form is asserted
  to stay silent, which matters more than the cases — a diagnostic firing on every `ref` would be
  unusable.
  
  `__DEV__`-only; production carries neither the check nor the message.
- 7908b35: Server and client agree on how a value inside an attribute becomes a string
  
  Two divergences, found by enumerating coercion across every position rather than picking cases. Both
  are the class `CLAUDE.md` calls the worst in this package: the two sides disagree about something
  neither of them renders, so nothing fails until a hydration mismatch turns up somewhere else.
  
  **A value interpolated inside a quoted attribute took the child-position rule.** `<p title="a ${x} b">`
  reaches the compiler as TEXT — there is no sigil and no `name=` tail to match — and was emitted into
  the stream with the rule that *renders* a value: an array iterated to `a 12 b` where the browser,
  which builds the string and calls `setAttribute`, produces `a 1,2 b`; a `Set` to `a 12 b` against
  `a [object Set] b`; a function vanished where the client writes its source; a template result served
  its markup into an attribute value. Every one of those is the list already written in
  `serializeValue`'s own comment — they were corrected for `title=${x}` and the branch with static text
  beside it kept them. One rule, two branches, and only one was fixed.
  
  **A symbol was special-cased into markup no client could reproduce.** `String(value)` and
  `` `${value}` `` are the same operation for every input except a symbol, which `String` alone turns
  into its description instead of throwing. So the server served `Symbol(s)` while every DOM conversion
  on the client throws — and the client disagreed with *itself*: `title=${symbol}` threw while
  `title="a ${symbol} b"` quietly rendered `a Symbol(s) b`, the same sigil on the same attribute,
  behaving differently depending on whether static text sat beside it. Both sides now refuse it, which
  is what the platform does.
  
  The function-at-a-text-position difference is untouched and still deliberate — it is in the SSR
  README's list, and `tests/render-exotic-values-parity.test.mjs` now fails if that sentence
  disappears, so a documented divergence cannot quietly stop being documented.
  
  2 B gzipped on `@verajs/renderer`; `@verajs/ssr` ships no bundle.
  
  ## If you render server-side without hydrating
  
  Every change above makes the server agree with the client, so a **hydrating** app sees the same page
  it always saw — the difference was the mismatch, and the mismatch is what went away. A **static** SSR
  consumer has no client to agree with, and for them these are visible output changes:
  
  | written | before | now |
  | --- | --- | --- |
  | `<input .value=${undefined}>` | `<input>` | `<input value="undefined">` |
  | `<textarea .value=${true}>` | empty | `true` |
  | `<p title="a ${[1, 2]} b">` | `a 12 b` | `a 1,2 b` |
  | `${Symbol('s')}` at any position | `Symbol(s)` | **throws** |
  
  Each new answer is the one a browser gives, which is why it changed — but `undefined` becoming the
  visible text `"undefined"` is a surprise worth knowing about rather than discovering. It was always
  what the client showed after hydration; only the server was hiding it.
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
- 74ff390: Hydration no longer gives up on a template containing an HTML comment.
  
  The adoption walk is `ELEMENT | TEXT`, and part indices are numbered by that same walker, so a
  comment is structurally invisible to it — but the live DOM still has one. `html\`<p>a<!-- n -->b</p>\``
  adopted as text/comment/text where the walk wanted one run of text, and a trailing comment left a
  child the walk never asked for. Both read as a disagreement, so **every template containing a
  comment lost hydration**: the server's markup discarded and re-rendered, for markup the client had
  itself produced. Nothing failed — the page is correct either way, which is why it went unnoticed —
  but the cost was the first paint the server render was paid for.
  
  Comments are now outside the comparison in both directions, which is the symmetric reading of the
  same invisibility: a comment renders nothing, so neither a missing one nor a stray one can change
  what a reader sees.
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
- 400cf42: A binding wins over a static attribute of the same name, on both sides.
  
  An HTML parser keeps the **first** of a duplicate pair while `setAttribute` overwrites, so
  `<b title="a" title=${x}>` showed `a` on a server-rendered page and `b` in the browser — the same
  disagreement `foldSpread` was written to fix for spreads, now applied to anything that writes a name
  into a tag.
  
  The client had the other half of it. `?bool` and nullish attribute bindings skipped their DOM call on
  the first commit, on the reasoning that a fresh clone carries no such attribute — true unless the
  template statically carries one, which is exactly the case in question. `<b hidden ?hidden=${false}>`
  stayed hidden in the browser and was not hidden on the server. Both are unconditional now, which
  costs one DOM call per nullish binding on first render and makes the renderer 12 B smaller.
- 2ba9b02: `showProfiler()` now replaces its panel instead of stacking a second one.
  
  Two panels are positioned in the same corner, so they overlap and neither reads — but the failure was
  not cosmetic. Each panel owns a `setInterval` and each teardown calls `stopProfiling()`, which is
  global: closing the second stopped profiling for the first, which kept repainting a frozen report on
  its own timer with nothing to indicate it had stopped.
  
  The way a person reaches this is a console — `showProfiler()`, look at it, `showProfiler()` again —
  where the first return value is already gone, so that first interval could never be stopped at all.
  
  It replaces rather than returning the existing handle, so a second call's `options` take effect.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- 9b6bcae: `@event` accepts both listener shapes the platform accepts, and names one that cannot listen
  
  `addEventListener` takes **two** shapes — a function, and an object with a `handleEvent` method —
  and the second is not exotic: it is how a listener carries state without a closure, and lit-html
  supports it. `handleEvent` called `.call()` unconditionally, so the object form bound without
  complaint and then threw `this._handler.call is not a function` on **every** dispatch. Verified in
  Chromium, Firefox and WebKit that all three honour the object form, since jsdom is the regression net
  and never the oracle for something the platform decides.
  
  An event handler is also the most **deferred** call a template makes. Every other binding is checked
  when it commits; a listener is checked when a *user clicks*, which in development may be never — the
  same shape as the setters that used to accept `undefined` in silence. So a value that cannot listen
  is now named in development, at the binding, with the element and the sigil in the message, and is
  inert rather than raising from inside the framework on every click.
  
  `false` is deliberately allowed and silent: `@click=${enabled && onClick}` is the ordinary way to
  bind conditionally and already behaved correctly. `true` is produced by no idiom, so it is named
  along with strings, numbers and objects that cannot listen.
  
  Both published renderer entries were affected — `@verajs/renderer/hydrate` inlines its own copy — and
  both are covered. 13 B gzipped on `@verajs/renderer`, 12 B on `/hydrate`.
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
- 2a56474: The `hold` documentation no longer claims a scroll offset survives.
  
  It listed "a scroll offset" among what `hold` preserves. Every engine resets `scrollTop` to zero the
  moment an element leaves the document — measured on Chromium, Firefox and WebKit, which report `0`
  while the subtree is parked, `0` on return, and `0` even for a node moved directly between two
  attached parents. Nothing a directive does with the nodes can hold it, and lit's `cache()` cannot
  either, so the claim was impossible rather than unimplemented.
  
  Everything else it lists does survive, and is now asserted in a browser with a control that toggles
  the same subtree *without* `hold` — because the claim is not that state survives, it is that `hold`
  is what makes it survive.
  
  Documentation only; no behaviour changed.
- 4948985: `hydrate.ts` described the `<textarea>` carve-out as "the one respect in which a hydrated DOM is not
  byte-identical to a client-rendered one". There are four, and they share a cause: `@verajs/ssr`
  mirrors `.value`, `.checked` and `.selected` on form elements into markup, because markup is the only
  way form state reaches the client at all. The client sets those as properties and writes no
  attribute, exactly as a browser does, so the server's copy stays behind after adoption.
  
  The count is not pedantry — it is what makes the question answerable. A probe comparing a hydrated
  DOM against a client-rendered one flagged `<input ${spread({ '.value': … })}>` as a defect on the
  strength of the source saying there was only one such case. The list is now written out, and
  `tests/hydrate-parity.test.mjs` asserts both halves: those four differ, and nothing else does.
  
  No behaviour changed.
- 4de8f9e: The hydrate entry's `renderer` wirable now binds the hydrating render
  
  `@verajs/renderer/hydrate` re-exported the base entry's `renderer` descriptor verbatim, whose
  `fn` is the base, non-adopting `renderInto` — so the natural
  `import { renderer } from '@verajs/renderer/hydrate'; wire([renderer])` wired a renderer that
  never hydrated. The failure was silent by construction: a first render into a full container
  clears it and renders fresh, so the page looked right while every byte of the server's work was
  discarded. It survived because the docs taught the manual
  `wire({ on: 'render', fn: renderInto, priority: 50 })` form for hydration, so nothing exercised
  the descriptor path.
  
  The entry now exports its own `renderer`, `fn` bound to the adopting render (the rest of the
  descriptor is shared deliberately — `connect` operates on this bundle's copy of the renderer
  state, which both functions read), and its raw `renderInto` carries the same development-time
  wire-misuse guard as the base entry's. The header's promise — point the importmap at the hydrate
  bundle "and nothing else changes" — is true for `wire([renderer])` now.
  
  The docs and examples stop teaching the hand-built descriptor for our own renderer:
  `wire([renderer])` is the one wiring in every entry, and the kitchen sink's hydrating mode now
  goes through the descriptor, so the browser suite exercises this path for real. The manual form
  remains documented where it is the point — wiring a third-party renderer such as lit-html.
- 7271f32: A repeated key in a keyed list no longer crashes the render, or silently drops a row.
  
  Duplicate keys are documented as undefined behaviour and stay that way — which of two items keeps
  the existing node is not specified. Undefined has to mean *a list*, though, and it meant neither of
  these. The key-to-index map holds one index per key, so the second occurrence of a key found the
  slot the first had already consumed, and `Cannot read properties of null (reading '_element')` came
  out of three frames inside a private algorithm, naming nothing the caller wrote. Fixing only that
  revealed the worse half: the map is built once, and the head/tail branches consume items by moving
  the pointers without nulling anything, so a repeated key could hand the same item to two positions
  and the list rendered one row short of what it held — nothing thrown, page quietly wrong.
  
  Neither is reachable with unique keys. Both need a duplicate *and* a reorder *and* a new key in the
  same step, which is why they survived a suite that fuzzes every list mutation: they were found by
  fuzzing over a four-key alphabet so duplicates were constant rather than occasional.
  
  Development now warns once per render when a list repeats a key, since it behaves correctly in the
  common case and arbitrarily in the rest. `@verajs/renderer/keyed` grows 18 B gzipped.
- 308b40e: Two hot-path wins from the performance audit, found by counting DOM calls rather than timing
  
  - **A nullish attribute binding no longer issues a `removeAttribute` per element on first
    commit.** `class="${cond ? 'x' : null}"` on a fresh clone was one real DOM call per element per
    create — 1,000 no-ops in the 1,000-row benchmark — guarding against the one template shape that
    genuinely needs the removal (`<b title="a" title=${null}>`, where the parser keeps the first
    duplicate). Whether the template statically writes the attribute is now read off the parsed
    template once ever and carried on the part.
  - **The keyed reconciler's trailing fill batches into a fragment.** Every remaining item inserts
    before the same reference, so an append of 1,000 rows now costs one live-DOM insertion instead
    of 1,000 — the same batching the index-mode grow path always had.
  
  Measured on `bench/dom` (min of 21 sessions, machine held awake): create-1k 14.4 → 13.3 ms and
  append-1k 23.0 → 21.6 ms, both now fastest of the nine implementations; no other row moved
  outside noise. Costs 32 B gzipped on the counter app and 71 B on the keyed list (still under
  lit + repeat); the trade is surfaced in `docs/features/performance.md`, whose table and
  methodology (microtask scheduling in the bench implementations, matching Lit and Vue's flush
  model) are updated in the same pass.
- 0f9773f: A profiling session that observed nothing now says why
  
  `@verajs/renderer/profiler` and `@verajs/renderer/hydrate` are both drop-in replacements for the
  whole public API, and each bundles its own renderer with its own instrumentation hook. So an app can
  have one of them or the other, not both — **a hydrating app cannot be profiled**, and profiling one
  observes an instance nothing renders into.
  
  That much is a design consequence. The defect was its silence: a report of all zeros is exactly what a
  healthy idle app produces, so the one result that cannot be interpreted was the one being returned.
  Measured — a hydrating app driven through three renders reported `0 frames` while the page updated
  correctly.
  
  `formatReport` now explains a zero report where the confusion happens, naming the cause and the fact
  that `/hydrate` and this entry are mutually exclusive. A real session is untouched. The limitation is
  now in the renderer README and the profiler's own header rather than left to be inferred from "each
  re-exports the whole public API".
  
  Development-only, like the rest of this entry, which is not built for production at all.
- ad4a6eb: Stop shipping a development-only `WeakMap` to production
  
  Every read of `_directiveSwaps` — the counter behind the "a child directive changed identity" warning
  — sits behind `__DEV__`, and the comment above it said production carried neither it nor a per-part
  slot to hold it. Half of that was true. A bare `new WeakMap()` at module scope is a constructor call
  the minifier must assume has side effects, so the dead branch took the *reads* and left the
  *allocation*: `vera-renderer.min.js` contained a literal `new WeakMap;` statement building an object
  nothing could reach.
  
  Marking it `/* @__PURE__ */` lets the branch take it along. 2 B off `@verajs/renderer` and 3 B off
  `@verajs/renderer/hydrate` — small, but it is an object allocated on every page load for a warning
  that build cannot print, and the comment claiming otherwise was the more expensive part.
  
  Found by sweeping all 14 production bundles for orphaned allocations after the same pattern turned up
  in `@verajs/core`; the sweep is now clean.
- 9897b14: A binding inside `<iframe>` or `<noscript>` no longer paints the renderer's marker onto the page.
  
  The renderer marks a child slot with `<?…>`, which a parser turns into a comment — except inside an
  element whose children it reads as text, where it stays characters and never becomes a part.
  `RAW_TEXT_TAGS` listed four such elements and there are six.
  
  - `html`<iframe>${v}</iframe>`` rendered the literal marker — `<?$v8hpsho$>` — and never updated, in
    **all three engines**.
  - `html`<noscript>${v}</noscript>`` did the same **in Firefox only**. A template's contents are parsed
    with the scripting flag disabled, which is what decides whether `noscript` is raw text, and
    Chromium and WebKit parse it as markup there while Firefox parses it as text. So an app developed
    in Chrome shipped the framework's internal syntax onto the page for Firefox users.
  
  `@verajs/ssr` was missing the same two, so its DOM built a tree no browser builds:
  `<noscript><img src="x"></noscript>` parsed to an element and `querySelectorAll('noscript img')`
  answered `1` where every engine answers `0`.
  
  Both lists were measured across Chromium, Firefox and WebKit rather than read off a spec — and jsdom
  is not the oracle here: it parses with scripting disabled, so it agreed with the old list about
  `noscript` while all three real engines disagreed with both.
- 0af7dc4: An element ref is told when its element goes away, and styles hoist once across copies
  
  **Refs are released.** A ref was told about attachment and never about detachment, so it kept a
  detached node alive and a component reading `myRef.value` after a subtree was replaced got the old
  element back. A function ref is now called with `null` and an object ref has `.value` set to `null`,
  which is also the hook an exit animation needs.
  
  The cost had to land only on templates that contain one. `_clear`'s bulk removal is what makes
  emptying a 1 000-row table ~5 ms against lit-html's ~22 ms, and walking parts on every removal is
  exactly the per-node work it exists to skip — so the scan records whether a template holds a `&` part
  and the walk is gated on that. Measured: `clear 1k` unchanged, +86 B gzipped.
  
  A **self-applying** value (`_$apply$`, which is how `@verajs/renderer/spread` ships) is deliberately
  not released: it receives the part and owns its own lifecycle, so writing through it here would be a
  second protocol contradicting the first.
  
  **Light-DOM styles hoist once per class however many copies of `@verajs/styles` are loaded.** A
  production `.min.js` inlines its dependencies, so two copies on a page each had their own
  "already hoisted" set and neither saw the other's: the same rules reached the document twice and the
  browser parsed and applied them twice for the life of the page. The mark now lives on the component
  class — the one object both copies can see — under a name exempt from property mangling. +20 B.
- b0586c6: DOM nodes render at a child position, and two server/client disagreements are fixed.
  
  `${someNode}` used to coerce to `[object HTMLSpanElement]`; it now renders the node itself, in
  arrays and `keyed()` lists too. That is what lets a template hold something another library owns — a
  charting canvas, a map container, an editor instance — without an element ref and a manual
  `append()`. It costs the renderer 23 B gzipped.
  
  `hydrate()` no longer throws on a value the server cannot have rendered. An opaque object at a child
  position reached a spread of a non-iterable and raised `TypeError: value is not iterable`, which
  escaped the mismatch guard and out of `render()` — where every other disagreement with the server
  degrades quietly to a clean client render. A client-only DOM node now adopts without giving up
  hydration at all: the server rendered nothing for it, so the node is inserted and the surrounding
  server DOM is still adopted in place.
  
  `@verajs/ssr` serializes `false` at a child position as the text `false`, matching the client
  renderer and lit-html. It used to emit nothing, so `${cond && 'x'}` produced different content on
  the two paths — invisible on a static page, and a discarded hydration on a server-rendered one.
- 67de0d4: `<select .value>` selects the right option, on both sides
  
  A `<select>` has no `value` content attribute — assigning the property *selects an option* — and
  neither half of the framework got this right.
  
  **The server wrote ` value="b"` on the `<select>` tag**, which no parser reads, leaving a control
  showing its first option. It now marks the matching `<option selected>`, which is what React's server
  renderer does; `@lit-labs/ssr` drops the binding entirely and serves the same wrong control we did.
  Matching follows the platform — the `value` attribute verbatim, otherwise the option's text stripped
  and collapsed, first match wins, and a `selected` the author wrote is cleared because a property
  assignment overrides markup. Asserted in Chromium, Firefox and WebKit, because every one of those
  rules is the platform's.
  
  **The client selected the wrong option, or none.** `.value` commits in document order, so when the
  options come from `${items.map(…)}` — the ordinary way to write a select — they did not exist yet and
  the assignment matched nothing: measured, index 0 instead of 1, and −1 when option values were
  themselves bound. **lit-html has the identical defect**, measured the same way. The assignment is now
  applied after the pass commits, and it is queued rather than dirty-checked because the options can be
  replaced while the value stays the same, which drops the selection just as thoroughly.
  
  One case has no fix and is now in the SSR README: a value matching **no** option leaves the client at
  `selectedIndex: -1` while a parsed `<select>` takes its first, and there is no markup for "none of
  them". `tests/ssr-select-parity.test.mjs` asserts that as a divergence, so closing it fails loudly.
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
- 8a8b156: Refuse a props bag that is not a plain object in **both** builds, not only in development.
  
  `spread`'s refusal sat inside `if (__DEV__)` alongside its warning, so the two builds behaved
  differently for the same code — and in the direction that hides the bug. Measured: `spread('text')`
  applies nothing in development, so an app under test looks correct; in production the string is
  iterated by character index and the element ends up with attributes named `0`, `1`, `2` and `3`.
  
  The message stays development-only, which is what `__DEV__` is for. The guard does not: a branch that
  changes what the program does cannot be dev-only, or the development build stops being a faithful
  model of the production one.
  
  Costs 27 B gzipped on `@verajs/renderer/spread` (842 → 869, measured A-B-A).
- 9daa900: A spread event key now honours the object listener shape, as `@event` already does
  
  `addEventListener` takes two shapes — a function, and an object with a `handleEvent` method — and
  the event-lifecycle pass taught the written `@event` binding the second one. The fix never travelled
  to `@verajs/renderer/spread`, which kept calling `.call()` unconditionally: the identical value
  fired through `@click=${listener}` and, through `spread({ onClick: listener })`, bound without
  complaint, never fired, and raised `this._handler.call is not a function` on **every** dispatch.
  Measured, not reasoned — the suite's function-handler control fired while the object shape threw.
  
  The dispatch now branches on shape exactly as `AttrPart.handleEvent` does, and development names a
  truthy value that cannot listen at the binding — where the mistake still is — rather than letting it
  surface on a user's click. `false` stays silent, since `{ onClick: enabled && onClick }` is the
  ordinary conditional form and already behaves correctly.
  
  14 B gzipped on the spread entry; the warning is `__DEV__`-only, so production carries the branch
  and none of the text.
- 9e16b35: Server and client agree about every value kind at a child position.
  
  `@verajs/ssr` returned `''` for any object that was not template-shaped, and the client has never
  agreed: a `Date` rendered its full date string there and nothing here, an object with a `toString`
  rendered its text, a `Set` or `Map` rendered its entries, a `Promise` rendered `[object Promise]`.
  Whether any of those is a sensible thing to interpolate is beside the point — the two sides
  disagreeing is a silent hydration mismatch. Iterables now render their entries and everything else
  falls through to `String(value)`, which is what the client does.
  
  `@verajs/renderer/hydrate` adopts them. A non-iterable object at a child position was a deliberate
  mismatch, because the server emitted nothing for it and the two could not be reconciled; once the
  server matched, that mismatch was the only thing left disagreeing.
  
  **A colon is legal in an attribute name.** `xml:lang=${…}` produced `<b xml: lang="en">` — the name
  pattern stopped at the colon, so the prefix was left as text and the tag came out malformed.
  `xml:`, `xlink:` and friends parse now, in templates and when attributes are read back out of
  emitted markup.
- 3aa976c: Scope the hydration-fallback warning to the container it happened in.
  
  It said "the server markup was discarded, so the page is correct but nothing the server rendered was
  used". Adoption is decided per container, so that is a page-wide claim about a per-container event —
  measured with three containers, one carrying markup the template does not describe: one warning
  prints and the other two adopt their server nodes unchanged.
  
  The difference is what the reader does next. Told the whole server render was wasted, they go looking
  for a page-wide cause — a bad doctype, a broken handoff, state that differs everywhere — when the
  message has already named the one element that disagreed. It now says this container was rebuilt,
  that its SSR `<style>` is kept (which `clearPreservingStyles` has always done), and that other
  containers are unaffected.
  
  No behaviour change; the isolation was already correct and is now tested and documented.

## 0.1.5

### Patch Changes

- fbfc58f: Support `<div ${spread(props)}>` — bindings whose names are not known when the template is parsed.
  
  New package `@verajs/spread`. Template renderers bake attribute names in at parse time, which is
  what makes them small and fast and why neither this renderer nor lit-html has had spread; lit's PR
  has been an open draft since 2021.
  
  `@verajs/renderer` gains a protocol rather than a feature: a value at element position carrying
  `_$apply$` applies itself, in 16 B, confined to the element position so nothing lands in the text,
  attribute or property commits the benchmarks measure. An in-renderer implementation measured 176 B.
  
  `@verajs/jsx` now compiles `{...props}` on an element to `${spread(props)}` and injects the import,
  where it used to be a compile error. `@verajs/ssr` serializes a spread: attributes, truthy booleans
  and the form properties reach markup; events and other properties are client state. The escaping
  stays entirely in `@verajs/ssr`, so a new binding source cannot introduce a second escape boundary.
  
  Removing a key restores what the element held before the binding existed, rather than guessing at a
  value that means absent — for a property there is none. On a hydrated page that means the server's
  markup; bind `null` to remove instead.
  
  Runtime is at parity with writing the bindings out.

## 0.1.4

### Patch Changes

- a5b3c36: Make the whole-parent `clear` fast path actually fire for lists inside templates.
  
  `ChildPart._clear()` replaces per-node removal with a single `parent.textContent = ''` when the
  part owns the parent's entire contents. Its condition was `_start` is the first child **and**
  `_end === null` — but since 0.1.2 a part nested in a template always owns an end marker, so
  `_end === null` only ever matched a *root* part. Every list written the ordinary way,
  `<tbody>${rows}</tbody>`, silently took the slow path.
  
  The condition now also accepts "`_end` is the last child", which is the same ownership property
  stated for a part that carries its own boundary, and both anchors are re-appended afterwards.
  Verified by counting `removeChild` calls: clearing 500 rows from a `<tbody>` went from 500
  individual removals to zero.
  
  Costs 9 B gzipped.
- 4534fb8: Report, in development, when a class field destroys a `.prop=${…}` binding at upgrade.
  
  A property set on a custom element that has not upgraded yet lands as an own property on the
  instance. When the definition arrives — lazily imported, code-split, or a module that simply had
  not run — `customElements.define` upgrades synchronously and the class's field initializers
  execute. At target ES2022, where `useDefineForClassFields` is on, a field declaration is a
  `[[Define]]`: `item?: Thing` emits `item;`, i.e.
  `Object.defineProperty(this, 'item', { value: undefined })`. The bound value is gone before the
  component reads it, nothing throws, and it reads as broken reactivity.
  
  Detection rather than repair, deliberately. Repairing it — re-applying the value once the
  definition existed — covered `item?: Thing` but not `item = someDefault`, which overwrites with the
  default and so never looks clobbered. That made one mistake behave two different ways depending on
  spelling, which is worse to diagnose than a consistent failure. It also cost 74 B in every app
  while leaving `declare` mandatory regardless, since a property assigned imperatively cannot be
  recovered by anyone: the renderer never saw it, and by the time `init()` runs the value is already
  gone.
  
  The check is `__DEV__`-only, so production carries no `whenDefined` subscription, no comparison and
  no message — `vera-renderer.min.js` is unchanged at 3 623 B gzipped, verified by asserting both the
  subscription and the message string are absent from the bundle.
  
  Write custom-element fields as `declare item?: Thing`, which emits nothing. An eslint rule and an
  `llms.txt` section now cover this too. Lit reached the same conclusion from the other direction —
  for them a class field permanently shadows the prototype accessor, so the property never updates
  again, and their development build throws (`lit.dev/msg/class-field-shadowing`).

## 0.1.3

### Patch Changes

- cbf56b2: Correct the published size figures and generate them from the build instead of maintaining them by
  hand. Every `~N KB gzip` claim in a package README is now produced by `scripts/sync-size-claims.mjs`
  from the actual `dist` bundle, and CI fails if any of them drifts.
- 090e845: Add `@verajs/renderer/profiler`, a development-only render profiler. It counts templates committed
  in place against templates that replaced a *different* template — which destroys and rebuilds the
  subtree while looking identical from the outside — and names the template pairs that churn, where
  they are, and how often. `formatReport()` prints a summary; `showProfiler()` mounts a live panel
  in the corner of the page for feedback while clicking through the app.
  
  Production is unaffected: the instrumentation sits behind a `__DEV__` constant the build folds
  away, and `vera-renderer.min.js` is byte-identical with and without it.

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
