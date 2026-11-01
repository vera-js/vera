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

- **In Chrome, the per-repetition time of a store-creating loop depends on how long the sample runs, and a single sample length hides it** (Chrome 156 headed, 2026-10-31). `createStore` with a nested read,
  200 per repetition (400 stores through one WeakMap), alone in its page, 3 fresh browsers each, µs per repetition, the rebuild / the released build / a build with no WeakMap on this path: 512 reps 52 / 86 / 55;
  1024 reps 62 / 101 / 53; 2048 reps 127 / 109 / 53; 4096 reps 101 / 107 / 53. So the same code beats the released build at three lengths and loses at one, and only the no-WeakMap build stays flat. A
  harness that calibrates reps per run can land on either side (1024 or 2048 here) and report the difference as a change in the code or in the rows before it: a bisect of earlier rows read "doubled" for groups
  that had only ever run at 2048. Cause not established (a collection schedule against an ephemeron table is the hypothesis; 205k stores is the smallest sample this could time, so a page-sized burst is
  unmeasured). Consequence: print a row's reps beside its value, force them when comparing across runs, and sweep them before calling a level a state. The same run shape found the row "61 µs" against a
  CDP-traced synchronous 4 s loop's "560 µs": a profiler or a trace in one long job is a different regime from the race, and its findings are about that instrument.

- **CORRECTS the entry above (2026-10-31, same evening): the per-repetition MEDIAN of that loop hid its cost, and the sample-length reading was about the median, not about what the code pays.** Chrome 156 headed, the same loop,
  alone in its page, 3 fresh browsers each, per repetition over warm-up + timed passes: the rebuild 126 / 335 / 255 / 279 µs at 512 / 1024 / 2048 / 4096 reps (its byte-identical copy 126 / 457 / 255 / 303), the previous build
  128 / 215 / 246 / 331, the build with no WeakMap on this path 55 / 54 / 54 / 53. Single passes of 1024 repetitions took up to 3.4 s on the rebuild and 2.5 s on the previous build, while the medians read 59 and 95 µs; the no-WeakMap
  build never spiked. So the previous build also moves, the medians of these two builds are unusable for this row, and earlier rows moved WHICH pass the pauses landed in (median 59 → 113 at the same total, on one copy; the byte-identical
  copy's total moved 2.4× in the same comparison, so that reading is not established). Cause not established: no GC trace was on, and a total cannot see a collection after the row ends or work on helper threads. Firefox and WebKit not
  measured this way. 205k stores is the smallest sample timed, so a page-sized burst is unmeasured. Consequence: a creation row's RATIO is only defined at its stated reps, and a row that allocates through a weak collection is read by
  total and per-pass values, never by a median alone. Earlier ratios read at unstated reps (0.848 vs the previous build) carry this. All of it ran as one job with no macrotask, a regime an app does not run in. ("The released build" in the entry above means this previous build.)

- **In Chrome, a WeakMap whose value strongly references its own key blocks for seconds under sustained creation; the same map with an unrelated value does not.** Chrome 156 headed, 2026-10-31, a blank page with no framework loaded, 3.68M objects in
  bursts of ~10,000 with a MessageChannel gap, garbage at once, 6 pages each, worst block by max(burst, gap): no WeakMap 1-48 ms; proxies kept nowhere 4-45 ms; `map.set(key, {})` 43-49 ms; `map.set(key, { t: key })` 521-1,699 ms;
  `map.set(key, new Proxy(key, handler))` 756-3,071 ms; `map.set(key, key)`, the value being the key itself, 846-3,002 ms; `map.set(key, new WeakRef(new Proxy(key, handler)))` 45-53 ms, though its typical burst is ~2.4x the strong proxy's (1.70 vs 0.70 ms). The blocks sit at stable positions, ~760k objects (~200 ms) and ~2.1-2.6M (the long one), and a store built that way (a raw-to-proxy weak cache) blocks at the same positions. So the value
  referencing its key is what does it, not proxies. The mechanism is not established, and no GC trace was on: candidates are an ephemeron table resolving the cycle by iterating, and entries whose value references the key surviving minor collections and piling up for a major one. Firefox 153 and WebKit 26.5, same run: the same two forms top out at 54-85 ms and 49-103 ms, against 10-19 and 55-58 ms for a plain value: tens of
  ms, read roughly on their coarse clocks. Consequence: a per-object raw-to-proxy weak cache pays this on Chrome: a ~200 ms block near 760k creations in a page's life and the long one near 2.1-2.6M. It says nothing about a page that creates far fewer, and retained objects were not measured. Evidence: reproducible from the description above, with a timed burst loop and one fresh headed browser per page.

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

- **Firefox penalizes the SIZE of core's `initWith` where V8 did not: a loop that never runs cost component creation.**
  Adding an `=== false` check (and an argument) to the `'init'`-insert loop inside `initWith` — on a page with no
  `'init'` insert, so the loop never ran — cost Firefox create20 +2.4% (6/6 sessions; Chrome −2.3%). One change undone per
  variant isolated it: without the new seams +2.6%, with the teardown back inline +3.7%, with the loop as before −1.0%.
  The loop moved out of line (a small function called only where inserts exist) measured +0.5%, slower in 6/12 sessions,
  inside the A/A — nothing. Consequence: `initWith` is size-sensitive on SpiderMonkey as `serializeValue` is on V8; keep
  rarely-run code out of it, and race a change to it on headed Firefox. (Headed Firefox 153 and Chrome 155; 2026-10-21)

- **The minifier inlines a function with ONE caller into that caller — and on Firefox that cost component creation and
  churn ~1–2%.** A refactor removed core's last exports of two small helpers (the render hook's builder and its
  registration), leaving each with one call site; terser then substituted both into `init`'s render path as nested
  immediately-invoked arrow functions. No source diff showed it — the hot code was unchanged; only the deleted exports
  differed. Restoring the exports as dead code, or marking the two calls `/*@__NOINLINE__*/`, made the helpers named
  functions again: class components bound through a template, create −2.2% and churn −1.1% (each faster in 8/8
  sessions, headed Firefox 153); renaming the mangled fields alone (three variants) moved nothing beyond ±0.6%. Whether
  Firefox pays for the closures each call allocates or for the caller's larger body (see the `initWith` entry above) is
  not separated. Consequence: removing a function's other callers changes what the minifier does to it — race a refactor
  that leaves a hot helper with one caller, and count the inlined-IIFE sites in a production bundle before and after.
  Chrome 155 and WebKit 26.5 with the same two marks: create −0.1% / +0.5%, churn +2.0% / 0.0% (slower in 3–6 of 8
  sessions, inside their A/As) — neither engine paid for the inlined form. (Headed Firefox 153, Chrome 155, Playwright
  WebKit 26.5; 2026-10-23.)

