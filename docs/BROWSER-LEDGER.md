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
- **Which `<script>` types run: the WHOLE type string, never a parameter.** Chromium 151, Firefox 153 and WebKit 26.5
  (Playwright, a served page; positive control `text/javascript` runs): `text/javascript; x=json`,
  `text/javascript;json`, `application/javascript ;charset=json` and `module; json` are all INERT (a parameter makes the
  string no JavaScript MIME essence match, as the spec reads it); `type=""` and an absent type with the obsolete
  `language="javascript"` RUN; `type=" "` is inert; `application/json` and `application/ld+json` are inert. Consequence:
  "the type ends in `json`" never names a script that runs, so it is a safe test for a JSON data block — and the server
  and the client must apply it to the same string (the whole attribute value). (2026-11-17)
- **`<![CDATA[` inside an SVG or MathML integration point: a CDATA section in Firefox and WebKit, a bogus comment in
  Chromium.** Playwright Chromium 151, Firefox 153 and WebKit 26.5 (headless), parsed by `<template>` and by a `<div>`'s
  `innerHTML` alike. In SVG `<title>`, `<desc>`, `<foreignObject>` and MathML `<mi>`, Firefox and WebKit make the
  content TEXT (`x`), Chromium a comment (`[CDATA[x]]`); jsdom (parse5) agrees with Chromium. In plain SVG content
  (`<g>`) and SVG `<style>`, all three make text. Firefox and WebKit read the spec as written: the tokenizer opens a CDATA
  section whenever the adjusted current node is not in the HTML namespace, and an integration point is still an SVG or
  MathML element. Consequence: a template hole inside CDATA in those elements is refused by `@verajs/lite` in Chromium
  (its marker is a comment's text) and filled as TEXT in Firefox and WebKit — safe in all three, never markup, but
  the verdict differs by engine; `tests/browser/lite.test.js` pins each engine's reading. (2026-11-18)
- **A `<style>`'s or `<script>`'s text is serialized verbatim, so a value written into one as text becomes markup after
  a round trip.** Chromium 151, Firefox 153 and WebKit 26.5 (Playwright, headless), and jsdom: an element's text set to
  `</style><img src=x onerror=…>` is inert in the live DOM, and `outerHTML` writes it back unescaped (the HTML
  serialization algorithm does not escape raw-text content), so parsing that markup again builds the `<img>`. Measured
  through `@verajs/lite` and `@verajs/core`'s renderer (a value in `<style>` and in a JSON data block: one `<img>` after a
  round trip, every engine, both builds) and `@verajs/static` (none: it writes `</style` as `<\/style` and `<` as
  `\u003c` in JSON, both lossless). Consequence: any code that saves or moves markup through `innerHTML`/`outerHTML` (an
  editor saving a page from the DOM) turns such a value into markup unless the renderer keeps raw text unable to end its
  element. (2026-11-18)
- **The HTML Sanitizer API (`Element.setHTML`) ships in Chromium 151 and Firefox 153, not in WebKit 26.5** (Playwright,
  headless; `typeof el.setHTML`, `typeof Sanitizer`). Its DEFAULT configuration drops a custom element whole, content
  and all (`<my-card>c</my-card>` → nothing); with a configuration object (`setHTML(markup, { sanitizer: {} })`, or
  `{ removeElements: [] }`) both keep custom elements, `data-*` and `<img>`, and still strip `<script>`, event-handler
  attributes and `javascript:` URLs (the safe baseline always applies). Consequence: it cannot be a renderer's only
  injection guard while Safari lacks it; it is the upgrade path for a string-rendering tier once WebKit ships it, and a
  custom-element page must pass a configuration. (2026-11-18)
- **`<!--<script>` inside a `<script>`'s text swallows the rest of the page; neutralizing `</script` alone does not
  stop it.** Chromium 151, Firefox 153 and WebKit 26.5 (Playwright, a parse only): `<script type="application/json">
  {"a":"<!--<script>"}</script><p id="after">` leaves no `#after` — the tokenizer's double-escaped script state ignores
  the `</script>` that should close it, so everything up to a LATER `</script>` becomes script text. A plain value, and
  `<!--` alone, leave the page intact (the controls). Consequence: anything that writes a value into a script's text
  on a SERVER (a JSON data block, JSON-LD) must neutralize `<!--` and `<script` as well as `</script` — for JSON, `<` as
  `\u003c` is valid and changes nothing. A client writing through `textContent` is not affected (no tokenizer).
  (2026-11-17)
- **A `<script>` parsed into a `<template>` never runs, however it reaches the document.** Chromium 151, Firefox 153
  and WebKit 26.5 (Playwright, headless): a template's script — in its statics, or with its text set after parsing —
  adopted, cloned (`cloneNode`) or imported (`importNode`) and inserted does not execute; a `createElement('script')` with
  the same text, inserted, does (the positive control). The parser marks it "already started", and cloning keeps the
  flag. Consequence: on the client a value bound into a script hole is inert text in every renderer here (core, lite,
  static); a script that must run would have to be RECREATED (a fresh element, its attributes copied, its text set). A
  SERVER-rendered page is different: the browser parses it as a document, and its scripts run on load.
  (2026-11-17) **WRONG for an SVG `<script>` (marked 2026-11-18, the entry below): it was measured on HTML scripts only.**
- **An SVG `<script>` parsed into a `<template>` DOES run when cloned or imported and inserted — in Chromium and WebKit.**
  Chromium 151 and WebKit 26.5 run `<svg><script>…</script></svg>` from a template's content, `cloneNode` and
  `importNode` alike; Firefox 153 does not (it runs one from `createContextualFragment`). The same probe's HTML
  `<script>` ran from none of them (only `createContextualFragment`, everywhere), and a `createElement('script')` ran
  (the positive control). Playwright, headless. Consequence: a value bound into an SVG script hole is CODE on the client
  in two of three engines, so a refusal that holds only in development, resting on the entry above, does not cover the
  SVG case; and on the server an SVG script's hole runs on load like any served script. (2026-11-18)
