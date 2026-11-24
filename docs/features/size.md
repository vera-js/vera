# Size

## The claim

**A working VeraJS app is about <!--size:app.kb-->12.9 KB<!--/size:app.kb--> gzipped (<!--size:app.bytes-->13 214 B<!--/size:app.bytes-->) — <!--size:app.rank-->7th<!--/size:app.rank--> of
<!--size:app.count-->10<!--/size:app.count--> frameworks measured: above Lit and Preact + signals, level with petite-vue, and about 8x smaller than React.**

## The evidence

A minimal but *working* reactive counter, bundled with esbuild, minified, `NODE_ENV=production`,
tree-shaken, gzipped:

<!--size:table.evidence-->
| Framework | gzip | vs smallest |
| --- | ---: | ---: |
| Van.js | 1 219 B | 1.0x |
| Solid *(needs a compiler)* | 4 446 B | 3.6x |
| Lit | 5 871 B | 4.8x |
| Preact + signals | 6 031 B | 4.9x |
| petite-vue | 7 258 B | 6.0x |
| **VeraJS + lit-html** | **10 075 B** | 8.3x |
| **VeraJS + own renderer** | **13 214 B** | 10.8x |
| Alpine.js | 19 438 B | 15.9x |
| Vue | 25 259 B | 20.7x |
| React | 60 356 B | 49.5x |
<!--/size:table.evidence-->

## Why measured this way

Gzipping a `dist` file would be dishonest in both directions: it ignores tree-shaking, and it hides
that several libraries need **two packages** to render anything (react + react-dom, preact +
signals, solid-js + solid-js/web). Every figure above comes from an app that actually puts reactive
state on screen.

This is also why the number is *lower* than the standalone bundles it replaces: `vera.min.js` plus
`vera-renderer.min.js` is <!--size:stack.bytes-->14 828 B<!--/size:stack.bytes--> gzipped against the app's <!--size:app.bytes-->13 214 B<!--/size:app.bytes-->, because a bundler
drops the core exports an app does not use.

## Measured on a list, not only a counter

A counter is the shape that flatters a directive-first design: everything a list needs sits behind
an import a counter never makes, so quoting only a counter reports the comparison at its least
representative point. The same measurement on a **keyed list** — the thing every real app does, and
the thing reconciliation exists for:

| | gzipped |
| --- | ---: |
| VeraJS + `@verajs/renderer` + `/keyed` | **<!--size:list.bytes-->13 806 B<!--/size:list.bytes-->** |
| Lit + `directives/repeat` | <!--size:list.lit.bytes-->6 826 B<!--/size:list.lit.bytes--> |

Lit minus VeraJS: <!--size:list.vs-lit.bytes-->-6 980 B<!--/size:list.vs-lit.bytes--> (negative means VeraJS is the larger). Both numbers are real and both are
published: which one is representative depends entirely on whether the app renders a list.

Sizes are gzipped with `zlib.gzipSync`, and **KB means 1024 bytes**. The `gzip` command-line tool is
not equivalent — it writes the original filename and mtime into the header, inflating every figure
by 20-30 bytes.

## A page, rather than an application

The number above measures the **full** entry: a reactive counter, with the store and the proxy behind
it. That is the honest headline, because reactivity is what most people come here for.

It is not what every page loads. `createProxy` is **37% of core's minified bytes**, and a bundler
drops it for a component that never creates a store — a marketing page, a server-rendered article,
anything progressively enhanced rather than driven by state. Measured the same way, tree-shaken:

**<!--size:app.static.kb-->12.9 KB<!--/size:app.static.kb--> gzipped
(<!--size:app.static.bytes-->13 216 B<!--/size:app.static.bytes-->) —
Lit minus VeraJS: <!--size:app.static.underlit-->-7 345 B<!--/size:app.static.underlit--> (negative means VeraJS is the larger).**