- **Moving a store object's subscription map from a WeakMap onto a field of the object made Firefox's cycle collector
  run a large collection far more often** — the map then hangs off the data by a plain field (data → map → cells → hooks
  → rows → DOM nodes), a path the collector must trace, where the WeakMap gave it an ephemeron edge. Churning an
  automatic list (create 10 000 rows, clear, × 30; a 10 s idle tail so the deferred collection lands in the profile),
  cycle-collector time from the Gecko profiler's CC markers: a large collection (> 800 ms) in **8 of 13** runs with the
  field against **3 of 13** with the WeakMap; median **1366 ms vs 119 ms**; elapsed time level. The field's gain was a
  ~15–25 ns cheaper lookup (Node), 2.5% of a Chrome row update. The instrument needed a positive control: 10 000 divs
  per round each holding a closure over itself showed 0 ms with a 4 s tail and the `js` feature alone, and 1686 ms
  with a 10 s tail and `js,stackwalk,memory` — a quiet CC reading means nothing until a control shows it can see CC.
  Consequence: a field that links data to the hooks that read it is a cycle-collector cost on Firefox even when the
  lookup is faster; the WeakMap stays (the field-versus-weak-collection rule: race it, both engines, with the CC
  measured). (Headed Firefox 153 via Playwright; 2026-10-24.)

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
- **Asking "can a setter run?" per write costs about the same however it is asked.** In a store's `set` trap, fetching
  the own descriptor (`Reflect.getOwnPropertyDescriptor`, one allocation) and calling `Object.prototype.__lookupSetter__`
  (no allocation, one builtin call) each cost a plain write ~8–10 ns over a per-object answer cached once: writes ran
  0.93–0.97 of the reference build either way, against 0.84 cached. Caching is not free either: computing it walks every
  own property once, which cost a fresh 10k-key record's first write 1.57×. Consequence: per-write asking, the exact
  `__lookupSetter__` form, was chosen for being smaller and exact, not faster. (Node, 7-round shuffled race against the
  reference build with a byte A/A ≤ 1%; 2026-10-28) **NODE ONLY — wrong for Chrome** (found the same day): in Chrome
  156 `__lookupSetter__` costs an owned-key write ~25% and a descriptor ~19%, against no check; see the entry below.