- **jsdom fosters text out of a table to the WRONG side: after the table, where every engine puts it before.** Text
  written directly inside `<table>` is foster-parented. Chromium 151, Firefox 153 and WebKit 26.5 (Playwright, headless,
  a parse only) insert it immediately BEFORE the table, in a `<template>` and in a `<div>` alike: `<!--m--><table>c</table>`
  parses as comment, `c`, table. jsdom 25.0.1 (parse5 7.2.0) appends it to a text node that already precedes the table
  (`v<table>c</table>` gives `vc` and the table, as the engines do), but otherwise puts it AFTER the table
  (`<table>c</table>` gives the table, then `c`). Consequence: a jsdom comparison of two renderers that differ only in
  whether a text node or a comment precedes the table reports a difference no engine has. Found by the small tiers' parity
  fuzz, where static (a value written as text) and core (a comment marker) disagreed in jsdom only; that fuzz sets the
  `<table>` shape aside, and the tiers' table rows rest on the engines. (2026-11-17)
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
  license. (Headed vs headless, 2026-10-18)
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
  **Firefox's 20 µs floor is a pref, not the platform:** with `privacy.reduceTimerPrecision` AND
  `privacy.reduceTimerPrecision.unconditional` both off, an isolated page observed a 0.04 µs step; with only the first
  off it stayed at 20 µs. (Playwright Firefox headed, isolated page; 2026-11-08)
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

