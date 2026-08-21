# Size

## The claim

**A working VeraJS app is about <!--size:app.kb-->5.9 KB<!--/size:app.kb--> gzipped (<!--size:app.bytes-->6 091 B<!--/size:app.bytes-->) — <!--size:app.rank-->6th<!--/size:app.rank--> of
<!--size:app.count-->10<!--/size:app.count--> frameworks measured, level with Lit and Preact, and 10x smaller than React.**

## The evidence

A minimal but *working* reactive counter, bundled with esbuild, minified, `NODE_ENV=production`,
tree-shaken, gzipped:

<!--size:table.evidence-->
| Framework | gzip | vs smallest |
| --- | ---: | ---: |
| Van.js | 1 219 B | 1.0x |
| Solid *(needs a compiler)* | 4 446 B | 3.6x |
| **VeraJS + lit-html** | **5 686 B** | 4.7x |
| Lit | 5 871 B | 4.8x |
| Preact + signals | 6 031 B | 4.9x |
| **VeraJS + own renderer** | **6 091 B** | 5.0x |
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
`vera-renderer.min.js` is <!--size:stack.bytes-->6 715 B<!--/size:stack.bytes--> gzipped against the app's <!--size:app.bytes-->6 091 B<!--/size:app.bytes-->, because a bundler
drops the core exports an app does not use.

Sizes are gzipped with `zlib.gzipSync`, and **KB means 1024 bytes**. The `gzip` command-line tool is
not equivalent — it writes the original filename and mtime into the header, inflating every figure
by 20-30 bytes.

## The honest framing

**Lead with <!--size:app.kb-->5.9 KB<!--/size:app.kb-->, not <!--size:core.gzip-->3.03 KB<!--/size:core.gzip-->.** Core alone is <!--size:core.gzip-->3.03 KB<!--/size:core.gzip--> gzipped but ships no renderer and cannot
render anything. Quoting it is technically true and reads as a bait-and-switch to exactly the
audience that checks size claims.

**Name Van.js and Solid.** Both are smaller, and volunteering that buys more credibility than any
claim to be smallest. Both are fair trades to explain: Van.js has no keyed reconciliation, so any
list change rebuilds the list; Solid needs its compiler.

**The Solid comparison, stated precisely:** Solid is <!--size:app.solid.bytes-->4 446 B<!--/size:app.solid.bytes--> and requires its compiler;
VeraJS + own renderer is <!--size:app.bytes-->6 091 B<!--/size:app.bytes--> and requires nothing. That is the price of needing no
toolchain — say it exactly that way, because a reader who checks will find the numbers.

**Do not claim to undercut Lit on size.** VeraJS + own renderer (<!--size:app.bytes-->6 091 B<!--/size:app.bytes-->) is now
*marginally larger* than Lit itself (<!--size:app.lit.bytes-->5 871 B<!--/size:app.lit.bytes-->); it is the lit-html pairing
(<!--size:app.verajs-lit-html.bytes-->5 686 B<!--/size:app.verajs-lit-html.bytes-->) that comes in under. The renderer
earns its place on speed, not bytes — see [performance.md](performance.md).

*(Size grew as the renderer was rebuilt for template identity and keying, and again when reactive
Map/Set moved into core and `@verajs/map-support` was retired. Both were deliberate trades. Whether
the second is still worth 1.1 KB is an open question, tracked internally — it is separate from
describing the bytes honestly.)*

## Per-module

<!--size:table.permodule-->
| Module | gzip | |
| --- | ---: | --- |
| `@verajs/core` | 3 101 B | state (incl. Map and Set), hooks, lifecycle, render |
| `@verajs/renderer` | 3 614 B | keyed template renderer, refs, `hold` |
| `@verajs/router` | 2 840 B | nested routes, params, wildcards, redirects, scroll memory |
| `@verajs/autoloader` | 612 B | lazy component discovery |
| `@verajs/inserts` | 322 B | the extension point |
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