- **Gating a proxy `get` trap on `Object.getPrototypeOf(target)` is expensive; gating on `Array.isArray` is free.** In
  one store build, reading arrays without the receiver only when the prototype was `Array.prototype` cost an untracked
  record read 41% and a nested read 15%, while the same read gated on `Array.isArray(target)` alone cost records
  nothing (≤ 2.5%) and made a tracked index read 13% faster. Doing both checks (`Array.isArray` first) gave the array
  gain back. Why the prototype check costs so much was not established. Consequence: an exact "plain arrays only" gate
  is not affordable on the read path; see the decision it led to in the store. (Node, 5 fresh processes per arm,
  interleaved, byte A/A ≤ 1%; 2026-10-28)
- **Writing `-0` into an all-integer array converts the whole array to doubles.** V8 keeps an array of small integers in
  a packed SMI backing store; one `-0` is not a small integer, so the array is re-stored as doubles, a copy of every
  element. A store that compares with `===` before writing never writes `-0` over `0` (`0 === -0`), so it looks 13%
  faster on a 10k-item first write, while losing the `-0` (`Object.is(store[0], -0)` is false where a plain array says
  true); with values that are never `-0` the comparison store was the slower one (0.95). Consequence: a benchmark row
  that writes `-i` from `i = 0` measures this conversion, not the store. (Node, 5 fresh processes per arm; 2026-10-28)
- **A proxy trap call per array-method call was ~10% of a push-heavy row.** One shared `push` wrapper that finds its raw
  array with `this[RAW]` pays a whole `get` trap per call; remembering the receiver and raw array in the `get` that handed
  the method out (the read and the call are back to back) cut a 2000-push + splice row from 1.20× to 1.08× the
  reference build, whose wrapper is a closure made per read and captures the array. (Node, 5 fresh processes per arm;
  2026-10-28)
- **In Chrome, `Reflect.get` inside a proxy `get` trap costs a tracked array-index read ~10%, and the receiver has
  nothing to do with it.** One-line ablations of the same store (each deliberately wrong, to isolate one cost): the trap
  reading `Reflect.get(target, key, receiver)` 1.097 of the reference build, `Reflect.get(target, key)` 1.102, plain
  `target[key]` 0.988; a byte copy of the reference 1.001. So the call is the cost, not the receiver it passes.
  Consequence: a read that must run getters with the store as `this` pays it; a key that can carry no getter (an
  index) is read directly. (Chrome 156.0.8078.48, headless, a fresh browser per page, 5 repeats; 2026-10-28)
- **In Chrome, `Object.prototype.__lookupSetter__` costs ~25% of a write to a key the object owns, and Node's V8 did not
  show it.** The same store's `set` trap asking it per write: 1.027 of the reference build; no check at all 0.786;
  skipping it for owned keys 0.786; an own-descriptor check instead 0.973. Node 24.18.0 (V8 13.6.233.17) had measured
  the same call as costing a write ~8–10 ns, about what a descriptor costs. Consequence: Node's V8 is not Chrome's (version
  and build differ), so a Node measurement cannot clear even Chrome; a hot-path choice is made on the three browsers.
  (Chrome 156.0.8078.48, headless, a fresh browser per page, 5 repeats; 2026-10-28)