- **Removing many just-inserted rows costs 3–5× more in some fresh Chrome instances than in others, with the same page
  and the same bundle.** Chunks of 1000 rows against a connected 1000-row table, each kind in its own fresh headed
  browser: `removeChild` read 290 ns per row in one browser and 1450 in its A/A twin (twice); inserting 1000 rows and
  then removing them, timed together, read ~1900 ns per row in one browser and ~550 in the next (twice). Each mode is
  tight within its own browser, so it is a property of the INSTANCE, not of the sample. Not yet isolated (window focus
  or visibility, accessibility, a deferred insertion cost paid at removal are candidates). Single-call kinds that do not
  remove (data, className, clone, insert alone) held their A/A within ~3%. Consequence: a removal cost from one Chrome
  instance is not a cost; it needs several fresh instances, and an A/A per instance. (Chrome 157 headed, a copy with a
  temporary profile, macOS; 2026-11-12; the stub-DOM validation's Chrome page.)

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
  200 per repetition (400 stores through one WeakMap), alone in its page, 3 fresh browsers each, µs per repetition, an experimental core / the released build / a build with no WeakMap on this path: 512 reps 52 / 86 / 55;
  1024 reps 62 / 101 / 53; 2048 reps 127 / 109 / 53; 4096 reps 101 / 107 / 53. So the same code beats the released build at three lengths and loses at one, and only the no-WeakMap build stays flat. A
  harness that calibrates reps per run can land on either side (1024 or 2048 here) and report the difference as a change in the code or in the rows before it: a bisect of earlier rows read "doubled" for groups
  that had only ever run at 2048. Cause not established (a collection schedule against an ephemeron table is the hypothesis; 205k stores is the smallest sample this could time, so a page-sized burst is
  unmeasured). Consequence: print a row's reps beside its value, force them when comparing across runs, and sweep them before calling a level a state. The same run shape found the row "61 µs" against a
  CDP-traced synchronous 4 s loop's "560 µs": a profiler or a trace in one long job is a different regime from the race, and its findings are about that instrument.

- **CORRECTS the entry above (2026-10-31, same evening): the per-repetition MEDIAN of that loop hid its cost, and the sample-length reading was about the median, not about what the code pays.** Chrome 156 headed, the same loop,
  alone in its page, 3 fresh browsers each, per repetition over warm-up + timed passes: an experimental core 126 / 335 / 255 / 279 µs at 512 / 1024 / 2048 / 4096 reps (its byte-identical copy 126 / 457 / 255 / 303), the previous build
  128 / 215 / 246 / 331, the build with no WeakMap on this path 55 / 54 / 54 / 53. Single passes of 1024 repetitions took up to 3.4 s on the experimental core and 2.5 s on the previous build, while the medians read 59 and 95 µs; the no-WeakMap
  build never spiked. So the previous build also moves, the medians of these two builds are unusable for this row, and earlier rows moved WHICH pass the pauses landed in (median 59 → 113 at the same total, on one copy; the byte-identical
  copy's total moved 2.4× in the same comparison, so that reading is not established). Cause not established: no GC trace was on, and a total cannot see a collection after the row ends or work on helper threads. Firefox and WebKit not
  measured this way. 205k stores is the smallest sample timed, so a page-sized burst is unmeasured. Consequence: a creation row's RATIO is only defined at its stated reps, and a row that allocates through a weak collection is read by
  total and per-pass values, never by a median alone. Earlier ratios read at unstated reps (0.848 vs the previous build) carry this. All of it ran as one job with no macrotask, a regime an app does not run in. ("The released build" in the entry above means this previous build.)

- **In Chrome, a WeakMap whose value strongly references its own key blocks for seconds under sustained creation; the same map with an unrelated value does not.** Chrome 156 headed, 2026-10-31, a blank page with no framework loaded, 3.68M objects in
  bursts of ~10,000 with a MessageChannel gap, garbage at once, 6 pages each, worst block by max(burst, gap): no WeakMap 1-48 ms; proxies kept nowhere 4-45 ms; `map.set(key, {})` 43-49 ms; `map.set(key, { t: key })` 521-1,699 ms;
  `map.set(key, new Proxy(key, handler))` 756-3,071 ms; `map.set(key, key)`, the value being the key itself, 846-3,002 ms; `map.set(key, new WeakRef(new Proxy(key, handler)))` 45-53 ms, though its typical burst is ~2.4x the strong proxy's (1.70 vs 0.70 ms). The blocks sit at stable positions, ~760k objects (~200 ms) and ~2.1-2.6M (the long one), and a store built that way (a raw-to-proxy weak cache) blocks at the same positions. So the value
  referencing its key is what does it, not proxies. The mechanism is not established, and no GC trace was on: candidates are an ephemeron table resolving the cycle by iterating, and entries whose value references the key surviving minor collections and piling up for a major one. Firefox 153 and WebKit 26.5, same run: the same two forms top out at 54-85 ms and 49-103 ms, against 10-19 and 55-58 ms for a plain value: tens of
  ms, read roughly on their coarse clocks. Consequence: a per-object raw-to-proxy weak cache pays this on Chrome: a ~200 ms block near 760k creations in a page's life and the long one near 2.1-2.6M. It says nothing about a page that creates far fewer, and retained objects were not measured. Evidence: reproducible from the description above, with a timed burst loop and one fresh headed browser per page.

- **In Firefox, a real page that repeatedly creates and clears a 10,000-row list of stores blocks for seconds; the same page with plain rows does not.** Playwright Firefox 153 headed (not an installed Firefox), 2026-10-31, one page creating and clearing 10,000 rows 300 times, ~3M stores at ~40k a second, fresh browser per page. Worst single create or clear above that page's median, ms: an experimental core 53 58 45 4194 2766 476, its byte-identical copy 49 49 7566 1424 476 9660, the previous build 1462 2168 10691 71 3027 820, a build with no WeakMap on this path 1099 43 39 44 41 7659, plain rows with no store 32 41 31 32 33 33. So it tracks stores, not the renderer, is not new, and a store kept on its object instead of in a WeakMap does not clearly fix it. The blocks land at varying positions, some as early as ~27 cycles. Cause not established (no profile on these runs); other frameworks' stores were not run on Firefox. CORRECTS an earlier reading from DOM-free runs that Firefox's blocks here are tens of ms: that holds only for DOM-free creation. Chrome on the same page did not block in any build (worst 19-34 ms).
  **CORRECTION 2026-11-01: "plain rows do not" above is true of the timed window only.** A Gecko profile (Playwright's build, 300 cycles) shows plain rows paying MORE cycle collection, later: no collection during a 72 s run, then 7.7 s and 12.8 s slices right after the work (20.5 s total, against 14.5 s for store rows, whose largest in-window block, 1,463 of 1,518 ms, is one CCSlice). So the in-window blocks are the cycle collector, and whether the tail is paid unprofiled on stock is unmeasured. The title's claim is corrected by this line.
  **Reproduced 2026-11-01 on a copy of the installed Firefox 154 with an update-disabling policy** (fresh profile per page): the experimental core 3015 79 3365 89 3528 92 ms, plain rows 179 101 101 80 89 80 ms; a block arrives as a clear of ~2 s then a create of ~3 s, first near cycle 130-150. So it is not Playwright's build. (Launching an install with a staged update hands off to its updater and never opens a page: measure a copy.)
  **CORRECTION 2026-11-01, the clean run: this does not track stores. On a copy of Firefox 159 with no first-run box (confirmed by eye, once), 300 cycles, 6 pages each, a page with NO framework blocks too:** plain createElement rows with `innerHTML`, worst block per page 2,415-5,845 ms, 5 blocks on every page, 6.4-9.7 s lost per page. A deep store (the experimental core) 61-5,039 ms and its byte-identical copy 83-3,955 ms; plain rows through the renderer 65-3,162 ms (1 page of 6). So repeatedly building and clearing 10,000 rows blocks for seconds at this load whatever writes them. The time right after the work is not read yet, so no total is compared here. Median create 126 ms on this build against 183 on Playwright's 153: six versions apart, a plain number.
  **The time right after the work, read (2026-11-01, the same copy of Firefox 159, headed, 300 cycles of 10,000 rows, 6 pages each, then 30 s of watching on animation frames):** the worst gap after the work is 4.6-16.2 s for rows through the renderer with plain data (6 of 6 pages; 9.0-16.2 s when watched by timers instead), 0.6-7.6 s for a deep store, 2.6-3.2 s for plain rows whose elements JavaScript keeps references to, and 0.1-1.8 s for plain rows with `innerHTML`. Solid, Vue, Lit and Van.js read 0.2-0.6 s. Total blocked time per page is alike, 19-26 s for the renderer's rows against 12-22 s for the others: what differs is when it lands. The renderer's rows lose almost nothing during the work (0 of 6 pages over 300 ms when watched by timers) and pay nearly all of it afterward, in one stop of up to 16 s. So a page that has just finished this load is unresponsive for that long. The rebuilt core is what was measured; the previous one has not been read this way.
  **CORRECTION 2026-11-01, the same day: "total blocked time per page is alike, 19-26 s against 12-22 s" above is FALSE.** The harness counted a block in both its operation and its frame gap, which inflated every page that blocks during the work and not the renderer's rows. Counted once, blocked per page, median (range): the renderer's rows with plain data 19 s (14-26), plain rows holding element references 25 s (24-27), a deep store 14 s (12-16; up to 29 s by timers), Solid, Vue and Van.js 11 s, plain rows with `innerHTML` 7-9 s; Lit blocks far longer in total and its total is unusable here. So the renderer's rows cost about twice Solid, Vue and Van.js as well as landing later. Time from the start until free again, mean: `innerHTML` 55 s, Solid 60, Vue 63, deep store 65, Van.js 67, the renderer's rows 68, held references 74, Lit 271. Plain rows with `innerHTML` also reach 1 s after the work when watched by timers (3 of 6 pages), and no framework but the rebuilt core was watched by timers. One engine, one heavy page, the frameworks' benchmark forms.
  **Against the previous core (2026-11-01, the same copy of Firefox 159, renderer byte-identical, 6 pages per arm):** the stop is not new. Rows through the renderer with plain data, worst gap after the work, watched by timers: the previous core 5 of 6 pages at 1 s or more, median 6.3 s (0.9-13.4); the rebuilt core 6 of 6, median 13.6 s (8.9-16.9), and a byte-identical copy of it 5 of 6, median 10.9 s (0.4-17.5). On animation frames: previous 4 of 6, median 3.8 s; rebuilt 6 of 6, median 10.4 s. Blocked in total, median: previous 15.9 and 14.7 s, rebuilt 21.9 and 18.7 s, the copy 19.4 s. A deep store goes the other way under timers: previous 5 of 6 pages, median 4.2 s; rebuilt 2 of 6, median 0.7 s, and the copy the same; on animation frames previous 6 of 6, median 4.1 s, rebuilt 4 of 6, median 3.4 s. Solid and Vue: 0 of 6 under timers, 0.4-0.5 s, 10 s in total. So the renderer's rows stop in both cores, about twice as long in the rebuilt one; what holds them is not established. **Corrected the same day: "the stop is not new" above understates it.** The kind is inherited; by the test written before the run, its size on plain rows is a regression against the previous core (1.7-2.2x under timers, at the edge of that test's byte-copy allowance, 1.25x). And a deep store's shorter stop holds under timers only: there the cost moved into the work (12.0 s during it against 4.5 s) and the total is level; on animation frames it is mixed, with a larger worst case (9.3 s against 4.8 s).
  **CAUTION 2026-11-01: on every copy-of-stock page below and above, a Terms of Use box covered the page until it was found that morning. So the stock figures (3015 / 3365 / 3528 ms, the 128 ms create, the 40% gap) are UNCONFIRMED until rerun without it; a modal may change what paints, and creates are timed to paint. Playwright's own runs, which showed the blocks first, are not affected.**
  **Playwright's Firefox is not a stand-in for speed (2026-11-01):** on this same page the median create was 183 ms on Playwright's 153 and 128 on a copy of stock 154 (plain rows 172 and 119), about 40% slower, and the first block came near cycle 27 there and near 130-150 here. One version apart, cause unknown. Whether RATIOS between builds carry over is unmeasured, and every earlier Firefox race ran on Playwright's build. The same question stands for Playwright's WebKit against Safari.
  **What holds the stop, profiled (2026-11-04, Playwright's Firefox 153 headed, Gecko profiler with `js,stackwalk,memory` on the content main thread, the same page, 300 cycles, then 30 s of watching by timers; renderer's rows 3 pages per core, the others 2; a page that only builds cycles read ≥ 500 ms of cycle collection, and rows holding element references read 2.1x plain rows', so the instrument sees it):** Firefox DEFERS the renderer's cycle collection for the whole run. On all 6 pages of rows through the renderer with plain data, both cores, it ran no cycle collection during the 70 s of work. It started one within 0.3 s of the work ending, with 26.1-26.6 million suspected objects after 144-152 forget-skippable passes, and the stop after the work was that collection (100% of the worst gap, 60-66% of it building the graph). Solid, Vue, plain rows and plain rows holding element references collected every 8-20 s during the work, 2-11 million suspects each. No page of any framework had idle time during the work (no `Idle` samples), so idle time is not the difference. The difference is in the GCs. The renderer's rows ran 23 major GCs, one every ~3.1 s (each triggered after ~86 MB allocated, ~640 bytes per row against ~84 for plain rows). Each did 41 ms of work, 38 of it sweeping, in 12 slices spread over 0.74 s, so a GC was in progress 23% of the time. Solid ran 100 GCs of 13 ms finished within 0.03 s, Vue 75 of 24 ms within 0.25 s, plain rows 4. Firefox's scheduler source (`dom/base/CCGCScheduler`, mozilla-central, read 2026-11-04) has a cycle-collection timer that fires every 250 ms and waits through up to 22 fires of forget-skippable after a GC. A fire that finds an incremental GC running restarts that wait (shortened to 2 s), and every GC's end clears the 30 s clock that would otherwise force a collection. So a page whose incremental GCs are long enough to be seen by a fire, and come back sooner than the wait, can by that reading put the collection off for as long as it keeps allocating. That fits the 6-7 forget-skippable passes seen between each pair of GCs here, and it is a reading of the source, not a measurement of it. It does not explain why Vue (0.25 s GCs every ~1.1 s) escapes: not established. A deep store, when collections landed during the work (on 3 of 4 pages, 1-4 of them), had a shorter stop after (0.5-9.7 s against 16.7 s with none after 7 s), and its worst block during the work was up to 6.0 s: the cost moves and does not go away. Both cores read alike under this profiler (worst gap 9.1-9.6 s against 8.8-11.0 s; 23 GCs and ~26 million suspects each; one page from an earlier session of the same run read 18.4 s). So the 1.7-2.2x regression measured on the copy of Firefox 159 above does not reproduce here, and whether the build or the profiler hides it is unmeasured. Profiled times are not comparable to the unprofiled figures above. Consequence: the stop is Firefox scheduling, not Vera keeping garbage alive longer (no retention after a clear was found, by gc-instrumented jsdom probes with a planted hold that was detected). What a fix has to change is the GC cadence and shape Firefox sees during a churn, or the size of the graph it builds at the end. A fix is judged by whether collections land during the work AND by the worst block anywhere, never by the stop after alone.
  **CORRECTION 2026-11-04, the same day: "or the size of the graph it builds at the end" above is wrong as an alternative.** The ~26 million suspects are a consequence of the deferral, about 3 million rows created times ~9 DOM wrappers each, all still waiting because no collection ran; per row the renderer's rows hold about what plain rows do. The deferral is the thing to remove.
  **The deferral, tested by changing Firefox's GC settings (2026-11-04, the same build, profiler and page; the renderer's rows only, 3 pages per setting, fresh browser per page, seeded order; the pass bars were written before the run):**
  - **Default settings** reproduced the deferral: 0 collections during the work on 3 of 3 pages; worst gap after the work 9.2-9.8 s, which was also the worst block anywhere.
  - **Raising the GC allocation trigger to 256 MB** (`javascript.options.mem.gc_allocation_threshold_mb`; default 27, but the trigger here was heap-scaled near 86 MB) took the work from 23 GCs to 3. Collections then ran during the work on 3 of 3 pages (4 each); the worst gap after fell to 1.0-1.1 s and the worst block anywhere to 3.9-4.0 s. That passed its bar.
  - **Raising the incremental slice budget to 100 ms** (`javascript.options.mem.gc_incremental_slice_ms`; default 5) left the GC count at 23 but shortened each GC's span from 0.53 s to 0.06 s. Collections then ran during the work on 3 of 3 pages (7 each); the worst gap after fell to 0.3-0.55 s and the worst block anywhere to 1.1-1.3 s. It was VOID by its pre-set check: the GCs still took 4 slices, against a bar of 2.
  - **So two different GC settings each removed the deferral, and the GCs' cadence and span are what holds it.** By the pre-set bars the run is not read as confirming the source reading above.
  - **The forget-skippable counts before each collection missed both predicted ranges.** The predictions were 6-8 under the larger trigger and ≤ 3 under the larger slice budget. The counts were 23, 23, 7 and 30 under the larger trigger, and mostly 6-7 (some 0) under the larger budget.
  - **Read after the run, so a hypothesis:** 23 is the source's full 6 s wait (22 fires plus one), the case where no timer was running during the GC; 7 is the shortened wait after a reset. Under the larger budget, a fire still met the GC and reset the wait, but the time between one GC's end and the next GC's start grew from ~2.3 s to ~3 s, enough for the 9 fires the shortened path needs. That reading does NOT support "Solid's and Vue's GCs go unseen", which stays unexplained.
  - **Consequence:** these are Firefox settings, used here to test the mechanism, never something an app or user is asked to change. What Vera controls is the same two levers: how often its GCs come (allocation per row) and how long each stays open. A churn's collections then land during the work, the worst block anywhere being the bar.
  **On a copy of stock Firefox 159 (2026-11-04, the same page, 3 pages, the same profiler, the browser closed through WebDriver BiDi so the profile is written; a kill writes none; a page that only builds cycles read 611 ms of cycle collection inside its own window):** by the bar written before the run the deferral does NOT hold there: 2 of 3 pages collected during the work. What the pages show: one ran a single collection of 26.4 million suspects, started late in the work, that blocked for 16 s inside an operation (the worst block of any run here); one collected twice early (6.6 and 13.0 million) and then not for the last 28 s; one did not collect during the work and its collection of 26.1 million after it blocked 8.9 s. GCs there came about every 2.3 s, open 0.37 s each. So on 159 the collection is still put off for most or all of the run on 2 of 3 pages, and when it lands inside the work it can block longer than after it. What starts 159's collections is not the path the source reading predicts (one forget-skippable since the last GC, not 7 or 23): not established.
  **What moves it: less long-lived JavaScript per row (2026-11-04, two probe builds of the renderer, never landed; the build method reproduced all 13 production bundles of the unmodified renderer byte for byte).** One probe kept each row's binding pairs in the row's own object instead of a separate array (one object fewer per row). The other never read a whole-element text node from JavaScript at its first write, so a row creates 4 node wrappers instead of 6. On Playwright's Firefox 153 (3 pages each, against the unmodified build and a byte-identical copy of it, both of which deferred on 3 of 3 pages) both probes halved the GCs during the work (11-14 and 9-14 against 22-23), and collections then ran during the work on every page (3-6 of them). The worst block anywhere fell from 8.4-11.1 s to 1.1-1.8 s and 1.3-2.4 s. On the copy of stock Firefox 159 (the unmodified build 5 pages, worst block 3.9-12.4 s; each probe 3 pages) the same held: 5 collections during the work on every page, worst block 1.2 s and 1.5-1.9 s, and total blocked time per page 12.3-13.5 s against 14.2-22.1 s. So the cost was not spread out. Each probe lowered BOTH the bytes kept per row and the sweep time per second, so they act through the same thing: less tenured JavaScript per row, fewer GCs, room for the collection to start. Supporting test, no framework (plain rows): touching 3 nodes per row without keeping them took sweep from 1.9 to 5.9 ms per second of work, and keeping them took it to 8.7. Creating a node's wrapper costs more than holding it. Still above Solid's 0.7 s worst block: about 4-10x better, not solved. Profiled, so creation times here are not timings. Neither probe's update path was exercised.
  **The landing form, on its exact bytes (2026-11-05):** the first probe as written, a row's instance being an `Array` subclass with its bindings as elements (hydration builds it too). On Playwright's Firefox 153 (3 pages, against the unmodified build and a byte copy, which ran 0 collections during the work on 6 of 6 pages and blocked 9.4-12.9 s), it ran 6 collections during the work on every page. Its GCs fell from 22-23 to 12-14, and its worst block anywhere was 1.2-1.5 s. On the copy of stock 159 (unmodified build 5 pages, worst block 5.8-16.8 s; total blocked 17-27 s) it ran 5-6 collections during the work, worst block 1.2-1.4 s, total blocked 12-13 s. What it does, in plain terms: the collection is not removed, it is split up and moved into the work. One 6-17 s stop after the work becomes 5-6 pauses of ~1.2-1.5 s during it. Total blocked is a third to a half less, and the work's wall time is 17-19% longer (the pauses land inside it). Building the collector's graph is still ~58% of each slice. Solid's worst block is 0.7 s.
  **A plain array with the same fields set as named properties after creation lost to the subclass** in the same three-engine race: Firefox's store-row updates and Chrome's swap. Hypothesis, not measured: fields added after an array's creation are read slower than a class's constructor-defined ones. Read with the caution in the next line.
  **A race's verdict on some rows does not repeat across races, even for identical code (2026-11-05).** Three headed races (5, 8 and 8 sessions; Chrome 156.0.8078.81 throughout; fresh browser per page; each with byte-identical A/A copies) raced the subclass build. Twice it was one bundle; in the third, a bundle differing only in two protocol-number bytes. Builds byte-identical across all three races moved against their race's reference by a median 3.1% between races (90th percentile 27.3%, maximum 75.3%; 18 of 78 rows by 10% or more). The largest were the clear rows (WebKit's own-rows clear 75.3%, its store clear 72.0%, Firefox's store clear 36.5%, its own clear 20.5%) and Firefox's own-row small operations (update every 10th 57.2%, select 44.9%, swap 37.9%, remove 34.0%); Firefox's store update every 10th moved 27.3%. Whether these rows run at two speeds was not checked. The subclass build's Chrome swap read −1.8%, −0.7% and +10.7% against a 1.2% movement for the identical builds on that row. That is beyond the A/A spread inside any one race, so the within-race A/A spread does NOT bound between-race movement on those rows. Consequence: a verdict on such a row is read across races, as a repeated sign, never from one race. Only Chrome's update-every-10th (−5.8 to −7.0%), select (−2.0 to −3.0%) and remove (−1.7 to −2.8%) wins held in all three races. The store version's creation rows on WebKit were slower in all three races on every row (+0.3 to +2.3%), a loss beyond the spread in all three only on append 1,000 with layout. The cause of the between-race movement is not established.

- **Headed installed Chrome takes ~9 s to close gracefully, even on a blank page** (Playwright `browser.close()`: 9.0 and
  8.9 s, with or without closing the page first; Firefox 0.2 s, WebKit 0.03 s). Killing it (`launchServer()` +
  `kill()`) takes ~30 ms and leaves none of its processes running at 0 ms (0 of 7 for Chrome, 0 of 6 Firefox, 0 of 2
  WebKit), and the temporary profile is still removed. Consequence: the DOM race kills each page's browser; a third of
  every Chrome page had been the close. (macOS, Playwright; 2026-11-08)

- **A window's close is load-sensitive in Firefox.** `tests/browser/r4-cross-window.test.js`'s pop-out release row (a
  component left in a pop-out that closes is released) failed once on Firefox while a CPU-heavy differential ran beside
  the browser suite (the panel not released, its effect re-woken), and passed 3 of 3 runs alone on the same tree.
  Consequence: the browser suite runs alone; a red on that row under load is re-run alone before it is called a
  regression. (Playwright Firefox headed, macOS; 2026-11-08)

- **V8's allocation-site pretenuring can turn a create into nepotism: young rows promoted wholesale at every scavenge.**
  1000 records a round, each pointing at a freshly built element subtree that a long-lived parent holds, the records
  then dropped and the parent emptied: with a closure over the record carried on it (`rec.fn = () => rec.id`, never
  called), the scavenger promoted 15.5 MB per scavenge (7.3 ms each); without it, 0.10 MB (1.9 ms). No framework: plain
  JavaScript classes for the elements (the stub DOM). `--trace-pretenuring-statistics` shows V8 TENURING the record
  literal's allocation site (survival ratio 1.0) in exactly the arms that promote, and never in the others: the records
  are then allocated in old space, the element written into them later is an old-to-new pointer, and once a record
  dies it stays in old space until a mark-compact, keeping that young subtree alive through every scavenge. The same
  data held by a class instance, or by a function bound per row (no closure context), never tenures and stays clean.
  **Trigger and amplifier, separated:** the TRIGGER is a closure that captures the record (with the closure and no
  element pointer, V8 still tenured the site, 2 decisions, 2.35 MB per scavenge); the AMPLIFIER is a young element
  written into the record after it is allocated (with it, 6 decisions, 14–15.5 MB), since each dead old record then holds
  a whole subtree. Solid's row record (`{ id, text, setText }`, closures inside it but captured by none) is never
  tenured (0 decisions in the same harness; its 1.55 MB per scavenge is rows still live when a scavenge lands mid-create).
  A smaller reproduction (plain-object nodes in a linked list) does not reproduce it, so the trigger is not yet minimal.
  Consequence: a GC reading from a benchmark whose rows carry per-row closures can be this, not the framework (the
  split-render ablation's "26.9 MB per scavenge" was its per-row ref literal; Vera's split render is 0.11 MB with a
  class ref), and a per-row closure over row data in an app's hot create path is worth measuring. (node 24 / V8 13.6
  and node 26 / V8 14.6, macOS; 2026-11-12.)
- **In Chrome, two forms of a per-row array whose script parts differed by ≤0.15 ms read ~7–10% apart on a
  paint-inclusive row; the gap tracked the page's major-collection count, and its sign depended on what ran earlier on
  the page.** Chrome 157.0.8103.79 (installed Chrome, Playwright, headed, a fresh browser per page), 2026-11-17; Chrome
  only, Firefox and WebKit not checked. `bench/dom`'s `append1k` on the lite tier, three forms of one per-row array of 3
  entries: grown by `push` from `[]` (V8 backs it with 17 slots), or built exact-size by `map`, with a module-level
  callback or a closure. User-timing marks split each timed sample (script done; painted), and CDP tracing of the
  renderer main thread split the rest; 4 pages per form, 28 timed samples each, means below. The script part was ~2.8 of
  ~25 ms; the rest was the frame's style, layout and pre-paint on an identical DOM.
  After `create1k` on the same page, the `push` form was slower on 8 of 8 pages over two runs (mean 26.2–26.3 ms against
  24.5–24.8), every `push` page with 5 major collections and every exact-size page with 10. Its +1.76 ms (second run)
  split into script +0.13, idle wait for the frame +0.78, and rendering +0.75 (layout +0.55, pre-paint +0.18, style
  +0.10), with nothing after the rendering. On a fresh page, the races (no tracing) read both exact-size forms +7–9%
  slower than `push`; in this probe only the module-level-callback form was (25.8 against 24.8–24.9), on pages with 3, 3,
  4 and 7 major collections against 7 on every other page, although that form and the closure form build identical
  arrays: on a fresh page the variance is per page within one form, not the allocation pattern alone. No major
  collection landed inside any timed window; minor ones landed in 3 and 4 of 28 windows of one exact-size form, and none
  in the windows of the slow form. With a full collection forced before every sample (`--expose-gc`), script and
  rendering tied across the forms in both designs (rendering 23.2–23.4 ms after `create1k`, 22.4–22.7 fresh; window
  means within 1.3% fresh, and within 3.2% after `create1k`, all of it idle frame wait, whose variance grew), and every
  form got slower (layout 12.1–12.8 → 13.5–14.1 ms). So the mechanism is not "less garbage, faster layout", and it is not
  isolated. Consequence: on a paint-inclusive row, an arm that changes only how JavaScript allocates can move the row
  ~10% either way, and which way depends on the page's history. That is a real cost on that history, not noise. Before
  reading such a difference as code speed, split the window into script and rendering, and check it against equalized
  collections.

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
  child in the component's HOME realm and adopts it. (Chromium 151, Firefox 153, WebKit 26.5, Playwright
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

- **Chrome charges for a proxy handler that CARRIES `undefined`-valued trap keys, though no operation reaches them.** The
  store door (2026-11-06) gave every handler core owns all 13 trap names (`Object.getOwnPropertyNames(Reflect)`), six set
  to `undefined`, so a module wired later would only replace values. Four races reproduced the cost on a store-backed
  list's swap (+3.1, +3.2, +2.8 and +1.9% median; every drop-one a loss in the first three, 5 of 8 in the fourth and
  smallest); removing the undefined keys (core's own 7) cleared it in three races (two narrow, and the final three-engine
  race on the landed form), whether the fields were written once or twice (13 keys written once still lost: not V8's constant-field
  tracking); a later wire that ADDS a trap to the 7-key handlers measured free in ONE race (the same module on both forms
  as the pair). A counting module showed swap reaches only `get`, `set` and `has`: no absent-trap path runs. Chrome only;
  Firefox and WebKit not isolated. The mechanism (the handler's shape in V8's proxy code) is a guess. Consequence: a
  proxy handler carries only the traps it uses; never pad one with `undefined` keys for shape stability. (Headed
  installed Chrome, version not recorded by the race harness, Playwright 1.62.1; the narrow races Chrome-only; 2026-11-06
  and 11-07.)

