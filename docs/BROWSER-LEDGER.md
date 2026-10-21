# Browser ledger

The browser and engine behaviors that shaped VeraJS's design and the way it is measured. **One entry per behavior**,
with the engines it was seen on, the date, the evidence, and the consequence. **The ledger only grows:** an entry that
turns out wrong is marked so and kept, with what replaced it.

The engines named are what was measured: installed **Chrome**; Playwright's **Firefox** and **WebKit** builds (WebKit is
the closest stand-in for Safari, not Safari itself); **jsdom**; **V8** and **SpiderMonkey** where the engine, not the
browser, is the cause. Measurement method (A/A copies, sample lengths, cooldowns) lives in `CLAUDE.md`. This file
records what the platforms DO.

**Every timed entry names its MODE** (headed, headless, Node, or "mode not recorded"), and dated entries name the
versions where known. **The 2026-10-18 entries were seen on installed Chrome 155.0.8059.84, Playwright Firefox 153.0 and
Playwright WebKit 26.5 (Playwright 1.62.1)**, on an Apple-silicon laptop with macOS App Nap DISABLED for Chrome
(`defaults write com.google.Chrome NSAppSleepDisabled`, set for timing and due to be undone). A headed-Chrome result
from another machine, or after that is undone, has a variable changed.

## The DOM and the HTML parser

- **The HTML parser foster-parents `<slot>` and custom elements out of table markup.** All engines. A `<slot>` or a
  `<my-row>` written inside `<table><tbody>` is moved out of the table when a template is parsed, so the slot and
  everything distributed into it land outside the table. Consequence: documented as a light-DOM slots limitation that
  holds in BOTH modes; the DOM benchmark's component rows are `<div>`s. (light-dom-slots.md; 2026-10-18)
- **Every real engine accepts attribute names jsdom rejects.** jsdom implements the XML Name production and throws on
  `a(b)`, `a|b`, `a?b` and ~50 more; Chrome, Firefox and WebKit reject only `a b`, `a>b`, `a=b`, `a/b`. Consequence: the
  spread denylist follows the engines; `tests/browser/spread-names.test.js` records their rule; a jsdom-only probe of
  attribute names is not evidence. (2026-09)
- **A custom element moved by one `insertBefore` stays connected through its reactions**: they run after the DOM
  operation completes, so `disconnectedCallback` reads `isConnected === true` and core keeps the component (measured:
  no re-init on a keyed swap, on every engine). Callbacks are captured when the element is DEFINED, so patching the
  prototype afterwards doesn't change what the engine calls (and a counter installed that way reads 0). (2026-10-18)
- **1000 `<div>` rows cost far more forced layout than 1000 table rows** on a move or a removal (swap 2 ms vs 1 ms in
  Chrome, 11 ms vs 2 ms in Firefox, with `offsetHeight` after each op), with script time equal. Since a custom element
  can't be a table row, comparing component rows against table rows under forced layout measures markup, not
  framework. (Headless; 2026-10-18)
- **A light slot that has content has stepped out of the page**, so `slot.parentNode.removeChild(slot)` finds no parent
  there. Consequence: slots gives each kept slot its own `remove()` / `replaceWith()`; the renderer and slots never
  call either on a node that can be a slot (they use `parentNode.removeChild`; `tests/slots-own-remove-invariant`
  enforces it); the filled-slot `removeChild` spelling is a listed known difference. (2026-10-18)
- **`assignedSlot` is a prototype getter, per window.** Answering it for light slots means a getter on `Element` and
  `Text` prototypes in each window, deferring to the platform's. Prototype-shape rules differ per engine, so its cost
  was raced on all three. Consequence: one getter per window, installed once, with a dev warning when unpatched.
  (83d0024; 2026-10-18)
- **A `MutationObserver` reports exact add/remove records**, and they are the same on every engine and in jsdom, so a
  DOM-operation COUNT can be taken in jsdom. Measured with it: a swap of rows 1 and 998 is 2 out + 2 in for Vera,
  Solid, Svelte, Preact and Vue; React moves 997 + 997; Lit adds marker nodes. (2026-10-18)
- **A part that receives the same value skips its DOM write** (attribute `value === committed`; text writes only on
  change), so a re-render that changes nothing costs dispatch, not DOM. (renderer.ts; measured 2026-10-18)

## Rendering, frames and timing

