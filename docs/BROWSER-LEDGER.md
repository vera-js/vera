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
  (Headless; 2026-10-17)
- **jsdom's `MutationObserver` holds every observed node strongly** until `disconnect()`; browsers hold them weakly.
  Consequence: retention of anything an observer watches is measured in a real engine with CDP gc, never jsdom.
  (2026-10-07)
- **The platform keeps every `WeakRef` target alive until the current job ends**, and an async loop that never yields
  a macrotask is one job: a timing loop of `await render()` kept every render reachable (109 MB). Consequence: yield a
  macrotask every ~100 iterations, outside the timed region. (Node; 2026-09-28)
- **A `const` binding keeps the last `WeakRef`'d object alive**, with no framework involved; so does the last call's
  objects in an async per-cycle function. Consequence: retention probes use a no-framework control. (Node; 2026-09-05)

## Custom elements

- **Defining `adoptedCallback` costs every element's creation** (+7.4% on create10k, 5/5 sessions): a lifecycle
  callback is engine work per instance. Consequence: never add one speculatively. (Mode not recorded; 2026-10-02)
- **Custom element upgrade, shadow DOM, `adoptedStyleSheets` and `@scope` are emulated or absent under jsdom.**
  Consequence: browser suites on all three engines are the release gate; jsdom is the regression net. (standing)

## The engines' compilers

- **V8 inlines a function only while its bytecode is ≤ `--max-inlined-bytecode-size` (460)**, so a hot function near
  the budget pays for ANY growth, even code that never runs (a never-taken `if` cost 4.0%). Consequence: move rarely
  run code out of line; `tests/ssr-inlining-budget.test.mjs` prints `serializeValue`'s headroom. Firefox and Safari
  inline on different rules. (Node; 2026-10-09)
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
- **A timing window after a fixed warm-up measures WHEN V8 tiers up.** A faster build sat in a middle tier for calls
  20–80 and read 28% slower over exactly that window. Consequence: report the cold total and a steady time, and the
  per-batch curve when they disagree. (Node; 2026-10-01)

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
