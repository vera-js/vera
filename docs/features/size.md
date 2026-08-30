# Size

## The claim

**A working VeraJS app is about <!--size:app.kb-->6.1 KB<!--/size:app.kb--> gzipped (<!--size:app.bytes-->6 205 B<!--/size:app.bytes-->) — <!--size:app.rank-->6th<!--/size:app.rank--> of
<!--size:app.count-->10<!--/size:app.count--> frameworks measured, level with Lit and Preact, and 10x smaller than React.**

## The evidence

A minimal but *working* reactive counter, bundled with esbuild, minified, `NODE_ENV=production`,
tree-shaken, gzipped:

<!--size:table.evidence-->
| Framework | gzip | vs smallest |
| --- | ---: | ---: |
| Van.js | 1 219 B | 1.0x |
| Solid *(needs a compiler)* | 4 446 B | 3.6x |
| **VeraJS + lit-html** | **5 447 B** | 4.5x |
| Lit | 5 871 B | 4.8x |
| Preact + signals | 6 031 B | 4.9x |
| **VeraJS + own renderer** | **6 205 B** | 5.1x |
| petite-vue | 7 258 B | 6.0x |
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
`vera-renderer.min.js` is <!--size:stack.bytes-->6 994 B<!--/size:stack.bytes--> gzipped against the app's <!--size:app.bytes-->6 205 B<!--/size:app.bytes-->, because a bundler
drops the core exports an app does not use.

## Measured on a list, not only a counter

A counter is the shape that flatters a directive-first design: everything a list needs sits behind
an import a counter never makes, so quoting only a counter reports the comparison at its least
representative point. The same measurement on a **keyed list** — the thing every real app does, and
the thing reconciliation exists for:

| | gzipped |
| --- | ---: |
| VeraJS + `@verajs/renderer` + `/keyed` | **<!--size:list.bytes-->6 683 B<!--/size:list.bytes-->** |
| Lit + `directives/repeat` | <!--size:list.lit.bytes-->6 826 B<!--/size:list.lit.bytes--> |

<!--size:list.vs-lit.bytes-->143 B<!--/size:list.vs-lit.bytes--> in our favour, against Lit's lead on the counter. Both numbers are real and both are
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

**<!--size:app.static.kb-->5.0 KB<!--/size:app.static.kb--> gzipped
(<!--size:app.static.bytes-->5 120 B<!--/size:app.static.bytes-->) —
<!--size:app.static.underlit-->751 B<!--/size:app.static.underlit--> under Lit.**

Two things this is not. It is **not the same app** as the rows in the table above — it renders once
and updates nothing, where every one of those renders reactive state, so it is a page against their
applications and is kept out of that comparison for exactly that reason. And it is **not a separate
build or a flag**: no import, no configuration, nothing asked of the author. It is what a bundler
already produces from the same package when the code does not reach for a store.

## The honest framing

**There is no smaller honest number than <!--size:app.kb-->6.1 KB<!--/size:app.kb-->.** Core ships no
renderer — `render()` with none registered warns and paints nothing — so "core alone" is not a tier
anyone can ship. Quoting core's standalone <!--size:core.gzip-->3.00 KB<!--/size:core.gzip--> as an
app size would be a bait-and-switch.

*(Until 0.2.0 core carried a small default renderer, and this page quoted it as a 2.3 KB tier. It
rendered text but silently dropped `@event`/`.prop`/`?bool` into the markup as literal attributes,
so the README's own counter did not work. It was removed rather than repaired — see
`internal/docs/TODO.md`.)*

**Name Van.js and Solid.** Both are smaller, and volunteering that buys more credibility than any
claim to be smallest. Both are fair trades to explain: Van.js has no keyed reconciliation, so any
list change rebuilds the list; Solid needs its compiler.

**The Solid comparison, stated precisely:** Solid is <!--size:app.solid.bytes-->4 446 B<!--/size:app.solid.bytes--> and requires its compiler;
VeraJS + own renderer is <!--size:app.bytes-->6 205 B<!--/size:app.bytes--> and requires nothing. That is the price of needing no
toolchain — say it exactly that way, because a reader who checks will find the numbers.

**VeraJS is level with Lit, not under it — say it precisely.** VeraJS + own renderer
(<!--size:app.bytes-->6 205 B<!--/size:app.bytes-->) is within ten bytes of Lit
(<!--size:app.lit.bytes-->5 871 B<!--/size:app.lit.bytes-->), currently on the wrong side of it, and under
Preact + signals (<!--size:app.preact-signals.bytes-->6 031 B<!--/size:app.preact-signals.bytes-->); the lit-html
pairing (<!--size:app.verajs-lit-html.bytes-->5 447 B<!--/size:app.verajs-lit-html.bytes-->) is lower still. A gap that
small is not a claim in either direction — "level with Lit" is the honest sentence, and it survives
the next commit either way, which "under Lit" does not. The ordering has already changed twice.

It has moved twice: `static styles` leaving core recovered 300 B and put VeraJS under Lit at 0.2.0,
and the correctness work after it spent 199 B and gave the position back. Both were deliberate.
Quote the measured figure rather than a remembered one — this line has been wrong in both
directions.

The renderer still earns its place on speed rather than bytes; see
[performance.md](performance.md). An app that uses `static styles` adds `@verajs/styles`
(<!--size:styles.gzip-->650 B<!--/size:styles.gzip--> gzipped) back, so the win belongs to apps that do not.

*(Size grew as the renderer was rebuilt for template identity and keying, and again when reactive
Map/Set moved into core and `@verajs/map-support` was retired. Both were deliberate trades. Whether
the second is still worth 1.1 KB is an open question, tracked internally — it is separate from
describing the bytes honestly.)*

## Per-module

<!--size:table.permodule-->
| Module | gzip | |
| --- | ---: | --- |
| `@verajs/core` | 3 074 B | state (incl. Map and Set), hooks, lifecycle, render |
| `@verajs/renderer` | 3 920 B | keyed template renderer, refs, `hold` |
| `@verajs/router` | 3 651 B | nested routes, params, wildcards, redirects, scroll memory |
| `@verajs/autoloader` | 1 222 B | lazy component discovery |
| `@verajs/styles` | 650 B | `static styles` adoption, shadow and light DOM |
| `@verajs/renderer/spread` | 869 B | `${spread(props)}` — runtime-named bindings |
| `@verajs/renderer/tag` | 1 467 B | `<${tag}>` — runtime tag names, in templates and JSX |
| `@verajs/reactivity/computed` | 241 B | memoised derived values |
| `@verajs/reactivity/collections` | 576 B | reactive `Map` and `Set` in a store |
| `@verajs/renderer/keyed` | 599 B | `keyed()` — keyed list reconciliation |
| `@verajs/inserts` | 357 B | the extension point |
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