Two things this is not. It is **not the same app** as the rows in the table above — it renders once
and updates nothing, where every one of those renders reactive state, so it is a page against their
applications and is kept out of that comparison for exactly that reason. And it is **not a separate
build or a flag**: no import, no configuration, nothing asked of the author. It is what a bundler
already produces from the same package when the code does not reach for a store.

## The honest framing

**There is no smaller honest number than <!--size:app.kb-->12.9 KB<!--/size:app.kb-->.** Core ships no
renderer — a component with none registered warns and paints nothing — so "core alone" is not a tier
anyone can ship. Quoting core's standalone <!--size:core.gzip-->8.18 KB<!--/size:core.gzip--> as an
app size would be a bait-and-switch.

*(Until 0.2.0 core carried a small default renderer, and this page quoted it as a 2.3 KB tier. It
rendered text but silently dropped `@event`/`.prop`/`?bool` into the markup as literal attributes,
so the README's own counter did not work. It was removed rather than repaired.)*

**Name Van.js and Solid.** Both are smaller, and volunteering that buys more credibility than any
claim to be smallest. Both are fair trades to explain: Van.js has no keyed reconciliation, so any
list change rebuilds the list; Solid needs its compiler.

**The Solid comparison, stated precisely:** Solid is <!--size:app.solid.bytes-->4 446 B<!--/size:app.solid.bytes--> and requires its compiler;
VeraJS + own renderer is <!--size:app.bytes-->13 214 B<!--/size:app.bytes--> and requires nothing. That is the price of needing no
toolchain — say it exactly that way, because a reader who checks will find the numbers.

**VeraJS is above Lit — say it precisely.** VeraJS + own renderer
(<!--size:app.bytes-->13 214 B<!--/size:app.bytes-->) is above Lit
(<!--size:app.lit.bytes-->5 871 B<!--/size:app.lit.bytes-->) and Preact + signals
(<!--size:app.preact-signals.bytes-->6 031 B<!--/size:app.preact-signals.bytes-->); the lit-html pairing
(<!--size:app.verajs-lit-html.bytes-->10 075 B<!--/size:app.verajs-lit-html.bytes-->) is a different trade, not a smaller VeraJS — read it in the table. This paragraph said "level with Lit" long after
the figures stopped supporting it, which is exactly the drift quoting the measured number exists to
prevent.

It has moved twice: `static styles` leaving core recovered 300 B and put VeraJS under Lit at 0.2.0,
and the work since — correctness fixes, contextual namespaces, the slots seam — has put it back above, by
<!--size:app.over.lit.kb-->7.2 KB<!--/size:app.over.lit.kb--> today, after the per-key reactivity engine, automatic lists,
deferred teardown and `computed` in core. Each step was deliberate.
Quote the measured figure rather than a remembered one — this line has been wrong in both
directions.

The renderer still earns its place on speed rather than bytes; see
[performance.md](performance.md). An app that uses `static styles` adds `@verajs/styles`
(<!--size:styles.gzip-->1.27 KB<!--/size:styles.gzip--> gzipped) back, so the win belongs to apps that do not.

*(Size grew as the renderer was rebuilt for template identity and keying, and again when reactive
Map/Set moved into core and `@verajs/map-support` was retired. Both were deliberate trades. Whether
the second is still worth 1.1 KB is an open question, tracked internally — it is separate from
describing the bytes honestly.)*

## Per-module

<!--size:table.permodule-->
| Module | gzip | |
| --- | ---: | --- |
| `@verajs/core` | 8 376 B | state (incl. Map and Set), hooks, lifecycle, render |
| `@verajs/lite` | 4 315 B | the lite tier: `define`, `signal`, `html`, a renderer that patches in place |
| `@verajs/static` | 1 777 B | the static tier: `define` and `html` rendered once into markup, values never code |
| `@verajs/renderer` | 6 452 B | keyed template renderer, refs, `hold` |
| `@verajs/router` | 4 516 B | nested routes, params, wildcards, redirects, scroll memory |
| `@verajs/autoloader` | 1 911 B | lazy component discovery |
| `@verajs/styles` | 1 297 B | `static styles` adoption, shadow and light DOM |
| `@verajs/renderer/spread` | 1 704 B | `${spread(props)}` — runtime-named bindings |
| `@verajs/renderer/tag` | 2 471 B | `<${tag}>` — runtime tag names, in templates and JSX |
| `@verajs/store` | 925 B | the standalone store — subscriptions without components |
| `@verajs/jsx` | 6 031 B | the JSX transform + Vite plugin — build-time, never shipped to a page |
| `@verajs/jsx/standalone` | 2 094 B | JSX in the browser with no build — the CodePen path |
| `@verajs/store/collections` | 672 B | reactive `Map` and `Set` in a store |
| `@verajs/store/resource` | 396 B | async data as a reactive cell |
| `@verajs/renderer/keyed` | 2 757 B | `keyed()` — keyed list reconciliation |
| `@verajs/renderer/native-elements` | 626 B | `nativeElements` — `init` on a built-in host (a div, a section…) with a custom element's lifecycle, and the components of a window that goes away retired |
| `@verajs/renderer/multi-window` | 425 B | `multiWindow` — components left in a pop-out or an iframe are released when that window closes |
| `@verajs/renderer/until` | 311 B | `until(promise, fallback)` — a promise at a child position: the fallback, then its value |
| `@verajs/renderer/slots` | 6 387 B | `<slot>` distribution in a LIGHT-DOM component, and `slotted()` |
| `@verajs/renderer/namespaces` | 672 B | an `html` template parsed in the namespace of the position it lands in — SVG children of components |
| `@verajs/renderer/elements` | 800 B | behavior attached to claimed elements in templates, mounted and unmounted with their instances |
| `@verajs/renderer/portal` | 699 B | drawing into another element from a component, in a range of its own |
| `@verajs/renderer/hydration` | 3 586 B | adopting server-rendered markup — wired BESIDE the renderer (`wire([renderer, hydration])`) |
| `@verajs/renderer/hydrate-slots` | 1 675 B | hydrating light-DOM slots — the server's light-slot format, read only where both are used (`wire([renderer, hydration, slots, hydrateSlots])`) |
| `@verajs/inserts` | 363 B | the extension point |
| `@verajs/directives/core` | 6 317 B | the engine — registry, activation, context, delegation (core external) |
| `@verajs/directives/standalone` | 12 357 B | the engine with its own store, for a page running no vera |
| `@verajs/directives/expressions` | 2 361 B | the expression tier — arithmetic, comparisons, calls |
| `@verajs/directives/interactions` | 3 942 B | the interaction pack — events, reflections, state |
| `@verajs/directives/query` | 3 202 B | the query pack — route, query, list |
| `@verajs/directives/sensors` | 3 165 B | the sensors pack — environment to state |
| `@verajs/directives/remote` | 3 865 B | the remote pack — server-driven interactions |
| `@verajs/directives/motion` | 26 591 B | the motion pack — presets, easings, paint, path, sequence, split |
| `@verajs/motion/core` | 12 626 B | the motion engine — compiler + writer, no directives engine, no packs |
| `@verajs/motion/ssr` | 12 505 B | renderMotion — mark a server document, emit its sheet |
| `@verajs/motion/client` | 3 149 B | the reader — delivery, drive and functions, no compiler |
<!--/size:table.permodule-->

You only ship what you use — the modules are independent. See [module-system.md](module-system.md).

## Reproduce

```bash
cd bench && npm install && cd ..     # the competing frameworks, installed on demand
npm run build && node bench/size.mjs
```

The claims on this page are generated. After a build that moves bytes:

```bash
node bench/size.mjs --snapshot        # refresh the cross-framework table (needs bench/ installed)
node scripts/sync-size-claims.mjs     # rewrite every claim from the measurements
```

CI runs `node scripts/sync-size-claims.mjs --check` and fails if any of them has drifted.
