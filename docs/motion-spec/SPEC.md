# The shared motion surface — vera ↔ omni

The unified grammar and observable behaviour of `data-vd-motion` (vera) and `data-omni-motion`
(omni). **The contract is the attribute grammar and what a page observably does — never the
implementation.** Engines stay free behind it; conformance is pinned by the fixtures beside this
file, run by both repos.

Vera is the primary product and the guide; omni follows unless a divergence is recorded in
`DIVERGENCES.md`. Spec changes are negotiated between the two sessions and ratified by the owner
before landing — this file only ever contains ratified state.

## The attribute — three forms

```
"fade-up"                                a preset name (a wired preset pack resolves it)
"{ preset: 'fade-up', scroll: '60%' }"   a preset, tuned — explicit keys always win
"{ keyframes: { … }, …settings }"        the full object
```

## The object — two halves

Animated properties live inside `keyframes:`; settings live outside it. **Inside `keyframes`, `%`
is progress along the animation. Outside, `%` is a position on the screen** (0% top, 100% bottom,
like CSS `top:`). A key in the wrong half is refused by name with the move spelled out.

Progress runs 0–100 like CSS keyframes. The ±300% extrapolation range lives on `scroll`, where
"begin before the element is anywhere near the screen" is a real capability.

## Keyframes

- Value grammar: `'<progress%> <value>'` pairs, comma-separated; a lone value is the end value.
- Width bands merge over the base: `'…; [phone]: …'` (registered name) or `'…; [0-560]: …'`.
- Per-property easing: the nested form `{ frames: '…', ease: '…' }`.
- The property table is **generated data**, never prose: `packages/directives/motion-vocabulary.json`
  in the vera repo (regenerate: `node scripts/sync-diagnostics.mjs`; drift-pinned by its `--check`).

## Settings

| key | value | behaviour (observable) |
| --- | --- | --- |
| `scroll` | `'a'` or `'a, b'` | **where it begins and ends** — one token = leading edge at that screen %; long form `'<edge> <screen %>'`; comma required (a space pair is a single alignment). Scrub spreads progress across the span; play runs at each end |
| `play` | **bare number, SECONDS** (ratified 2026-09-09; `'600ms'` is refused) | crossing the first `scroll` line runs the keyframes over that time; a second line is the EXIT (reverse); one line reverses crossing back; per-segment easing applies during the run |
| `when` | host-native condition — **selector in vera, expression in omni** (see DIVERGENCES) | **gates**: animates while true, rests at its start otherwise; `when` + `play` = a UI transition; RESERVED: a value beginning `.` `#` `[` `:` (or containing a combinator) is always a selector; a bare identifier/expression is reserved for a future state-expression gate and MUST NOT be given selector meaning — bare tag-name selectors are deliberately sacrificed (nobody gates motion on `div`). Ratified 2026-09-09 |
| `run-once` | boolean | first forward play latches at the end, forever — survives gates closing and attribute edits |
| `anchor` | `'self'` (default) \| `'root'` (`'document'`/`'window'` synonyms — the scroller itself) \| `'closest(<selector>)'` — nearest matching ancestor **including the element itself** (platform `Element.closest` semantics, ratified 2026-09-09) \| `'<selector>'` — first match in the element's own root | whose box `scroll` measures. Implementation order is inverted across engines: vera ships bare selectors today, keywords + `closest()` post-stage-5; omni ships keywords + `closest()` today, bare selectors next |
| `ease` | CSS timing function, verbatim | per-SEGMENT curve (the CSS model on both sides); COMPOSES with `play` (lift executed both engines 2026-09-10) — the play clock is linear and the easing reshapes each segment as the ramp sweeps it |
| `inertia` | seconds | smoothing toward the scrub target; refused beside `play` (they contend for the same write) |
| `progress` | `'--name'` → custom property; bare `name` → state key | **exposes the number**; destination by name shape |
| `stagger` | offset, on the PARENT | offsets siblings — scroll-space under scrub; per-sibling time delay under play (pending) |
| `preset` | name | expands FIRST wherever written; explicit keys always win; preset tables merge, explicit pack over shipped |
| `tick` | bare identifier — a registered function's NAME, never code | the third destination: the element's number handed to registered JS (`wireFunctions` in vera), for what CSS cannot express; may be the whole animation (no `keyframes`); a throwing tick is disabled per element and reported. Registry semantics: first registration wins, collisions reported. vera: shipped; omni: grammar reserved (see DIVERGENCES) |

## The engine sentence (shared, ratified)

> One number per element — how far through its `scroll` range it is — aimed at generated CSS.
> Scroll drives it (scrub) or a rAF ramp drives it (play). WAAPI-free on both sides.

Load-bearing measurements behind that sentence (all in vera's browser suites, independently
confirmed on omni's harness where noted):

- `@keyframes` names resolve per tree scope, engines DISAGREE on document fallback → rules are
  delivered into the tree that uses them. `@property` registration reaches shadow trees in all
  three engines → registered once. (`tests/browser/keyframes-tree-scope.test.js`)
- A transition on the registered variable does NOT retime `animation-delay: calc(var(--p) * -1s)` —
  the delay resolves to the transition's target immediately, unanimously (3/3 engines, both
  harnesses; beware the parent-inheritance phantom recorded in the test). Hence the rAF ramp.
  (`tests/browser/motion-registry.test.js`)
- An unregistered custom property flips at the transition midpoint instead of interpolating —
  registration is a requirement, not decoration.

## Fixtures

`fixtures/` holds the shared corpus both repos run. Contribution flow: either side adds cases here;
the other vendors. Current contents are indexed in `fixtures/README.md`.