- **Headless browsers are not real compositors.** Playwright's `firefox.launch()` / `webkit.launch()` are headless by
  default; a headless browser's frames are not tied to a display, so a paint or layout row there may measure no paint.
  Consequence: timing runs headed; headless is for profiling and jitless iteration. For create1k, Firefox and WebKit
  script / forced-layout / to-paint times agreed within ~1 ms headed vs headless, but that is one workload, not a
  licence. (Headed vs headless, 2026-10-18)
- **Headed Chrome counts whole frames on heavy work timed to paint**: create 10 000 rows read ~220 or ~445 ms by
  session, clearing them 35 or 70, for every framework alike. **WebKit paints at frame cadence**: create 1 000 rows to
  paint reads ~41 ms for every implementation. Consequence: heavy rows are timed as script + DOM + forced layout with
  the frame wait outside the sample; to-paint is a reference column. (Chrome headed; WebKit headed and headless;
  2026-10-18)
- **Firefox's forced layout (`offsetHeight`) costs ~5 ms more than its own path to paint** on a 1 000-row create, for
  every framework equally, so it shifts absolute times, not rankings. (Headed and headless alike; 2026-10-18)
- **"See the DOM, then wait for the next paint" charges deferred work a frame it never cost.** A flush deferred to a
  frame paints IN that frame; starting the frame chain after noticing the DOM waits for the next one. Consequence: a
  fair to-paint measure starts the frame chain before the work, and from each frame's callback queues a task that asks
  whether the DOM was final when it painted. (2026-10-08; method reused 2026-10-18)
- **Event Timing** (`PerformanceObserver({ type: 'event' })`, the INP measure) reports `duration` in 8 ms steps. The
  DEFAULT `durationThreshold` is 104 ms; 16 ms is the lowest it can be set to, so an observer left at the default sees
  nothing faster. **WebKit doesn't implement it.** It is the ground truth for a real click on
  Chrome and Firefox, and coarse. (Headed; 2026-10-18)
- **Firefox and WebKit clamp `performance.now()` to whole milliseconds** (a fingerprinting defense) on an ordinary
  page; headed Chrome is 100 µs on a plain page and 5 µs isolated (measured, below). The clamp is CONDITIONAL: a cross-origin-isolated page (COOP `same-origin` + COEP
  `require-corp`) gets finer timers (Firefox ~20 µs, Chrome ~5 µs, per the engines' documentation, not yet measured
  here; WebKit unknown). **Measured 2026-10-18 (headed):** the smallest `performance.now()` step on a PLAIN page is
  0.1 ms in headed Chrome (not finer) and 1 ms in Firefox and WebKit; on an ISOLATED page it is 0.005 ms in Chrome and
  0.02 ms in Firefox and WebKit. **But isolation changes performance, not only the clock:** on Firefox, a 1000-row
  select ran 7% (Vera) and 13% (Solid) faster isolated, so cross-framework ratios moved. Consequence: isolation is a
  resolution tool for small-operation diagnostics; headline timing stays on plain pages, as users run them.
  One ~3 ms operation is mostly rounding there; a 50 ms sample resolves ~2%; two equal medians there mean "within the
  step", not zero. Consequence: samples are tens of ms; small operations repeat inside a time-boxed sample; an
  operation whose work changes with the run index (a growing label, a shrinking table) gets a FIXED repeat count, never
  a time box. (2026-09-27; 2026-10-18)
- **A new browser window's first seconds run slower** (headed Chrome: a swap sample 408 ms after 5 s of warm-up vs 482
  cold). Turning off Chrome's occlusion / background throttling (`--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) did NOT remove the run-to-run scatter,
  and a harness scoring each page by its total elapsed time (short pages, few samples) reported a 4% "win" and a 4%
  "loss" between byte-identical builds. The DOM benchmark's harness (median of repeats, longer pages with warm-up
  samples) held its A/A within ~1–2% in headed Chrome. WHICH of those differences matters is not yet isolated. (Headed;
  2026-10-18)

- **A short op timed alone, with the paint awaited inside its window, measures the frame, not the op.** The bench's
  create 1 000 rows read ~20–40 ms for every framework and clear swung its A/A 13–45%, because each sample was one op
  plus a wait for the next paint. Split into rounds (untimed prep and its paint, then ONLY the op timed, 20–40 rounds a
  sample), create 1 000 is 4–7 ms and the A/A agrees within 1–9%. Consequence: an op that cannot repeat on its own gets
  a split sample, never a one-shot one; `bench/dom/main.js` does this for clear and create 1k. (Chrome, Firefox,
  WebKit headless; 2026-10-18)

