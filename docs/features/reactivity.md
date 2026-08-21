# Reactivity

## The claim

**Read a value and it is tracked.** No dependency arrays, no property declarations, no explicit
subscriptions — Solid-class ergonomics without a compiler.

## The evidence

```js
const state = createStore({ count: 0, name: 'world' });

useEffect(() => {
  console.log(state.count);      // re-runs when count changes. That is the whole registration.
});
```

Against the same behaviour elsewhere:

```js
// React — maintain the dependency array by hand, and get it wrong silently
useEffect(() => { console.log(count); }, [count]);

// Lit — declare what is reactive, then check what changed
static properties = { count: {} };
updated(changed) { if (changed.has('count')) console.log(this.count); }

// Vue — closest; ref/reactive plus .value discipline
watchEffect(() => console.log(count.value));
```

Tracking is **per property, not per store**, so unrelated properties do not cause re-runs. Verified:
mutating an untracked sibling property does not re-run the effect.

## The escape hatch

Automatic tracking needs a way out, or it becomes a trap. `untrack` reads current state without
subscribing:

```js
useEffect(() => {
  const a = state.a;                    // re-runs when a changes
  const b = untrack(() => state.b);     // reads current b, stays unsubscribed
});
```

Equivalent to Solid's `untrack` and Preact's `untracked`. Vue has `toRaw`.

## Memory

Bookkeeping is weakly referenced throughout — `proxyCallbacks` is a
`WeakMap<object, Map<string, Map<WeakRef<Element>, Set<WeakRef<Callback>>[]>>>` — so detached
elements are not retained by their own subscriptions.

## Derived values

`computed` is **not in core, on purpose**. It is buildable as a module in about eight lines on the
public API, with correct caching and invalidation:

```js
const computed = (fn) => {
  const cache = createStore({ value: undefined });
  createHook({ callback: () => { cache.value = fn(); }, priority: 40 });
  return cache;
};
```

That is the module system working as intended — see [module-system.md](module-system.md).

## Caveats

- **Proxy-based, so reads cost more than a plain property access** — roughly 200 ns tracked versus
  2 ns. Fine at the scale real components read state; it matters in tight loops over thousands of
  properties. See [performance.md](performance.md).
- **Not fine-grained in Solid's sense.** A change re-runs the whole template and the renderer diffs.
  Solid compiles to direct DOM updates with no re-render at all.
