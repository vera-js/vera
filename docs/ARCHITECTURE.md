# Architecture notes

The parts of VeraJS that are not obvious from reading a single file.

---

## The render pipeline

**There is exactly one render pipeline, and everything goes through it** — component renders and
route renders alike. It is the `'render'` insert chain.

### Registration

`inserts` is a `Map<insertName, callback[]>`. The callback array is **indexed by priority**, so
`wire({ on: name, fn: cb, priority: priority })` writes to `array[priority]`:

```js
export const insert = (insertName, callback, priority) => {
  get(inserts).get(insertName, []).value[priority] = callback;
};
```

Two things register into `'render'`:

| Priority | Registered by | Does |
| ---: | --- | --- |
| 50 | `wire([domRender])` | renders the template; core resolves `_root ?? shadowRoot ?? element` at dispatch |
| 75 | `wire([initAutoloader(…)])` | discovers undefined custom elements and lazy-loads them |

**Nothing is registered until an app wires it.** Core used to self-register a default renderer
(`template.innerHTML = content`) at module scope; it was removed in 0.2.0, because it was safe only
inside core's own bundle and every app paid for a renderer it immediately replaced. With nothing on
`'render'`, `render()` warns once in development rather than drawing through an escaping default.

Wiring a second callback at 50 **replaces** the first, because a taken priority replaces rather than
appends — that is how a renderer is swapped, and the duplicate is named in a development warning so
two modules both claiming 50 is not silent.

> **Priority is required.** `wire(name, cb)` with no priority writes to `array[undefined]`, which
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

Since the renderer chain and the `html` tag are **global mutable state** (`wire`, `setHtml`), any
component that defines itself before configuration runs will render through core's defaults.

The failure is silent and looks like this: core's default `html` returns a plain object
(`{_$litType$, strings, values}`), and the default renderer assigns it to `innerHTML` — so the page
paints the literal string **`[object Object]`**.

This bites in a way that is easy to miss, because **static `import` declarations are hoisted**:

```js
wire([domRender]);
setHtml(html);
import './components/app.js';   // WRONG - evaluated BEFORE the two lines above
```

```js
wire([domRender]);
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

A module therefore takes the registry it writes to, rather than carrying one. `@verajs/router` keeps
no registry at all and is handed core's:

```js
import { wire } from '@verajs/core';
import { connectRouter } from '@verajs/router';
wire([connectRouter]);     // router now shares core's registry
```

Without this the router would render through its own default renderer and ignore the one the app
configured on core. This reads identically under a bundler and on a CDN page, which is why it
replaced `connectInserts` — a replay function that was load-bearing in one mode and ceremonial in
the other, and that was removed in 0.2.0 along with the concept.

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