- **The three engines want three different store read paths, and no one design suits all of them.** Firefox charges ANY
  extra branch in a record's `get` trap (an `Array.isArray` test 6–7%, a digit-first-key test 5–7%, an out-of-line shared
  tail 24–31% on an untracked record read). Chrome charges `Reflect.get` on an array index ~9–10%. WebKit charges a SECOND,
  array-only handler ~5–9% on a tracked `length` read, whatever that handler's read does (direct, or the same exact
  `Reflect.get` the record handler uses), and a handler built by spreading the record one (`{ ...handler, get }`) worse
  than one written as its own literal (1.045 → 0.903 of the reference in one run). Consequence: the store's read path is
  a choice of which engine's row to concede, made by Brian with all three measured. (Chrome 156, Firefox 153, WebKit 26.5;
  headless, 4 rounds, fresh browser per page; 2026-10-28)
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
- **Firefox: an element field pointing into a reactive store's graph costs creation through the major GC** — the
  mechanism, CONFIRMED by its fix: a REMOVED DOM node keeps everything its fields reach alive until Firefox's cycle
  collector frees the node, so that graph survives every GC and is swept from the tenured heap. A class that drops its
  store field when removed recovered it (headless 756 → 682 ms against 645 for a store held only by the setup closure,
  which core already releases at teardown); releasing core's props record at a real removal measured headed Firefox
  −18% to −28% across class and `define` components (create and churn, 6 sessions, 0/6 slower; Chrome flat to +5% on
  one row). The original measurement follows. A component whose store (a vera `createStore` proxy) is reached only through its
  setup closure (the hook → its render closure) created 100k elements in 668 ms; the same component with the store on an
  element field read 772, a plain wrapper holding the store on the field 740, and the store in the closure with only its
  raw target on the element 757 (create1, four store reads per element). The Gecko profile puts the difference in the
  collector: major-GC sweep 184 → 803 ms while minor-GC time FELL (282 → 198 ms), heap at the end +264 MB; a gc probe
  releases every removed element (no leak); framework-free pages (prototype accessors, a symbol / string / own field, a
  Proxy field, nine expandos, a WeakMap-keyed proxy target) do not reproduce it. Reachability alone cannot explain it —
  the closure-held store is reachable from an element field too (the hook list) — so a short path from the field into
  the store's graph is what the arms isolate. Allocation-site pretenuring was checked and is NOT supported:
  SpiderMonkey's pretenuring report (`JS_GC_REPORT_PRETENURE`) prints only the parent process's sites under a
  multi-process Firefox; run with e10s off (diagnosis only), the framework's allocation sites pretenure identically in both
  arms. Consequence: release what a component's fields reach at its REAL removal (core's teardown swaps the props record
  for a plain copy and drops its store), as CLAUDE.md already says for DOM↔JS back-pointers — and measure it on Firefox. (Playwright Firefox 153 HEADLESS — provisional, 4 runs per arm; the profile 2 runs each; 2026-10-21)
- **Firefox reads a DOM element's own field by a COMPUTED key slower than by a literal name** — `this[KEY]`, whether KEY
  is a Symbol or a string built at load, against `this._name`. Measured on a custom element's
  `attributeChangedCallback` writing a store it caches on the element (100k elements, one attribute written per element
  per iteration): literal 229 ms, Symbol 244, computed string 251; Chrome 110–112 for all three; creation alone shows no
  difference. Moving `define`'s cached props store from a per-copy Symbol to a literal sigiled field took the same path
  from 247 to 226 ms and Chrome's defaults row from 386 to 366. Consequence: a field read on every access of a DOM object
  is a literal name — sigiled, so no production bundle mangles it — never a computed key; uniqueness across copies of a
  module comes from ownership (one class owns an element), not from the key. (Playwright Firefox 153 and installed
  Chrome, HEADLESS — provisional, 4 runs per arm; 2026-10-21)
- **A custom element created inside ANOTHER document upgrades in Chromium only.** A component defined in the main window
  is moved into a same-origin iframe's document (its own registry, as a pop-out window has) and its template then creates
  a child custom element defined only in the main window. Chromium upgrades the child (it renders); Firefox and WebKit
  leave it un-upgraded (`:defined` false, empty) — the iframe's registry does not know the tag. Moved back into the main
  document, the child upgrades in all three. Consequence for cross-window moves: a pop-out shows its components' children
  dead in Firefox and Safari until the panel returns, unless the pop-out defines the same tags or the renderer builds the
  child in the component's HOME realm and adopts it (decided in R4). (Chromium 151, Firefox 153, WebKit 26.5, Playwright
  headless; a platform behavior, not a timing; 2026-10-22)
- **REFINED (2026-10-25): what Chromium upgrades in another document is a child created by MARKUP inside a shadow root
  attached in the home document — nothing else, and no other engine.** Plain DOM, a host with a shadow root made in the
  main window and moved into a same-origin iframe or a `window.open` pop-out: `root.innerHTML = '<x-tag>'` upgrades with
  the main registry in Chromium (the root keeps the registry it was made with) and in neither Firefox nor WebKit. A child
  made in LIGHT DOM there, a node imported into the foreign document (`foreignDoc.importNode`), and a renderer render
  straight into a foreign host upgrade in NO engine; iframe and pop-out alike. An element created in the HOME document and
  then inserted into the foreign one KEEPS its home class in all three. Consequence: the renderer, for a target in a
  foreign document, creates in its own document and lets insertion adopt; that is the one path that works on every engine.
  Also measured: a same-document `moveBefore()` of an element WITHOUT `connectedMoveCallback` calls
  `disconnectedCallback` (with `isConnected` still `true`) and then `connectedCallback`, the same signature as a
  one-operation `append` move (Chromium, Firefox). (Installed Chrome 155, Playwright Firefox 153, WebKit 26.5, headless;
  behavior, not timing.)
