# Benchmarks

## Install first

The competing frameworks live here, not in the root `package.json`, so a root `npm ci` does not
pull ten frameworks in for contributors or for CI:

```bash
cd bench && npm install
```

`bench/` is deliberately **not** a workspace member. Run the harnesses from the repository root as
shown below — they resolve `@verajs/*` from the built `dist`, and the competitors from
`bench/node_modules`.

Four harnesses:

| | What it measures |
| --- | --- |
| `reactivity.mjs` | the store's read/write cost, against itself over time |
| `ssr-scan.mjs` | `@verajs/ssr` render speed against any git ref, cold and steady |
| `size.mjs` | bundle size against seven competing frameworks |
| `dom/` | the js-framework-benchmark DOM workload, in a real browser |

## Reactivity

```bash
npm run build          # benchmarks measure the SHIPPED bundle, not source
node bench/reactivity.mjs
node bench/reactivity.mjs --compare bench/baseline.json    # before/after a change
node bench/reactivity.mjs --baseline bench/baseline.json   # re-record the reference
```

`baseline.json` is the committed reference. Per `docs/CODE-PRINCIPLES.md` #4, anything touching a
hot path states before/after numbers — `--compare` produces them.

## SSR, before and after

```bash
npm run build
node bench/ssr-scan.mjs --compare 46060d3                       # the published SSR performance table
node bench/ssr-scan.mjs --compare HEAD~1 --only content,compile   # a change against its parent
```

Builds `@verajs/ssr` from the ref into `bench/.cache/` (gitignored, inside the tree so it resolves the same
`@verajs/core`), then runs each workload in a fresh process per round — the ref, HEAD, and a byte-identical copy of
HEAD as the A/A control, in a seeded shuffled order. Every process reports **two** numbers: the total of its first
calls from cold, and the time per call after a long warm-up. **Never one window after a fixed warm-up**: that measures
when V8 tiers the code up as much as how fast it is, and it once reported a change 28% slower that was faster on both
counts. It waits for Spotlight to stay under 10% for 30 seconds before the first timed process (a build, and the
copies it makes, wake the indexer), prints the load it saw, and still flags any row whose A/A gap is past 2% — the
machine was busy; let it settle and run again.

## Reading the results

**The tracked/untracked split is the important one.** `addCallback` returns early when no hook is on
the queue, so reads *outside* a hook skip dependency registration entirely. Only the **tracked**
rows describe what happens inside a real render.

`tracked + insert` wires a passthrough `'store'` insert that wraps core's `get`. The insert is
consulted once per type of value, so what that row adds is one call through the composed trap per read.

## Size

```bash
cd bench && npm install && cd ..     # once
npm run build && node bench/size.mjs
node bench/size.mjs --snapshot       # refresh bench/size-snapshot.json, which the docs generate from
```

`size-snapshot.json` is committed so `scripts/sync-size-claims.mjs` can regenerate the published
comparative table without the ten frameworks installed. CI cannot rebuild it, but it does check that
the snapshot still describes the current `dist` — so a build that moves bytes fails until the
snapshot is refreshed.

Bundles a minimal but **working** reactive counter per framework with esbuild (minified,
`NODE_ENV=production`, tree-shaken) and gzips it. Gzipping a raw `dist` file instead would ignore
tree-shaking, and would hide that some libraries need two packages to render anything.

## DOM

```bash
node bench/dom/build.mjs                       # writes bench/dom/bundle.js
npx http-server bench/dom -p 8080 -s           # or any static server
open http://localhost:8080/                    # then press Run
```

`bench/dom/index.html` is the page; `bundle.js` is generated and gitignored, so build before
serving. Results are also left on `window.__RESULTS__` and printed to the console as JSON, which is
how a script can drive it.

Must run in a **real browser** — jsdom does no layout or paint, so its timings are meaningless for
this. Each operation is timed through to paint (`requestAnimationFrame` plus a macrotask), because a
framework that returns quickly while deferring its DOM work has not done the job faster. React is
driven with `flushSync` so its work lands inside the measurement.

All four implementations are verified to emit **identical markup** from one seeded generator across
create / select / update / swap / remove / clear. If they diverge, the comparison is invalid.

## Caveats

Runs under jsdom on V8. Proxy, allocation and Map costs are representative of a browser; layout and
paint are not modeled. A browser-based comparison against Lit, Solid and Van.js is still needed
before publishing any performance claim.


## `ssr.mjs` — server rendering throughput

Rotated rounds, fastest-of-7 with medians, two fixtures (small component, 100-row table).
Contenders: the vera-native pipeline (the only row rendering a real component — element + store +
hooks + declarative shadow DOM), vera's serializer alone (the symmetrical comparison), react-dom/
server, vue/server-renderer (compiled path), @lit-labs/ssr (bare templates). 2026-08-21 numbers:
on the 100-row table vera's serializer is fastest outright (73 µs, ahead of Vue's compiled 97 µs);
the full component pipeline (104 µs) stays within 9% of Vue while lit (516 µs) and React (807 µs)
trail 5–8x. Small-fixture flattening favors lit's tuned statics path; the list-heavy shape is the
one real pages have. Server throughput only — hydration excluded for everyone alike.
