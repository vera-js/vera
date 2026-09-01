# Performance

## The claim

**Fast enough that size is the reason to choose it, not a compromise you pay for.** Not the fastest
— see the ceiling below.

## Against the field, in a real browser

Nine implementations, all emitting identical markup from one seeded generator. Each figure is the
**fastest run across seven sessions** — every operation is timed through to paint, and noise here is
one-sided, so the minimum is the cleanest estimate of what a framework actually costs.

> **Re-run it yourself:** `node bench/dom/build.mjs && node bench/dom/run.mjs 7`.
>
> **Use several sessions and read the minimum.** These operations are small enough that one session
> is mostly noise: the same build measured `swap` at 12.1, 3.3 and 3.6 ms across three consecutive
> sessions, and `select` at 5.8 ms across a three-session minimum that seven sessions put at 0.3.
> Absolute numbers are machine-specific; the ratios are the claim.

`@verajs/core` + `@verajs/renderer` — the default pairing:

| Operation | VeraJS | Lit | Solid | Vue | Preact | Svelte | Van.js | React | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| select row | **0.3** | 0.4 | 0.8 | 1.0 | 0.6 | 0.8 | 0.5 | 0.7 | **wins** |
| swap 2 rows | **2.3** | 3.3 | 3.1 | 3.0 | 3.2 | 4.3 | 19.1 | 17.2 | **wins** |
| create 1 000 | **14.8** | 15.9 | 17.9 | 15.1 | 15.3 | 17.6 | 17.0 | 16.7 | **wins** |
| create 10 000 | **163.6** | 168.4 | 196.9 | 167.4 | 182.9 | 319.5 | 183.7 | 308.7 | **wins** |
| update every 10th | 2.5 | 2.6 | 4.9 | 3.5 | 3.3 | 4.1 | 19.4 | 3.9 | 1.04x |
| append 1 000 | 23.7 | 22.8 | 23.6 | 23.6 | 25.3 | 29.8 | 35.8 | 24.6 | 1.04x |
| remove row | 3.5 | 3.5 | 4.0 | 3.9 | 3.4 | 5.1 | 18.2 | 3.5 | 1.17x |
| clear 1 000 | 2.8 | 9.6 | 3.0 | 2.6 | 2.7 | 2.8 | 2.3 | 3.8 | 1.22x |

**Four operations won outright, six of eight within 5% of the fastest, and 1.22x at worst.** That is
competitive with Lit, Solid and Vue on their own terms — not "good for something this small".

### Running on lit-html instead

Core accepts lit-html as its renderer, and the benchmark measures that pairing too. It is close
everywhere except `clear`:

| Operation | VeraJS + `@verajs/renderer` | VeraJS + lit-html | Lit |
| --- | ---: | ---: | ---: |
| clear 1 000 | **2.8** | 9.9 | 9.6 |
| swap 2 rows | **2.3** | 2.9 | 3.3 |
| update every 10th | 2.5 | **2.4** | 2.6 |
| remove row | 3.5 | **3.0** | 3.5 |

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
