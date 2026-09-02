# `@verajs/motion/easings`

Non-linear curve shaping — `ease` values other than `linear`.

**0.7 KB gzip.** A separate module because `linear` is the default and most pages never leave it:
the bezier solver and the step function were bytes every page paid for a feature it was not using.

```js
import { createMotion, wireMotion } from '@verajs/motion';
import { easings } from '@verajs/motion/easings';

wireMotion(easings);
createMotion().init();
```

## What it accepts

| form | example |
|---|---|
| keyword | `ease`, `ease-in`, `ease-out`, `ease-in-out` |
| bezier | `cubic-bezier(0.33, 1, 0.68, 1)` |
| steps | `steps(4, end)` |

The keywords are the CSS spec's control points, so a curve here and the same keyword in CSS have
the same shape.

## `ease`, not `inertia-ease`

These are two different things and only one of them needs this module.

| | `ease` | `inertia-ease` |
|---|---|---|
| shapes | the **curve** — value against scroll position | the **catch-up** — how the element chases the target |
| evaluated by | this library, per segment, in `timing.ts` | CSS, on the compositor |
| needs this module | **yes** | **no** |
| reaches a `when` element | **no** — refused and reported | **yes** |

`inertia-ease` is validated in core and handed to CSS as a string, so it works with nothing wired.
`ease` has to become an actual function to shape a curve, and that function is what this module
supplies — through the `easing` insert point, resolved in `runtime.ts`.

Same vocabulary, validated by the same `parseEasing`. Do not merge them.

**A `when` element can use only one of them.** It sits at `lowestStart` or `highestEnd` and steps
between the two, so it is never *between* keyframes and `ease` is evaluated at an endpoint every
time, where it cannot change the answer. That was silent until 2026-09-01 and is reported now, naming
`inertia-ease` — which shapes the change between the states, is handed to CSS, and reaches a `when`
element exactly as it reaches a scrolled one. `transform-inertia` and `filter-inertia` are unaffected
too; only `ease` is refused.

## Without it

The runtime still runs. Every curve is a straight line, and it **says so once in the console and on
every affected element in `instance.rejected`** rather than animating quietly wrong. That is the
whole failure mode: not an error, not a broken page, just a page where every `ease` you wrote did
nothing.

The `rejected` half was missing until 2026-08-28. One console line per page is a report to a
developer with devtools open; it is nothing at all to the GUI this library exists for, which renders
`rejected` and cannot read a console — and this is the quietest failure the library has, because the
attribute parses, validates against the same `parseEasing` this module uses, and produces an element
that animates. Costs 17 bytes gzipped.

Applies per segment, the way `@keyframes` does — a three-keyframe animation eases into the middle
keyframe and out of it, rather than easing once across the whole timeline.

The message names where the value came from. An element that wrote the attribute is reported as
`data-vera-motion-ease="…"`; an element that inherited the instance default is reported as an
option, because it does not carry the attribute and a GUI told otherwise goes looking for markup
that is not there.

## When a resolver throws

The curve goes linear for that element and the reason lands in `instance.rejected`, naming the
element — the instance still initialises and every other element still animates. That is not a
courtesy to badly-written modules: `easing` is the only insert chain whose links return a value, so
it has its own loop rather than going through `runInserts`, and it was the last of the five left
unguarded. An exception there left `init()` having adopted **no elements at all**.

## How the bezier is solved

Newton-Raphson until it converges — usually one or two steps — and **bisection when it does not**.

This used to be Newton alone, on the stated reasoning that the only failure was a zero derivative,
and that returning the current estimate there was correct enough and smaller. That was wrong, and
not marginally. A derivative approaching zero does not stall Newton-Raphson; it throws the estimate
out of the interval, and the next iteration compounds it:

| curve | returned | correct |
|---|---|---|
| `cubic-bezier(1, 0, 0, 1)` at 0.5 | **8,900** | 0.5 |
| `cubic-bezier(1, 0, 1, 0)` at 0.999 | **2.7e5** | 0.48 |
| `cubic-bezier(0, 0, 0, 1)` at 0.001 | **5.6e5** | ~0 |

Every one of those is a legal easing, nothing refuses them, and an author who wrote one got an
element several hundred pixels from where they put it. Six of a twenty-one curve survey were
affected. Measured against three real engines in `spikes/easing-oracle.mjs`, three disagreed with
Chromium by up to **0.62** — the library returning 1 where the engine returned 0.378.

The bezier coverage there had been a single well-behaved curve, which is why this survived: the
shapes that break the solver are the ones nobody had put in the list.

The early exit on convergence is what pays for the fallback. The fixed five iterations became one
or two for every curve anyone writes, so the ordinary path is now **cheaper** than what it replaced
— `ease-in-out` 44.4 → 22.6 ns per call, `ease-out` 44.3 → 31.3, `ease-in` 47.4 → 41.3, `ease`
unchanged at ~14. Only the curves that used to be wrong pay for the bisection, at 85 and 119 ns,
which is the right way round.

Bisection stops after twenty halvings, putting `t` within 1e-6 — finer than a pixel at any scroll
length, and `x(t)` is monotonic across `[0, 1]` for any control points CSS allows, so halving cannot
miss the root.