## Process and garbage

- **Same-site pages in one Firefox share a content process**, so one page's garbage is collected inside the next
  page's timed window, and a rotation that is the same every session pins each variant behind the same neighbor. The
  same happens between frameworks run one after another on ONE page (a byte-identical A/A split 5/5). Chrome isolates
  by SITE, so same-site pages may share a renderer process there too: UNVERIFIED for these harnesses, so verify
  rather than assume. Consequence: a fresh browser per page and per implementation, in a seeded order. (2026-10-16 /
  2026-10-17 / 2026-10-18)
- **Firefox's cycle collector, not its GC, frees a DOM↔JS cycle**: a closure stored on a node that closes over that
  node. At scale it shows as a late wall (CC slices up to 1.4 s around samples 100–125 of 150), invisible to V8, to
  heap counts and to jsdom. Consequence: per-element fields that close over the element are dropped at removal and
  rebuilt at reconnect (Firefox churn −48%); a back-pointer from a part to its node's DOM is nulled at release.
  Instrument: `MOZ_PROFILER_STARTUP` with GCSlice / CCSlice markers. (Firefox headless, Playwright default; 2026-10-11)
- **A WeakMap / WeakSet keyed by DOM nodes on a per-component hot path costs both engines' collectors per entry**
  (Firefox sweep + mark ~10% of shadow-component creation, Chrome ~9%). A field under a per-module-copy `Symbol` removed
  it, and core's `mine` WeakSet gave −5–6% the same way. NOT a rule: slots' node-keyed maps measured a tie as fields,
  and a missing-field read cost Firefox more than a WeakMap miss in one race (a hypothesis). Measured headless; to be
  re-confirmed headed. (2026-10-17)
- **Dropping a per-hook `WeakRef`** bought −3..−6% but cost Firefox's cycle collector +280 ms and lost a failsafe; kept.
  (Headless; 2026-10-17) **Not a property of strong links as such** (2026-10-19): a store design holding
  STRONG links from data to hooks, with exact unlinking on removal, left the same cycle-collector work, worst slice and
  suspect count as the WeakRef design it replaced, under the measurement below. The +280 ms belonged to that design.
- **Firefox runs the cycle collection a big churn needs AFTER the work, in long non-idle slices.** It started 60–130 ms
  after a GC finished (`reason GC_FINISHED`, `idle: false`). After 300 000 custom elements were created and removed, each
  holding framework state on the JS side, it took ~1 s in ~37 slices, ~25 of them over 16 ms and the worst 145–221 ms.
  The same churn with markup set through `innerHTML` and no JS state left none. Consequence: a churn's collector cost
  lands on the interaction AFTER it, invisible to a timed window, and a framework's DOM↔JS graph (3–4 CC suspects per
  component here) is a Firefox cost to design down. (Playwright Firefox headless; 2026-10-19)
- **A Gecko profile that ends soon after the work truncates the collector debt — and its markers have two traps.**
  (1) Closing the page ~200 ms after the work cut the CC above off in most runs (it showed in 5 of 48); an idle tail of
  4 s after the work captured it, and 8 s gave the same totals. Check that no CC marker is left unpaired at the end.
  (2) Start/end marker rows (phase 2 / 3) carry `0`, not `null`, on the missing side, so `endTime − startTime` turns
  them into absolute timestamps and negatives: pair them by name. And `GCMajor` is a SPAN from its first slice to
  completion with mutator time inside; its cost is the payload's `total_time` and `max_pause`. (Firefox; 2026-10-19)
- **jsdom's `MutationObserver` holds every observed node strongly** until `disconnect()`; browsers hold them weakly.
  Consequence: retention of anything an observer watches is measured in a real engine with CDP gc, never jsdom.
  (2026-10-07)
- **The platform keeps every `WeakRef` target alive until the current job ends**, and an async loop that never yields
  a macrotask is one job: a timing loop of `await render()` kept every render reachable (109 MB). Consequence: yield a
  macrotask every ~100 iterations, outside the timed region. (Node; 2026-09-28)
  **A SYNCHRONOUS loop is one job too, and it can reverse a comparison** (2026-10-18): a creation benchmark that ran 20
  rounds of 10 000 rows in one synchronous job charged every design that makes WeakRefs for 200 000 uncollectable rows.
  Today's store subscribed at 420–440 ns per row that way, against 236–241 yielding a macrotask between rounds; a
  WeakRef variant read 759–1150 against 412–451. The design without WeakRefs was unaffected, so it looked 28% faster at
  creation when, yielded, it was 10% SLOWER. Consequence: a creation benchmark yields a macrotask between rounds, as an
  app does between tasks. (Node; 2026-10-18)