- **`moveBefore()` and `connectedMoveCallback` ship in Chromium and Firefox, not in WebKit.** A same-document
  `moveBefore` of a connected custom element that defines `connectedMoveCallback` calls ONLY that callback (no disconnect
  or connect) in Chromium 151 and Firefox 153; WebKit 26.5 has no `Element.prototype.moveBefore`. Consequence: a component
  kept across `moveBefore` through `connectedMoveCallback` needs the existing one-operation move path on WebKit, and the
  callback's creation cost is measured on all three before any class gains it. (Playwright headless; 2026-10-22)
- **When the OPENER closes, a component its realm drives in a pop-out goes inert in Chromium and Firefox, and keeps
  working in WebKit.** A Vera component moved into a `window.open` pop-out works there (a click's store write
  re-renders). After the opener page is closed, the same click does nothing in Chromium 151 and Firefox 153 (no error, no
  re-render) and still updates in WebKit 26.5. Consequence: a panel left in a pop-out whose opener closed is the opener's
  realm's code; cross-window moves document it as unsupported rather than relying on WebKit's behavior. (Playwright
  headless; 2026-10-22)
- **Moving a shadow host into another document EMPTIES its root's `adoptedStyleSheets`, and moving it back does not
  restore them.** A shadow root in the main document adopts a constructed sheet; the host is appended into a same-origin
  iframe's document: the root's `adoptedStyleSheets` is now empty and the rule no longer applies; appended back into the
  main document, still empty and unstyled. Re-adopting the main document's sheet while in the iframe throws
  `NotAllowedError` (a constructed sheet's document must match). Chromium 151, Firefox 153 and WebKit 26.5 alike.
  Consequence: a component KEPT across a cross-document move must re-adopt its styles on every such move, both ways —
  a sheet made by the new document's realm (or a `<style>` fallback) there, the original sheet again on return. Today's
  re-setup on a cross-document move hides this. (Playwright headless; 2026-10-22)
- **A cross-document move drops focus; the selection range and an input's value survive.** A focused `<input>` (with a
  selection) inside a shadow root, its host moved into a same-origin iframe's document and back: focus is lost on the
  move and not restored on return; `selectionStart`/`selectionEnd` and `value` are kept. Chromium 151, Firefox 153,
  WebKit 26.5 alike. Consequence: an app that pops a panel out re-focuses it itself; the framework keeps the component,
  not the focus. (Playwright headless; 2026-10-22)
- **Defining `connectedMoveCallback` on a custom element class costs its creation nothing measurable** — unlike
  `adoptedCallback` (+7.4%, 2026-10-02). Twenty class component tags created 10 000 at a time, an empty
  `connectedMoveCallback` against none, the same core: Chrome −0.9% (slower in 2/6 sessions, A/A 0.2%), Firefox −1.0%
  (1/6, A/A 0.6%), WebKit −0.5% (3/6, A/A 0.2%) — NOTHING on all three, WebKit included although it does not ship
  `moveBefore`. Consequence: a component class may gain the callback for `moveBefore` moves without a creation cost.
  (Installed Chrome 155, Playwright Firefox 153 and WebKit 26.5, HEADED, 6 sessions, mirrored order, fresh browser per
  page; an earlier run at 500 elements per sample was too short to read — 1.7 ms samples — and was discarded; 2026-10-22)
- **V8 pretenures a CONSTANT object literal; a runtime-built object used as a WeakMap key pays the young-key cost.**
  A store created over `{ a: 1, b: 2, c: 3, d: 4 }` written in source ran a component's creation ~6–10% faster than the
  same store over the same values built any other way — a spread, `Object.assign`, a constructor, assignment into `{}`,
  a literal with computed values, a one-key literal grown by assignment (headless Chrome, iteration). With
  `--js-flags=--no-allocation-site-pretenuring` every variant tied. A differential profile put the gap in WeakMap
  inserts and lookups keyed by the record, and in GC. Keeping the store's proxy in a non-enumerable field ON a
  runtime-built record (no WeakMap entry) made `define`'s creation 12.9% faster on Chrome (headed, 6 sessions) — and
  12.6% faster than a hand-written class whose store came from a source literal. Firefox gained ~2%; but the same field
  on a record that starts EMPTY and grows afterwards cost Firefox +3–5% (headed, 6/6), so it is used only for a record
  built full. Consequence: a benchmark twin built from a source literal measures V8's literal allocation, not the code
  under test; and per-object data on a hot WeakMap is worth racing against a field, per engine. (Installed Chrome 155,
  Playwright Firefox 153; 2026-10-22)

