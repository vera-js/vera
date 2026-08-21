# Performance

## The claim

**Fast enough that size is the reason to choose it, not a compromise you pay for.** Not the fastest
— see the ceiling below.

## Against the field, in a real browser

Fastest of seven runs, means of three sessions, all seven implementations emitting identical markup.
`core + lit-html`:

| Operation | VeraJS | Lit | Solid | Vue | Van.js | React | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| select row | **0.3** | 0.3 | 0.7 | 0.9 | 0.5 | 0.6 | **wins** |
| swap 2 rows | **3.5** | 3.6 | 3.6 | 4.3 | 43.1 | 36.5 | **wins** |
| update every 10th | 4.3 | 4.2 | 8.3 | 5.1 | 42.1 | 5.0 | 1.02x |
| append 1 000 | 37.9 | 38.6 | 40.5 | 36.7 | 130.3 | 38.9 | 1.03x |
| remove row | 5.1 | 5.3 | 5.0 | 5.9 | 42.9 | 5.3 | 1.03x |
| create 10 000 | 348.6 | 364.9 | 386.4 | 335.1 | 395.2 | 546.1 | 1.04x |
| create 1 000 | 39.0 | 37.4 | 39.8 | 32.3 | 38.0 | 36.0 | 1.21x |
| clear 1 000 | 22.3 | 22.0 | 8.3 | 6.9 | 5.6 | 7.4 | **3.98x** |

**Within 5% of the fastest on six of eight operations, winning two outright.** That is competitive
with Lit, Solid and Vue outright — not "good for something this small".

`clear` is the exception, and it is **lit-html's cost, not VeraJS's**: Lit scores 22.0 on the same
test. lit-html removes list nodes one at a time; Van.js replaces the subtree. Worth stating whenever
the table is shown, because otherwise it reads as a VeraJS weakness.

## The numbers

200 000 property reads, 20 000 writes, median of 5, jsdom on V8:

| Operation | ns/op |
| --- | ---: |
| Plain object, 2 hops (reference) | 2 |
| Store read, tracked, flat | ~200 |
| Store read, tracked, 2 nested hops | ~630 |
| Write + propagation | ~900 |

Effect executions for 100 writes in one tick:

| | runs |
| --- | ---: |
| `useEffect` (coalesced) | **1** |
| `useLayoutEffect` (coalesced) | **1** |
| `useSyncEffect` (per-change, by design) | 99 |

## What changed, and why it is worth saying

This was profiled for the first time in August 2026 and the first pass found four real defects:

| | Before | After |
| --- | ---: | ---: |
| tracked read, flat | 1 956 ns | ~200 ns |
| tracked read, 2 hops | 6 045 ns | ~630 ns |
| write + propagation | 1 905 ns | ~900 ns |

Plus two correctness bugs that were costing far more than any micro-optimisation:

- **Dependency sets grew without bound.** A new `WeakRef` per hook run meant `Set.add` never deduped,
  so writes degraded **1 810x over 2 000 re-runs** — an app got slower the longer it ran. Now flat
  across 32 000.
- **Dependencies were only tracked on the initial render**, so conditional rendering silently froze.

**Do not hide this history when publishing.** "We profiled it, found real problems, fixed them, and
here is the harness so you can check" is a stronger signal than numbers with no provenance.

## The ceiling — state this plainly

**VeraJS re-runs the template and diffs. Solid compiles to direct DOM updates with no re-render.**
Its update performance is Vue/React-class, not Solid-class.

This is not a bug to be fixed. It is the direct consequence of being buildless: **compiler-level
fine-grained updates and no-build-step are mutually exclusive.** Say so first, rather than being
benchmarked against Solid and judged to have lost something you never claimed.

## Measuring this honestly

**Report the fastest run, not the median.** Noise in a DOM benchmark is one-sided — a garbage
collection can only make a run slower — so the minimum is the cleanest estimate of real cost.

This was learned the hard way. Across three runs of the same build, the *median* handed the
10 000-row win to a different framework each time (Vue, Solid, then VeraJS) at an almost identical
~392 ms, while every framework's *minimum* held stable within 1–2%. The median was measuring the
garbage collector. Any published number should say which statistic it is.

**`@verajs/renderer` was rebuilt from the ground up and is browser-confirmed.** Template-identity
architecture, keyed reconciliation built in, element-mode list items, comment-free templates,
whole-range fast clear. Three browser sessions, fastest-of-7 each, seven implementations emitting
identical markup:

| Operation | VeraJS own | best other | standing |
| --- | ---: | ---: | --- |
| create 10 000 | **~327 ms** | Vue ~339 | **fastest — won all three runs** |
| append 1 000 | **~34.9 ms** | Vue ~36.9 | **fastest — won all three runs** |
| select row | **0.1–0.3 ms** | Lit 0.2–0.3 | fastest/tied; the 0.1 is the best figure recorded |
| swap 2 rows | 3.3–3.5 ms | Lit 3.3–3.7 | fastest 2 of 3 |
| update every 10th | 4.1–4.2 ms | Lit 3.9–4.4 | tied fastest |
| remove row | 4.8–5.2 ms | VeraJS+lit 4.6–5.3 | Vera family fastest |
| clear 1 000 | 4.7–8.4 ms | Van/Solid 5.3–9.4 | competitive; the 4.7 is the best recorded |
| create 1 000 | ~35.1 ms | Vue ~33.4 | 2nd, within 5% — won one of three runs |

**It also beats the lit-html pairing on nearly every row**, so the size/speed contradiction is not
just resolved but inverted: `core + @verajs/renderer` is the smaller pairing AND the faster one.
The one remaining non-win is create-1 000 against Vue, ~5% with overlapping ranges.

## Caveats

- **Measured under jsdom on V8.** Proxy, allocation and Map costs are representative of a browser;
  layout and paint are not modelled.
- **No browser-based comparison against other frameworks has been run yet.** The DOM harness in
  `bench/dom/` exists and is verified to emit identical markup across VeraJS, Lit, Van.js and
  React — but until it has been run on real hardware, **no cross-framework speed claim should be
  published.**
- Reads cost ~100x a plain property access. That is the price of automatic tracking, and it is the
  same trade Vue makes.

## Reproduce

```bash
npm run build
node bench/reactivity.mjs --compare bench/baseline.json
node bench/dom/build.mjs out.js      # then open in a real browser
```