## Test environments

- **Inspecting a cross-realm DOM object (an iframe's `ShadowRoot`) in a chai failure message never finishes**, so a
  failing browser assertion reads as a suite TIMEOUT. Consequence: assert booleans for values from another document.
  (2026-10-01)
- **jsdom answered a NESTED host's child for `querySelector(':scope > …')`** on a page custom elements built.
  Consequence: probes read direct children with `[...el.children]`. (2026-10-02)
- **Linux WebKit exposes `PublicKeyCredential`, macOS WebKit does not**; a recorded DOM surface must not depend on it.
  (`tests/dom-surface.mjs`)
- **jsdom builds Proxies of its own for its elements** (a `NamedNodeMap` per element, and a `DOMStringMap` per HTML or SVG
  element: 12,021 constructed while rendering 1000 table rows). Consequence: a probe that counts `new Proxy` to see whether code reaches a
  store must group the count by handler or target, or jsdom's own swamp it. (jsdom, Node; 2026-11-07)
- **[PARTLY WRONG, 2026-11-17: the process is the Aerials SCREEN SAVER, not a wallpaper; see the next entry.] On macOS,
  the Aerial wallpaper keeps a process busy behind headed browsers, and `caffeinate -dimsu` does not stop it.**
  In one three-engine race under caffeinate, `WallpaperAerialsExtension` was in the top three processes at the start of
  all 16 Chrome and Firefox sessions, at 6.4–16.2% of a core (at or above 10% in 5 of 8 Chrome and 3 of 8 Firefox
  sessions); no WebKit session showed it. After the wallpaper was set to a still image through System Events (the legacy
  setting; the newer wallpaper store still named an animated one), it held 6.4–14.2% in all 8 sessions of the next race.
  That race also ran for hours under caffeinate with the screensaver set to 10 minutes idle and recorded no screensaver
  in any session, so caffeinate did keep the screensaver off there; the earlier dimming was in sessions run WITHOUT it.
  Consequence: every headed run is caffeinated; the harness records whether a screensaver is up at every session and at
  the end, and sessions it marks contended go into a removed-together suspect set, because a covered or contended
  window could be throttled (not measured); and the wallpaper is set to a still image in System Settings, not by script.
  (Headed races on macOS; 2026-11-06 and 11-07.)
- **The `WallpaperAerialsExtension` load is the Aerials screen saver, it runs with no `ScreenSaverEngine` process, and
  nothing a harness can do dismisses it once it has started.** macOS 26 (Darwin 25.6), 2026-11-17: the desktop is a
  still black image (wallpaper store: `com.apple.wallpaper.choice.image`); the store's idle provider is the Aerials screen
  saver, and `defaults -currentHost read com.apple.screensaver idleTime` is 600. With the machine idle 1637 s
  (`ioreg -c IOHIDSystem` HIDIdleTime), `WallpaperAerialsExtension` held 11–16% of a core (`ps` %cpu) for a whole race,
  while no `ScreenSaverEngine` or `legacyScreenSaver` process existed, so a check that looks for those reads "none" with
  the screen saver up. `caffeinate -u -t 2` did not dismiss it (`top` still 8–9% after) and did not reset HIDIdleTime;
  only real input does. Caffeinate started BEFORE the 600 s mark keeps it from starting (the entry above, hours under
  caffeinate with no screen saver). Consequence: an unattended race must hold its caffeinate from before the idle
  threshold, never start one after it; once the screen saver is up, the race harness's per-page check marks every page
  contended and the session VOID (measured: 1 session, every page re-run twice, VOID). (`bench/dom/race.mjs`.)
- **The user's own installed Chrome left running, plus a dictation app, made a bench row two-mode per page; the race's
  quiet check passed throughout.** Chrome 157.0.8103.79 (the installed Chrome launched by Playwright, headed, a fresh browser per
  page), 2026-11-17: with the user's installed Chrome running (open 17 h, a renderer helper bursting to ~96% of a core)
  and a dictation app, `bench/dom`'s `append1k` on the lite tier landed each page in one of two
  modes (~30 or ~40 ms), and the A/A copy spread across both, so medians said nothing. With both quit, the same row was
  unimodal at ±2% (10 sessions; the A/A within 0.2%). Observed as one before/after pair, a correlation; the mechanism is
  not isolated. The load came in bursts, after each session's start-of-session CPU sample, so the quiet check never saw
  it. Consequence: quit other browsers and background apps before a race; a start-of-session CPU sample cannot see bursty
  load. (The lite rebuild's races; 2026-11-17)
- **Heap growth measured in a `--expose-gc` child process moves with the load beside it.** A fixed 0.4 MB bar between
  two arms of `tests/core-key-map-bounded` failed once inside the full development suite (selector 1.33 MB vs control
  0.78, a 0.55 gap) and passed 3 of 3 alone and in five other full runs the same night. Consequence: a memory bar is
  measured three times per arm, the median kept, with a margin of max(0.4 MB, 3 × the control's own spread); with the
  sweep disabled (a mutant core) both swept arms still fail it by over 1.1 MB. (Node 24, macOS, full fast suite;
  2026-11-11.)
- **On node's V8 (13.6), dropping a short-lived allocation from a hot path can DOUBLE full-collection time on a long
  allocation-heavy run.** Sixty rounds of 100k first reads of fresh nested store objects (heap past 500 MB):
  current core spends 3.5 s in 5 mark-compacts; a core whose nested read no longer allocates a property descriptor
  spends 6.9 s in the same 5, and its scavenges fall from 66 to 44 for the same total time (3.2 s). The heap after a
  forced gc is identical (36 MB), so nothing leaks, and with gc forced between rounds the leaner core is faster. An
  experimental core, whose nested read is leaner still, shows the same doubling (4 mark-compacts, 6.6 s), so the cost
  belongs to the leaner allocation pattern, not to one change; there its other savings outweigh it (11.6 s total
  against 13.4). d8 15.9 (and Chrome 157's V8 ≈ 15.7) show the leaner core faster on short counted runs; a long run
  there was not measured. A REAL server render does not show it: `renderToString` of a store-backed page (a fresh nested
  store per request, 8 fresh processes per arm, an A/A arm within 2%) is 28% faster per render at steady state with the
  leaner core, with 40% less GC time, and ties cold; a signal-backed page ties. The doubling needs a heap grown past
  ~500 MB of live store objects, which a per-request render never builds. Consequence: a hot-path change that removes an
  allocation gets a long node run with
  `--trace-gc` as well as the short counted ones, and the split (scavenge vs mark-compact time) is reported, not only the
  total. (Node 24 / V8 13.6, macOS; 2026-11-12.)
- **An instruction slope over a few thousand ops measures tier-up, not steady cost, on all three engines.** The same
  store-write scenario counted under cachegrind (d8 15.9, SpiderMonkey, JSC) gives, for one unchanged arm, 8037 per op at
  N 1000/3000 and 4757 at 100k/300k on SpiderMonkey, 7399 and 2134 on JSC; on V8 a variant read +4.8% at the short pair
  and -31.7% at the long one, because it reached its optimized tier later. A short window also allocates too little to
  trigger a scavenge, so an allocation's cost does not show at all. Consequence: a slope counts only when two N pairs
  (10k/30k and 100k/300k) agree within 1%, and an allocation change is counted at an N whose window holds a collection.
  (2026-11-12, an experimental variant of the store's write path.)
- **For a small object with a fixed set of fields and shared methods, a `class` beats every class-free form on all
  engines.** Measured on core's hook (16 fields) and computed (5 fields), 12 fresh processes per arm, A/A arm:
  `Object.create(proto)` plus field writes RETAINS more per instance (hook 627.6 vs 611.6 B, computed 160 vs 128 B, node,
  `--expose-gc` child with retained and dropped controls: it misses the constructor's slack tracking) and creates slower
  (hook +5 to +35%, computed +12 to +26% on SpiderMonkey and JSC); a literal `{ __proto__: proto, …fields }` keeps the
  memory but creates far slower (hook +56 to +105% on node and V8, computed +58 to +409% on all four); a literal with the
  methods as own fields costs +40 B per hook. Reads tie in every form. Consequence: core's two classes stay as the
  measured hot-path exception, with these numbers recorded at the classes. (node 24, d8 15.9, SpiderMonkey, JSC;
  2026-11-12.)
- **JavaScriptCore's FTL inline budget (170 bytecode cost per callee) can turn a SMALLER function into a slower page.**
  Removing one descriptor read from the store's object-valued read path (the function a `get` trap calls on a cache
  miss) made it small enough for FTL to fold into the trap; the trap then got inlined into its callers fewer times (50
  vs 68 in one run's FTL log, `--printEachDFGFTLInlineCall`), and a row that calls an inherited method 1000 times per
  pass ran 56–63% slower, but only after 10 other rows had trained the trap in the same process (alone: a tie; in
  shuffled orders: a tie or a win). `--maximumFunctionForCallInlineCandidateBytecodeCostForFTL=60` or `=400`,
  `--useFTLJIT=false` and `--maximumInliningDepth=1` each removed it. Consequence: store rows are also measured IN
  SEQUENCE, fixed and shuffled (the seqrace tool), since an isolated window cannot see this. (JSC from jsvu, macOS;
  2026-11-12.)
- **V8 13.6 (node 24) tenures a workload's objects when its short-lived allocations go away.** The same change removed
  one short-lived descriptor per cache miss; on a row that creates a store over 10 fresh arrays per op, node then ran
  14 scavenges instead of 22 and 2 mark-compacts taking 2136 ms instead of 4 taking 1437 (+76% at steady state), while
  a server render that creates a store per request ran 28% faster with 42% less GC. Consequence: an allocation-touching
  change is measured on node with `--trace-gc` splits on both a long-lived and a per-request workload. (node 24 / V8
  13.6, macOS; 2026-11-12.)
- **A native arm64 cycle difference can exist with identical instructions, misses and inlining.** computed-create read
  +7 to +15% in V8 cycles (threadrace, native) across every build after a pure module move, while cachegrind (x86 V8
  under Rosetta) counted the same instructions (1490 vs 1497), the same misses and fewer mispredicts, and V8's inlining
  trace showed identical decisions; reordering the bundle fixed JSC (+1.3%) but not V8. Consequence: a small-op cycle
  difference with equal counts is reported as machine-code placement, not as a logic regression. (d8 15.9 arm64, Apple
  silicon; 2026-11-12.)
- **SIP strips `DYLD_*` from the children of a protected binary, so `perl -e 'alarm N; exec …'` cannot launch a jsvu
  JavaScriptCore**: it then loads the system's framework and aborts on a missing symbol. Spawn engine shells directly
  (node's `execFileSync` with `timeout`). (macOS 26; 2026-11-12.)
- **React 19.2.8's "swap 2 rows" in the DOM benchmark stalls in headed Playwright WebKit 26.5, and the cause is unknown.**
  With the page query `?batch&layout&minms=30`, the React page completes create1k, create10k, append1k, update10 and
  select, then never reports swap done: it stays responsive (it answers a state read at once), visible and focused, and
  the race driver's 180 s wait for results times out. Reproduced 2 of 2 in one-page runs (a fresh headed WebKit each,
  the same bundle, query and calibrated counts, ops up to swap), the same op and state both times; a Preact page under
  the same conditions completes swap (0.338 ms); the two full races that reached React's WebKit page stalled at the same
  op. Chrome 157 and Firefox 153 complete React's swap in all 6 sessions each. **Cause unknown**: the harness, React and
  WebKit are all suspects, and none is established. Consequence: React's WebKit rows in the 2026-11-14 release race are
  reported "not measured", and the WebKit race runs without React. (WebKit 26.5 headed via Playwright, macOS; React
  19.2.8; 2026-11-14.)
  **Corrected the same evening: not a stall.** With swap's per-sample count at 25 (Chrome's) instead of the WebKit
  calibration's ~155, React's page completes, at ~243 ms per swap (Preact under the same conditions: 0.34 ms); at ~155 in
  the same sitting it again outlives the driver's 180 s wait. The page answers a state read because the batched loop
  awaits each run. The number is from one page of 25 runs; whether it reflects React's own swap cost in WebKit or an
  interaction with the benchmark's await-each-run loop is not established.

## Competitors, as their own benchmark entries write them

For a fair race (each written the way that framework's own js-framework-benchmark keyed entry writes it):
- **Solid:** compiled JSX with a selector and a signal per label. Its hyperscript build re-runs every row on a select.
- **Vue:** a compiled template with `v-memo`. Its idiomatic `:class` renders `class=""` on unselected rows.
- **Svelte 5:** runes and `$state.raw`. In legacy mode over a deep `$state`, a swap or a remove re-ran every row.
- **Van.js 1.6:** per-row states, with DOM updates on a microtask.
- **React:** a swap moves every row in between.
(2026-10-18)
