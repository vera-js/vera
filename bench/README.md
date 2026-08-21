# Benchmarks

Three harnesses:

| | What it measures |
| --- | --- |
| `reactivity.mjs` | the store's read/write cost, against itself over time |
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

## Reading the results

**The tracked/untracked split is the important one.** `addCallback` returns early when no hook is on
the queue, so reads *outside* a hook skip dependency registration entirely. Only the **tracked**
rows describe what happens inside a real render.

`tracked + insert` registers a passthrough `'proxy-handler'` insert (Map/Set support itself now lives in core). Insert chains are
walked on every read, so how they are stored shows up in that row and nowhere else.

## Size

```bash
npm run build && node bench/size.mjs
```

Bundles a minimal but **working** reactive counter per framework with esbuild (minified,
`NODE_ENV=production`, tree-shaken) and gzips it. Gzipping a raw `dist` file instead would ignore
tree-shaking, and would hide that some libraries need two packages to render anything.

## DOM

```bash
node bench/dom/build.mjs out.js     # bundles VeraJS, Lit, Van.js and React together
```

Must run in a **real browser** — jsdom does no layout or paint, so its timings are meaningless for
this. Each operation is timed through to paint (`requestAnimationFrame` plus a macrotask), because a
framework that returns quickly while deferring its DOM work has not done the job faster. React is
driven with `flushSync` so its work lands inside the measurement.

All four implementations are verified to emit **identical markup** from one seeded generator across
create / select / update / swap / remove / clear. If they diverge, the comparison is invalid.

## Caveats

Runs under jsdom on V8. Proxy, allocation and Map costs are representative of a browser; layout and
paint are not modelled. A browser-based comparison against Lit, Solid and Van.js is still needed
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
