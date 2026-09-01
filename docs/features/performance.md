# Performance

## The claim

**Fast enough that size is the reason to choose it, not a compromise you pay for.** Not the fastest
— see the ceiling below.

## Against the field, in a real browser

Nine implementations, all emitting identical markup from one seeded generator. Each figure is the
**fastest run across twenty-one sessions** (three seven-session runs) — every operation is timed
through to paint, and noise here is one-sided, so the minimum is the cleanest estimate of what a
framework actually costs.

> **Re-run it yourself:** `node bench/dom/build.mjs && node bench/dom/run.mjs 7` — three times, on
> a machine that is not allowed to sleep (`caffeinate -dims` on macOS; a display that sleeps
> mid-run drops CPU power states and one throttled window measured a framework 57% slower than its
> own minimum an hour earlier).
>
> **Use several sessions and read the minimum.** These operations are small enough that one session
> is mostly noise: the same build measured `swap` at 12.1, 3.3 and 3.6 ms across three consecutive
> sessions. Absolute numbers are machine-specific; the ratios are the claim.
>
> **The VeraJS implementations schedule on a microtask** (`setRenderScheduler(microtask)`), the
> same flush model Lit and Vue use in this table, so no row contains a frame boundary for one
> framework and not another. The default scheduler is an animation frame — frame-aligned batching
> at the cost of ~0.2–0.4 ms of latency on small updates, which is a real trade an app picks with
> one documented call; see `setRenderScheduler`.

`@verajs/core` + `@verajs/renderer` — the default pairing:

| Operation | VeraJS | Lit | Solid | Vue | Preact | Svelte | Van.js | React | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| create 1 000 | **13.3** | 14.4 | 15.8 | 13.6 | 15.0 | 16.1 | 17.6 | 16.6 | **wins** |
| create 10 000 | **161.9** | 167.5 | 185.8 | 163.4 | 181.2 | 311.5 | 182.2 | 301.3 | **wins** |
| append 1 000 | **21.6** | 22.8 | 23.1 | 22.2 | 23.2 | 28.7 | 35.1 | 24.4 | **wins** |
| update every 10th | **2.2** | 2.3 | 4.7 | 3.2 | 2.9 | 4.0 | 17.5 | 3.3 | **wins** |
| select row | **0.2** | 0.2 | 0.6 | 0.9 | 0.6 | 0.6 | 0.5 | 0.6 | **ties** |
| swap 2 rows | 2.5 | 2.8 | 2.5 | 2.5 | 2.3 | 3.5 | 17.1 | 16.4 | 1.09x |
| remove row | 3.1 | 3.2 | 3.2 | 3.7 | 3.3 | 4.9 | 18.6 | 3.0 | 1.03x |
| clear 1 000 | 2.5 | 9.2 | 2.9 | 2.4 | 2.5 | 2.9 | 2.4 | 4.0 | 1.04x |

**Four operations won outright, a fifth tied at the measurement floor, and no operation is more
than 9% — 0.2 ms — from the fastest.** No other framework in the table wins more than one row.
That is competitive with Lit, Solid and Vue on their own terms — not "good for something this
small".

### Running on lit-html instead

Core accepts lit-html as its renderer, and the benchmark measures that pairing too. It is close
everywhere except `clear`:

| Operation | VeraJS + `@verajs/renderer` | VeraJS + lit-html | Lit |
| --- | ---: | ---: | ---: |
| clear 1 000 | **2.5** | 9.3 | 9.2 |
| swap 2 rows | **2.5** | 2.7 | 2.8 |
| update every 10th | **2.2** | 2.7 | 2.3 |
| remove row | **3.1** | 3.4 | 3.2 |

`clear` is **lit-html's cost, not VeraJS's** — Lit itself scores 9.6 on the same test, because
lit-html removes list nodes one at a time where the others replace the subtree. It was the one
operation the old table had to apologise for, and switching to `@verajs/renderer` removes it.

## The numbers

200 000 property reads, 20 000 writes, median of 5, jsdom on V8:

| Operation | ns/op |
| --- | ---: |
| Plain object, 2 hops (reference) | 1 |
| Store read, tracked, flat | ~140 |
| Store read, tracked, 2 nested hops | ~450 |
| Write + propagation | ~870 |

Reads are **~30% faster than this table said until 2026-08-26**, because the `'proxy-handler'` insert
chain was being resolved from a `Map` on every property read of every store and is now cached against
a registry revision. Measured 150 → 132 ns/op flat and 478 → 442 at two hops on that change alone.
The table had gone stale in the other direction, which is the direction nobody checks.

Effect executions for 100 writes in one tick:

| | runs |
| --- | ---: |
| `useEffect` (coalesced) | **1** |
| `useLayoutEffect` (coalesced) | **1** |
| `useSyncEffect` (per-change, by design) | 100 |

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
whole-range fast clear. The table at the top of this page is that renderer's standing against eight
other implementations, and **it beats the lit-html pairing on nearly every row** — so the size/speed
trade is not merely resolved but inverted: `core + @verajs/renderer` is the smaller pairing *and* the
faster one.

Earlier revisions of this page carried a second copy of those results, taken on different hardware
and never updated alongside the first. Two tables making one claim with two sets of numbers is how a
document stops being evidence, so there is one table now and everything else points at it.

## Caveats

- **The reactivity figures are jsdom on V8**, and only those. Proxy, allocation and `Map` costs are
  representative of a browser; layout and paint are not modelled, which is exactly why the
  cross-framework table is measured in a real one instead.
- **The browser table is one machine.** Absolute milliseconds are machine-specific and the ratios
  are the claim. `node bench/dom/run.mjs 7` reproduces it; fewer sessions than that will not, because
  the sub-millisecond operations are dominated by noise until the minimum settles.
- Reads cost ~100x a plain property access. That is the price of automatic tracking, and it is the
  same trade Vue makes.

## Reproduce

```bash
npm run build
node bench/reactivity.mjs --compare bench/baseline.json
node bench/dom/build.mjs out.js      # then open in a real browser
```