- **A `const` binding keeps the last `WeakRef`'d object alive**, with no framework involved; so does the last call's
  objects in an async per-cycle function. Consequence: retention probes use a no-framework control. (Node; 2026-09-05)

## Custom elements

- **A custom element inside a CLOSED shadow root of a plain element hears that element's whole lifecycle.** A
  `<div>` with a closed root holding `<slot></slot>` and a custom element: attached → `connected`; moved in one operation
  → `disconnected` while still connected, then `connected`; removed → `disconnected` (not connected); re-attached →
  `connected`; moved into a document with no browsing context → `disconnected` while connected, then `connected` there.
  The light content renders through the slot unchanged, `host.shadowRoot` is `null` (closed), `host.children` is
  unchanged. Identical in Chromium 151, Firefox 153 and WebKit 26.5 (Playwright builds, headless; a correctness check, not
  a timing). Consequence: a plain element can be given an exact lifecycle with no MutationObserver and no polling — the
  candidate for core's plain-owner liveness. Only `attachShadow`-eligible elements (`div`, `span`, `p`, `section`, the
  sectioning and heading elements, custom names), and only once per element. (2026-10-21)
  **And it must have no box:** an element in the host's shadow tree is one of the host's LAYOUT children (the flat
  tree), so a visible sentinel in a flex host was laid out as a third flex item — each light child 4 px narrower, the gap
  shifted (Chromium; `tests/browser/native-elements.test.js`). `hidden` (`display: none`) removes it from layout; its
  callbacks need no box. With it, layout, computed style and `:empty` match a host with no sentinel in all three engines,
  and a `contenteditable` host still edits. (2026-10-21)
  **One thing it does change:** with a shadow root holding only a default `<slot>`, a DIRECT light child carrying a
  `slot` attribute (`<span slot="title">`) is assigned to no slot and renders nowhere (0 px wide); a deeper descendant
  with one renders normally. Identical in Chromium, Firefox and WebKit. Consequence: documented as a native-elements
  limit; document selectors, `:empty`, `:has()`, structural pseudo-classes and inheritance are unaffected. (2026-10-21)
- **A window fires `pagehide` (`persisted: false`) and then `unload` when its `<iframe>` is REMOVED from the parent page,
  and when a pop-out opened with `window.open` is CLOSED**, synchronously, with the listeners added from the PARENT
  realm. After the removal the iframe's `contentDocument` is `null`. Identical in Chromium 151, Firefox 153 and WebKit 26.5
  (Playwright builds, headless; a correctness check). Consequence: the components of a window that goes away can be
  retired exactly at that moment, with no timer or sweep; a `pagehide` with `persisted: true` (the back-forward cache) is
  a page that may come back and is left alone. (2026-10-21)

- **Defining `adoptedCallback` costs every element's creation** (+7.4% on create10k, 5/5 sessions): a lifecycle
  callback is engine work per instance. Consequence: never add one speculatively. (Mode not recorded; 2026-10-02)
- **Custom element upgrade, shadow DOM, `adoptedStyleSheets` and `@scope` are emulated or absent under jsdom.**
  Consequence: browser suites on all three engines are the release gate; jsdom is the regression net. (standing)

## The engines' compilers

- **V8 inlines a function only while its bytecode is ≤ `--max-inlined-bytecode-size` (460)**, so a hot function near
  the budget pays for ANY growth, even code that never runs (a never-taken `if` cost 4.0%). Consequence: move rarely
  run code out of line; `tests/ssr-inlining-budget.test.mjs` prints `serializeValue`'s headroom. Firefox and Safari
  inline on different rules. (Node; 2026-10-09)
- **Ablation switches inside a hot function change its inlining, so the instrument changes what it measures.** Four
  ablations of a store's `read` (each an env-switched branch in the same function) all "found nothing", because the
  switches themselves pushed `read` over the budget: `--trace-turbo-inlining` said "Cannot consider read for inlining
  (reason: 5)" for every one, while the baseline's `read` was inlined into its loop. A clean variant per hypothesis,
  with only the fast path inline, inlined again. Consequence: build one clean variant per hypothesis, and confirm with
  `--trace-turbo-inlining` that its hot function inlines like the baseline's before reading its number. (Node;
  2026-10-18)
  The same budget decides where a fast path may live: with the store's re-run "same read as last time" match moved out
  of line into its own function, a stable component's re-render paid a call per read (+28%); kept inline, with only the
  rare path out of line, it tied the baseline and `read` still inlined. (Node; 2026-10-18)
