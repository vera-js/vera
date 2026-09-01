# Architecture notes

The parts of VeraJS that are not obvious from reading a single file.

---

## The render pipeline

**There is exactly one render pipeline, and everything goes through it** — component renders and
route renders alike. It is the `'render'` insert chain.

### Registration

`inserts` is a `Map<insertName, callback[]>`. Each chain is a **dense, priority-sorted array** —
`wire({ on: name, fn, priority })` splices the callback in at its ordered slot, with the priorities
carried beside the chain. It was indexed by priority once (`array[50]` for the renderer), which
left 50 holes that every hot-path walk paid for — roughly 238 ns per store read. Dense storage is
why registration order never matters and iteration costs only what is registered.

Two things register into `'render'`:

| Priority | Registered by | Does |
| ---: | --- | --- |
| 50 | `wire([renderer])` | renders the template; core resolves `_root ?? shadowRoot ?? element` at dispatch |
| 75 | `wire([autoloader(…)])` | discovers undefined custom elements and lazy-loads them |

**Nothing is registered until an app wires it.** Core used to self-register a default renderer
(`template.innerHTML = content`) at module scope; it was removed in 0.2.0, because it was safe only
inside core's own bundle and every app paid for a renderer it immediately replaced. With nothing on
`'render'`, `render()` warns once in development rather than drawing through an escaping default.

Wiring a second callback at 50 **replaces** the first, because a taken priority replaces rather than
appends — that is how a renderer is swapped, and the duplicate is named in a development warning so
two modules both claiming 50 is not silent.

> **Priority is required, and validated.** A non-finite priority (`undefined`, `NaN` — what
> `parseInt` of a bad config produces) would both break replacement (`indexOf(NaN)` never matches)
> and sort to the front, so `wire` throws on it in development rather than misbehaving quietly.

### Execution

Both call sites iterate the whole chain:

```js
inserts.get('render')?.forEach((callback) => callback(template, element, ...args));
```

- `packages/core/src/hooks/useRender.ts` — component renders, deferred through the render
  scheduler (an animation frame by default) and coalesced by a flag, so N writes in a tick cost
  one pass.
- `packages/router/src/services.ts` — route renders, into the resolved `[view=...]` outlet.

Because the router runs the *same* chain, a route render also triggers the autoloader at priority
75. That is how lazily-loaded components inside a routed view get discovered without the router
knowing anything about the autoloader.

### Consequence: configuration must precede definition

The renderer chain is **global mutable state** (`wire`), so a component that defines itself
before configuration runs renders with nothing on the `'render'` chain. Core ships no default
renderer — it did once, was removed in 0.2.0, and with nothing registered `render()` warns once in
development and paints nothing.

This bites in a way that is easy to miss, because **static `import` declarations are hoisted**:

```js
wire([renderer]);
import './components/app.js';   // WRONG - evaluated BEFORE the line above
```

```js
wire([renderer]);
await import('./components/app.js');   // correct - evaluated after
```

(`setHtml` is not part of the setup — core's own `html` produces the shape `@verajs/renderer`
accepts. It exists for swapping the tag, e.g. to lit-html.)

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
import { router } from '@verajs/router';
wire([router]);     // router now shares core's registry
```

Without this the router would render through its own default renderer and ignore the one the app
configured on core. This reads identically under a bundler and on a CDN page, which is why it
replaced `connectInserts` — a replay function that was load-bearing in one mode and ceremonial in
the other, and that was removed in 0.2.0 along with the concept.

This duplication is the deliberate cost of modules that do not depend on core — never "fix" it
by making bundles share global state.

---

## Effect ordering

`init()` seeds `element._hooks`; `mount()` calls `element.runHooks()` and clears the instance, and
`render()` is `useRender` followed by that same commit.
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
`WeakMap<object, Map<string, Map<WeakRef<Element>, PropSubscriptions>>>`, where
`PropSubscriptions` pairs the priority-ordered callback sets with their priorities — so detached
elements are not retained. Anything that stores a strong element reference defeats this.

The `'proxy-handler'` insert is the extension point for transforming values as they are read
(`examples/cdn-js/src/inserts/computed.js` demonstrates it). Map/Set reactivity is **not** built
on it: after a spell inside core it moved out to `@verajs/reactivity/collections` on its own
**type-keyed `'collection'` insert point** — core computes `isSetOrMap` once and only collection
reads ever reach the chain, which is what makes reactive collections affordable outside core where
the per-read `'proxy-handler'` walk was not.
