# Performance

## The claim

**Fast enough that size is the reason to choose it, not a compromise you pay for.** Not the fastest
— see the ceiling below.

## Against the field: withdrawn, being re-measured

The cross-framework table that stood here was taken on 2026-08-21, and it is **withdrawn**, because it was wrong in
ways that all flattered VeraJS:

- **Four of its seven competitors were not written at their best.** Solid was hyperscript without its compiler, Vue
  a hand-written render function without `v-memo`, Svelte compiled in legacy mode, and Van.js rebuilt every row on
  every change. Each is now written the way that framework's own
  [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) entry writes it.
- **It ran in a headless build of Chromium**, not the browsers people use.
- **It reported each framework's fastest run**, not the typical one, and it described a default scheduler VeraJS no
  longer has.

Re-measured against the corrected field, VeraJS wins creating rows and loses outright on some updates: selecting a
row (to Solid and Van.js), swapping two rows, and removing one. Those losses are being worked on. A new table will
stand here once the core is finished. It will be measured in headed browsers (installed Chrome, Firefox and
WebKit), report the median across sessions, and show every loss.

## The numbers

200 000 property reads, 20 000 writes, median of 5, jsdom on V8:

| Operation | ns/op |
| --- | ---: |
| Plain object, 2 hops (reference) | 1 |
| Store read, tracked, flat | ~140 |
| Store read, tracked, 2 nested hops | ~450 |
| Write + propagation | ~870 |

Reads and writes pay nothing for the store's extension seam: a `'store'` insert is consulted once
per type of value, rather than as a chain resolved on every property access (which is
what the `'proxy-handler'` insert used to cost before it was retired). **The table above predates the
lean-core rebuild (2026-09-27) and is due to be re-measured** once the rebuild lands.

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

Plus two correctness bugs that were costing far more than any micro-optimization:

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

**Report the typical case, across many sessions, in the browsers people use.** Each framework runs in its own fresh
browser, with a byte-identical copy of VeraJS as the noise control, and the reported figure is the median of the
session medians, with how many sessions each framework won. The fastest run is shown for reference only. Garbage
collection is one-sided noise, so the minimum is tempting, but it describes a run users rarely get. Same-page
comparisons are biased too: one framework's garbage is collected inside the next one's timed window, and an
implementation that always runs after the same neighbor keeps paying for it.

## Caveats

- **The reactivity figures are jsdom on V8**, and only those. Proxy, allocation and `Map` costs are
  representative of a browser; layout and paint are not modeled, which is exactly why the
  cross-framework table is measured in a real one instead.
- **Cross-framework numbers are one machine.** Absolute milliseconds are machine-specific; the ratios
  are the claim.
- Reads cost ~100x a plain property access. That is the price of automatic tracking, and it is the
  same trade Vue makes.

## Reproduce

```bash
npm run build
node bench/reactivity.mjs --compare bench/baseline.json
node bench/dom/build.mjs out.js      # then open in a real browser
```