- **[CORRECTED 2026-10-19] What was measured, narrowed:** in Firefox (Playwright build, headless), a store's subscription
  records in the FLAT layout (`[count, hook, slot…]`) or with the first reader INLINE on the record, both unlinked by
  moving the last reader into the leaver's place, made the NEXT create of 10 000 rows after a large clear ~9% slower
  (203–212 ms vs 186–188). The FIRST create on a fresh page was unaffected (every layout within ~1%), and neither the
  split layout (objects and numbers in separate arrays, also moved on unlink) nor the inline layout unlinked by
  tombstones showed it. Cause not isolated. **The original claim below, that arrays interleaving objects and integers
  cost Firefox's cold code ~25%, is CONTRADICTED** (the inline layout has no mixed arrays and paid the same) and is kept
  only as the record: Firefox's cold code pays ~25% for arrays that interleave objects and small integers. The
  consequence that stands: race re-creation after a removal, not only a fresh page's first create, before choosing a
  layout. (2026-10-19)
- **`WeakRef.prototype.deref()` costs 17–18 ns on one target and 34–36 ns across 10 000 targets; a plain field read
  costs 1–6 ns.** A design that crosses a weak edge on every run therefore pays most of a ~25 ns-per-run win back: a
  store whose subscriptions reached each component through one shared WeakRef, read once per run, lost half of a
  500-reader fan-out gain (500 × ~24 ns). Consequence: no WeakRef read on a per-run or per-wake path; weakness, where
  it is needed, comes from lifecycle (unlink at disconnect) plus an off-path sweep. (Node 24; 2026-10-18)
- **Reaching a function through a long-lived array costs creation even with no WeakRef**: a subscription record that
  found its function at `component.hooks[slot]`, instead of holding it, cost creation +39% and about 15% of the write
  gains. Cause not isolated; hypothesis: one long-lived array holding thousands of young functions (old→young pointers
  the generational collector must track). Consequence: a hot record holds what it calls. (Node; 2026-10-18)
- **Variants timed in ONE process share call sites, so the first variant runs monomorphic and every later one
  polymorphic.** In a micro-benchmark running seven designs through shared shape functions, a read path with code
  identical to the baseline's measured +25%, and the first-place verdict between two designs inverted once each ran in
  its own process. Consequence: one fresh process per variant (`ONLY=<i>`), as browsers need a fresh browser per page.
  (Node; 2026-10-18)
- **A Map key built by a template string on every call makes the measurement unstable**: a benchmark writing
  `` o[`f${i}`] `` swung its own baseline's median 70–690 ns between processes. Building the keys once narrowed it, but the
  baseline stayed bimodal (27 or 75 ns by process); cause not isolated, so that row was dropped from every verdict.
  Consequence: build keys outside the timed loop, and treat a bimodal baseline as an unusable row. (Node; 2026-10-18)
- **In V8, an arrow that captures a parameter allocates a context on every call of the enclosing function, a sparse
  array walks the prototype chain on holes, and an EXPORTED module binding is read less directly than a module-local
  one** (3–8% steady, 8–14% over the first 100 calls). Consequence: plain loops and dense arrays in hot functions; hot
  constants module-local with a separate exported alias. (Node; 2026-10-01)
- **"Allocation site tenuring changed" deopts follow the allocation, not the function**: moving the code moved the
  deopt, not the cost. Instrument: `--log-code --log-deopt` through Chrome's `--js-flags` (renderer stdout is closed on
  macOS, so `--trace-opt` prints nothing). (Chrome, mode not recorded; 2026-10-11)
- **Engine shape advice is a hypothesis.** Giving every cursor a light cursor's extra fields "for monomorphism" cost
  Chrome +14% on pages without the feature; an expando on every new `Set` cost Firefox creation +6–13%. It holds for
  SpiderMonkey and JSC too. Consequence: race it, weighting the common path. (Chrome headed / Firefox headless;
  2026-10-07 / 2026-10-10)
