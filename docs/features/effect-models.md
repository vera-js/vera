# Both effect models

**The strongest differentiator. No other framework measured offers all three of these.**

## The claim

VeraJS gives you batched effects *and* per-change effects, and tells you what changed. Pick the
model that fits the problem instead of the one your framework picked for you.

## The evidence

Three writes to the same value in one tick — `a = 1; a = 2; a = 3` — and what the effect observed:

| Framework | runs | values observed | tells you what changed |
| --- | ---: | --- | :---: |
| Vue `watchEffect` | 1 | `[3]` | no |
| React `useEffect` | 1 | `[3]` | no |
| Solid `createEffect` | 3 | `[1,2,3]` | no |
| Preact signals `effect` | 3 | `[1,2,3]` | no |
| **VeraJS `useEffect`** | **1** | `[3]` | **yes** |
| **VeraJS `useSyncEffect`** | **3** | `[1,2,3]` | **yes** |

Vue and React batch. Solid and Preact do not — theirs run synchronously, so each pass sees a
different value, which is a real capability. **VeraJS is the only one that offers both.**

## What it looks like

```js
import { useEffect, useSyncEffect } from '@verajs/core';

// Batched: one run per frame, no matter how many writes landed.
useEffect((signal) => {
  save(state.draft);
  // signal.changed -> Map { 'title' => { prevValue: 'a', value: 'c' } }
});

// Per-change: one run per write, observing every intermediate value.
useSyncEffect((signal) => {
  history.push(signal.value);        // 1, then 2, then 3
});
```

## `signal.changed`

Coalesced runs receive every property touched during the batch, mapped to its value at the **start**
of the batch and at the **end**:

```js
useEffect((signal) => {
  for (const [prop, { prevValue, value }] of signal.changed) {
    console.log(prop, prevValue, '->', value);   // a 0 -> 2 ,  b 0 -> 1
  }
});
```

`signal.prop` / `value` / `prevValue` still describe the most recent single change.

**Vue's `watchEffect`, React's `useEffect`, Solid's `createEffect` and Preact's `effect` provide no
change information at all.** Vue's `watch()` gives new/old for a watched source, but not a set of
what moved across a batch.

## Why this exists

The coalesced form was not always there, and the old behaviour was worse than either camp. Because
effects were deferred to an animation frame, N writes produced N runs that all executed *after* every
write — so all of them read the same final value. Measured: `[3,3,3]`.

That is N times the work for one distinct observation. Solid and Preact's non-batching costs the same
N runs but *buys* something with it. The fix was to pick a lane deliberately, then offer the other one
explicitly.

## Caveats — state these

- **`useSyncEffect` can infinite-loop.** An effect that unconditionally writes state it also reads
  will recurse until the stack gives out. **Solid and Preact carry exactly the same hazard**; it is
  the cost of the model, not a VeraJS flaw. `useEffect` cannot do this to you, which is why it is
  the default.
- **Coalescing loses the intra-tick transition chain.** `signal.changed` gives the start-to-end
  delta per property, not every step between. Use `useSyncEffect` when the steps matter.
- Vue offers `flush: 'sync'` on `watchEffect`, so it is closest to matching this. It still gives no
  change metadata.

## Reproduce

```bash
node bench/reactivity.mjs
```

The competitor figures come from a one-off Node harness against the installed libraries —
fastest-of-N with rotated execution order so GC pressure spreads evenly.