- **A planted positive control's cost depends on the JIT tier, exactly as the code under test does — so a control sized
  from a tight-loop calibration under- or over-reads on the real path.** A fixed counted loop run once per row inside a
  hydration (36 iterations) read **+13%** on a 1k-row hydration that runs FIRST on a fresh page, while the plant is still
  unoptimized, and **+1.4%** on the 10k-row hydration right after it, by when it is optimized; a tight-loop calibration of
  the same function under-read the first row ~5x. Separately, a per-component-render plant sized from a tight loop to cost
  ~3% of a render read only **+0.7–0.9%** on WebKit's render path (while Firefox's read +4.3–4.8%, above its target).
  Consequence: size a control by a short pilot ON THE ROW IT GUARDS, per row and per engine, from what it READS; give each
  row its own size when rows sit in different tiers; count its calls; and treat a control that misses its target as a
  void run, not a weaker one. (Installed Chrome 155 headed, Playwright WebKit 26.5 and Firefox 153 headed; 2026-10-25)

- **Chrome runs a whole page at a per-PROCESS speed level, and on class-component rows with bindings that level spans
  ±6–8%.** Ten fresh headed Chrome instances on the same page and bundle (20 class components created or churned per
  sample, 30 samples) put the page's MEDIAN sample anywhere in a 11.5% range (create) or 15.8% (churn), while the collection
  spikes (one ~200 ms sample and a few of 120–150 ms) were the same on every page. So the spread between pages is a level
  the instance keeps for its whole life, not a collection landing in some windows; other rows on the same harness held their
  byte-identical copies within 0.2–1.2%. Consequence: on such rows a longer page does not average the noise out, only more
  fresh instances per variant do; a race there needs several pages per arm per session, or a quieter row, before a ~1–2%
  verdict is possible. The cause of the level (core placement, JIT tiering per process, memory layout) is not yet known.
  (Installed Chrome 155, headed, Apple-silicon laptop; 2026-10-25)

- **A `__proto__` key in an object literal puts V8 on a slow creation path** (Chrome 156, headless, 2026-10-31). The hook
  record built as `{ __proto__: RECORD, …17 fields }` (to share `run` / `stop` instead of a handle object): creating
  1,000 effects 2.6× slower, stopping them 3× slower, component creation 8–12% slower; Firefox and WebKit 7–9%. The same
  fields without the key are the fast boilerplate path. Consequence: a per-instance object on a hot creation path never
  gets its prototype through a literal `__proto__` (a class record cost Firefox +6% instead, c7b): measure first.
- **A NON-configurable property added to an existing object slows every later access on Firefox and WebKit** (Firefox
  153 / WebKit 26.5, headless, 2026-10-31): a store cached on its raw object by `Object.defineProperty(raw, SLOT,
  { value })` (defaults: non-configurable, non-writable) made an untracked read of that object 2.2× slower on Firefox and
  most reads 13–47% slower on both; the same field defined `configurable: true` read at parity. Consequence: an internal
  property added to a user's object is configurable, or it reshapes the object for good.
- **A row's timing depends on the rows that ran before it in the same page** (Chrome 156, headless, 2026-10-31).
  `computed` through the store's kit, a 20-deep chain settling on a write: 15–18% SLOWER than the current build when it
  ran after three other computed rows in one page, and 3% FASTER (3/4) alone in its own page; Chrome's CPU profile of
  an isolated page agreed (883–887 µs against 901–918). Earlier rows leave the engine's type feedback shaped by THEIR
  workloads, and the row inherits it. Firefox and WebKit not yet checked the same way. **Consequence:** a harness that
  runs many rows per page reports each row with its predecessors in it; a loss there is a hypothesis until the row is
  re-run alone (`ONLY=<row>` in the store bench), and every earlier many-rows-per-page verdict carries the caveat.

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