- **Fields declared at creation help objects that GAIN them later and cost objects that never do.** Declaring `key`
  and a reconcile stamp on every template result (so `keyed()` stops transitioning each object's shape) made building
  1000 rows 33% cheaper in Firefox in isolation, but on the real path it traded: keyed select −7% (Chrome) / −10%
  (Firefox), keyed CREATE +0.8% / +5.5%, and ~0 elsewhere. A fuller object costs at creation. Consequence: not landed;
  shape changes are raced on the real path, creation rows first. (Headless, 5 fresh-browser pairs; 2026-10-18)
- **A Proxy trap call has a floor in V8 that no trap body removes.** Walking 1000 indices of an array proxy: plain
  array 0.5 µs; a proxy with NO get trap 65; a trap returning `o[p]` 88–110; a trap returning `Reflect.get(o, p, r)`
  113–140. So a transparent proxy costs ~33 ns per read, and `Reflect.get` with a receiver adds ~22%. How the handler
  object was built made no difference (a literal and one assembled by `Object.assign` cost the same). Consequence: a
  hot walk over store data must read the RAW data, never through the proxy; and only reads that may meet an accessor
  pay for the receiver. (Node; 2026-10-18)
- **A helper shared by every object in an app goes megamorphic in the browser, and can be slower than the WeakMap it
  replaced, while the same code is faster in Node.** A Symbol-field read in one shared `cached()` sped every
  through-proxy read in Node (index 67 → 63 ns) and cost Chrome's store-list swap +12% and remove +6%, because in the
  benchmark page rows, arrays, the root state and the selection store all meet that one load. Reading the field at the
  walk's OWN site (it only meets one list's items) removed the cost. Consequence: a hot read that sees one kind of
  object gets its own site; check a DRY helper on a hot path against a page with many object shapes, not a probe with
  one. (Chrome headless, 2026-10-18)
- **Firefox pays more than Chrome for a WeakMap lookup on a hot path.** Caching a store row's proxy on the row under
  a private Symbol, instead of in a WeakMap, made Firefox's store-list swap −29% and remove −24%, against Chrome's
  −10% / −10%. Same direction as the renderer's root-part WeakMap (2026-10-17). (Headless, both; 2026-10-18)
- **A proxy stored INSIDE raw data makes every later read of that slot a trap the engine cannot cache.** After a swap
  wrote store proxies into a raw array, the walk's field read met a proxy in two of 1000 slots, and Chrome's swap paid
  +9% for it. Consequence: a store stores raw objects, never proxies (2026-10-18). (Chrome headless)
- **A timing window after a fixed warm-up measures WHEN V8 tiers up.** A faster build sat in a middle tier for calls
  20–80 and read 28% slower over exactly that window. Consequence: report the cold total and a steady time, and the
  per-batch curve when they disagree. (Node; 2026-10-01)
- **Writing `NaN` into a field that has only ever held small integers changes the field's representation** — every
  object of that shape is migrated, and code that read the field as a small integer deoptimizes. Measured on the hook
  record's generation field, written `NaN` as an "inert" marker at the end of a server render: the first 200 renders of
  a small page +8% against the base where the same marker written as `-1` was +4% (eight fresh processes per variant, a
  balanced order, the core's hash checked per process). Consequence: a sentinel in an integer field is an out-of-range
  small integer, never `NaN` (or any non-integer). (Node 24, V8; 2026-10-21)

## Test environments

- **Inspecting a cross-realm DOM object (an iframe's `ShadowRoot`) in a chai failure message never finishes**, so a
  failing browser assertion reads as a suite TIMEOUT. Consequence: assert booleans for values from another document.
  (2026-10-01)
- **jsdom answered a NESTED host's child for `querySelector(':scope > …')`** on a page custom elements built.
  Consequence: probes read direct children with `[...el.children]`. (2026-10-02)
- **Linux WebKit exposes `PublicKeyCredential`, macOS WebKit does not**; a recorded DOM surface must not depend on it.
  (`tests/dom-surface.mjs`)

## Competitors, as their own benchmark entries write them

For a fair race (each written the way that framework's own js-framework-benchmark keyed entry writes it):
- **Solid:** compiled JSX with a selector and a signal per label. Its hyperscript build re-runs every row on a select.
- **Vue:** a compiled template with `v-memo`. Its idiomatic `:class` renders `class=""` on unselected rows.
- **Svelte 5:** runes and `$state.raw`. In legacy mode over a deep `$state`, a swap or a remove re-ran every row.
- **Van.js 1.6:** per-row states, with DOM updates on a microtask.
- **React:** a swap moves every row in between.
(2026-10-18)
