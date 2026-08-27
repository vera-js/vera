---
'@verajs/core': minor
---

`mount()` commits a component's setup without drawing anything, and `render`'s template argument is
now required.

`init()` opens a component's setup and one of two calls closes it — running the first pass of every
hook registered since `init()` and clearing the instance:

```js
connectedCallback() {
  init(this);
  const state = createStore({ online: navigator.onLine });
  useEffect(() => report(state.online));
  mount();                       // a component with no markup
}
```

`render(template)` is exactly `useRender(template)` followed by that same commit — a compound over
the base operation, not a second way to do the same thing, which is why a component only ever calls
one of them.

**Why this reverses an earlier decision.** A bare `render()` used to be how a side-effect-only
component committed: legal, documented, and guessed by nobody, because "render" names the one thing
the call is not doing. A standalone commit function was built once and rejected on size — 25 B
against 6 B — and that comparison could not measure the failure it was trading away. Hooks that are
never committed never run: no error, no render, an effect that simply does not happen. `mount()`
costs 35 B gzipped in core and makes that failure findable.

A bare `render()` still commits and warns, naming `mount()`. Refusing would turn a spelling
preference into effects that silently never run — the exact failure this exists to prevent. The
break is at the type level: `render()` with no argument no longer compiles, which is why this is a
minor rather than a patch.

Development warnings updated to match: the "registered N hooks but never committed" warning now
names both calls, and "hook ignored" names the `render()` or `mount()` that ends setup.
