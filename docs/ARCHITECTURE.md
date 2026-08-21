# Architecture notes

The parts of VeraJS that are not obvious from reading a single file.

---

## The render pipeline

**There is exactly one render pipeline, and everything goes through it** — component renders and
route renders alike. It is the `'render'` insert chain.

### Registration

`inserts` is a `Map<insertName, callback[]>`. The callback array is **indexed by priority**, so
`insert(name, cb, priority)` writes to `array[priority]`:

```js
export const insert = (insertName, callback, priority) => {
  get(inserts).get(insertName, []).value[priority] = callback;
};
```

Two things register into `'render'`:

| Priority | Registered by | Does |
| ---: | --- | --- |
| 50 | `setRenderer(fn)` | renders the template into `element.shadowRoot ?? element` |
| 75 | `setAutoloader(fn)` | discovers undefined custom elements and lazy-loads them |

`@verajs/inserts` calls `setRenderer` **at module scope** with a default implementation
(`template.innerHTML = content`). A consumer's `setRenderer(litRender)` overwrites index 50, because
priorities are array indices rather than an append. There is therefore always exactly one renderer.

> **Priority is required.** `insert(name, cb)` with no priority writes to `array[undefined]`, which
> creates a plain object property rather than an array element — and `forEach` skips it. The insert
> silently never runs. This is a real footgun.

### Execution

Both call sites iterate the whole chain:

```js
inserts.get('render')?.forEach((callback) => callback(template, element, ...args));
```

- `packages/core/src/hooks/useRender.ts:14` — component renders, scheduled via
  `requestAnimationFrame` and cancelled/coalesced if another render lands first.
- `packages/router/src/services.ts:126` — route renders, into the resolved `[view=...]` element.

Because the router runs the *same* chain, a route render also triggers the autoloader at priority
75. That is how lazily-loaded components inside a routed view get discovered without the router
knowing anything about the autoloader.

### Consequence: configuration must precede definition

Since the renderer and the `html` tag are **global mutable state** (`setRenderer`, `setHtml`), any
component that defines itself before configuration runs will render through core's defaults.

The failure is silent and looks like this: core's default `html` returns a plain object
(`{_$litType$, strings, values}`), and the default renderer assigns it to `innerHTML` — so the page
paints the literal string **`[object Object]`**.

This bites in a way that is easy to miss, because **static `import` declarations are hoisted**:

```js
setRenderer(render);
setHtml(html);
import './components/app.js';   // WRONG - evaluated BEFORE the two lines above
```

```js
setRenderer(render);
setHtml(html);
await import('./components/app.js');   // correct - evaluated after
```

Both examples use the dynamic form for this reason.

---

## Module independence and the duplicated `inserts` map

Each production bundle is fully standalone — `dist/*.min.js` inlines every dependency, including
`@verajs/inserts`. So loading two bundles from a CDN gives you **two separate `inserts` maps**:

```
vera.min.js         -> its own inserts Map
vera-router.min.js  -> a different inserts Map
```

`connectInserts(newInserts)` reassigns the module-level binding so one module adopts another's map:

```js
import { inserts } from '@verajs/core';
import { connectInserts } from '@verajs/router';
connectInserts(inserts);   // router now shares core's registry
```

Without this the router would render through its own default renderer and ignore the one the app
configured on core.

Under a bundler every package resolves to a single `@verajs/inserts` instance, so `connectInserts`
is a no-op. It is kept in both examples so the two read identically.

This duplication is the deliberate cost of modules that do not depend on core — never "fix" it
by making bundles share global state.

---

## Effect ordering

`init()` seeds `element._hooks`; `render()` calls `useRender` and then `element.runHooks()`.
Hooks carry a priority, and lower runs first:

| Priority | Hook |
| ---: | --- |
| 25 | `useLayoutEffect` |
| 50 | `useRender` |
| 75 | `useEffect` |

So the order is **layout effects → render → effects**, which is why `useLayoutEffect` can read state
before paint and `useEffect` observes the rendered result.

---

## Reactivity

`createStore` wraps its target in a proxy (`services/createProxy.ts`). On **get**, the currently
executing hook is recorded as a dependency of that object/property pair; on **set**, the recorded
callbacks re-run. Tracking is per-property rather than per-store, so unrelated properties do not
re-render.

Bookkeeping is deliberately weak-referenced — `proxyCallbacks` is a
`WeakMap<object, Map<string, Map<WeakRef<Element>, Set<WeakRef<Callback>>[]>>>` — so detached
elements are not retained. Anything that stores a strong element reference defeats this.

The `'proxy-handler'` insert is the extension point for transforming values as they are read.
Map/Set reactivity began there before being integrated into core (`services/collections.ts`) —
the original insert is kept as a reference implementation, and
`examples/cdn-js/src/inserts/computed.js` demonstrates the same point today.
