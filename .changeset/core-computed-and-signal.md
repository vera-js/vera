---
'@verajs/core': minor
'@verajs/store': minor
---

`computed` is core's, and `ref` / `shallowRef` became `signal` — shallow by default

**Breaking.** Four changes to state, in one release:

- **`computed` moved into core** (`import { computed } from '@verajs/core'`); `@verajs/store/computed` is removed. It is
  now **lazy and linked only while something reads it**: read by a render, an effect or another computed, it stays
  current inside the write that changes its source; read by nothing, it holds no subscription and evaluates when read
  (cached until the next store write); when its last reader goes, it lets go of its sources. A computed made anywhere —
  a setup, a render, an effect, module scope — never keeps anything alive past its last reader. It used to evaluate at
  creation and on every dependency write, read or not.
- **`ref` was deep; `signal` is shallow by default — use `signal(v, { deep: true })` for the old behavior.** `ref(v)`
  and `shallowRef(v)` are removed: `shallowRef(v)` is `signal(v)`, and `ref(v)` holding an object is
  `signal(v, { deep: true })` (a primitive, or a value only ever replaced, needs no option). Replacing `.value` always
  notifies; with the default, mutating inside it does not — the semantics of every signals library and TC39's
  `Signal.State`. An element ref is `signal()`, as `ref()` was.
- **A signal is a small object, not a Proxy: its `value` lives on a prototype every signal shares.** Reading `.value`
  subscribes and a write that is not `Object.is` the held value notifies (see the equality rule below). `JSON.stringify(signal)` writes the value it holds (`toJSON`);
  `Object.keys(signal)` is `[]` and a spread or `structuredClone` copies no `value`; `'value' in signal` is `true`. Only
  reading `.value` subscribes: `in`, `Object.keys` and `for…in` on a signal subscribe to nothing. Its tag is
  `[object Signal]`, so a store never wraps one written into it.

**One equality rule for stores, signals and computeds: `Object.is`.** A write, a definition or a recomputation is a
change when the new value is not `Object.is` the old one: `-0` written over `0` is stored and notified (it was dropped as
no change), and `NaN` over `NaN` is no change (a signal, an array's walkers and a computed were notified). Every other
value compares as `===`, at the same cost.

`deep` takes effect only as `true`, in both builds; any other value is the default, and development names it
(`deep-not-boolean`).

**TypeScript:** `Signal` is now the type `signal()` returns (`{ value: T }`); the change payload a hook is handed —
what `Signal<V>` used to name — is `Change<V>`. Code importing the old `Signal` type for a hook's argument switches to
`Change`.
