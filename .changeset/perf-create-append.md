---
'@verajs/renderer': patch
---

Two hot-path wins from the performance audit, found by counting DOM calls rather than timing

- **A nullish attribute binding no longer issues a `removeAttribute` per element on first
  commit.** `class="${cond ? 'x' : null}"` on a fresh clone was one real DOM call per element per
  create — 1,000 no-ops in the 1,000-row benchmark — guarding against the one template shape that
  genuinely needs the removal (`<b title="a" title=${null}>`, where the parser keeps the first
  duplicate). Whether the template statically writes the attribute is now read off the parsed
  template once ever and carried on the part.
- **The keyed reconciler's trailing fill batches into a fragment.** Every remaining item inserts
  before the same reference, so an append of 1,000 rows now costs one live-DOM insertion instead
  of 1,000 — the same batching the index-mode grow path always had.

Measured on `bench/dom` (min of 21 sessions, machine held awake): create-1k 14.4 → 13.3 ms and
append-1k 23.0 → 21.6 ms, both now fastest of the nine implementations; no other row moved
outside noise. Costs 32 B gzipped on the counter app and 71 B on the keyed list (still under
lit + repeat); the trade is surfaced in `docs/features/performance.md`, whose table and
methodology (microtask scheduling in the bench implementations, matching Lit and Vue's flush
model) are updated in the same pass.
