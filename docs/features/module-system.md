# Module system

## The claim

**The modules are genuinely independent, and the extension system is the product.** Core covers what
most people need; everything else is opt-in, including things you write yourself.

## Genuine independence

`@verajs/router`, `@verajs/autoloader` and `@verajs/renderer` **do not require
`@verajs/core` at runtime**. Take one on its own, or use it with another framework entirely.

The proof is concrete: production bundles inline everything, so a module that carried its own
registry would end up writing to one core never reads. None of them carry one. The router is handed
core's, by the same `wire` call that installs everything else:

```js
import { wire } from '@verajs/core';
import { router } from '@verajs/router';
wire([router]);              // point the router at core's registry
```

That reads identically under a bundler and on a CDN page. **This is the price of independence, not a
bug** — a router that cannot work without core is not an independent module — and without core at
all the router takes what it needs directly (`setRouterRenderer`), with no registry involved.

## The extension points

| Name | Fires | Enables |
| --- | --- | --- |
| `'render'` | every component and route render | renderers, autoloaders |
| `'store'` | a store's first use of a value — once per value, never per read or write | reactive `Map`/`Set`, `batch()`, transactions, undo/redo, persistence, time-travel devtools, value wrapping |
| `'error'` | a hook callback or an element ref throws | error boundaries, fallback UI, error reporting |

A `'store'` insert is handed core's handler for a value and returns the one to use. Wrapping core's
`set` is how a module takes over a write: writing to the raw target notifies nobody, and the kit's
`trigger` — core's own notify — delivers it later. That is what makes `batch()` a module rather than
core surface:

```js
wire({ on: 'store', fn: (value, handler, kit) => handler?.set && {
  ...handler,
  set(obj, prop, next, receiver) {
    if (!batching) return handler.set(obj, prop, next, receiver);
    queued.push([kit, obj, prop, next, obj[prop]]);
    return Reflect.set(obj, prop, next);    // written, not yet announced
  },
}, priority: 60 });
// later: for (const [kit, obj, prop, next, prev] of queued) kit.trigger(obj, prop, next, prev);
```

The insert is consulted once per value, so a store that never meets it — and every read and write
of one that does, beyond the handler's own work — pays nothing for the seam. Verified by
`examples/cdn-js/src/inserts/batch.js` and its test: three writes deduped to two notifications.

## What this buys, concretely

Things that are **modules, not core**, and need no changes to core to build:

- `computed` / derived values — ~8 lines, verified working with caching
- `batch()` / transactions / undo-redo / persistence — a `'store'` insert wrapping core's `set`
- error boundaries and error reporting — via `'error'`
- context / dependency injection — a `WeakMap` plus a DOM walk
- async resources, Suspense-style loading states
- reactive `Map` / `Set` — `@verajs/store/collections` is a `'store'` insert claiming the keyed
  collections; `examples/cdn-js/src/inserts/computed.js` is a smaller living example

## Renderer-agnostic

`setHtml`, and wiring a different function on `'render'`, mean the template function and the renderer are both swappable. Use
lit-html, use `@verajs/renderer`, or write your own.

That is a real strategic hedge rather than a checkbox: core survives lit-html falling out of favor,
and if TC39 Signals land natively the reactivity layer can be swapped to them and get *smaller*.

## Caveat

Independence has a cost and you should say it out loud: every module has to be wired, and a module
you forget is a module that does nothing until a development warning tells you so. The honest
framing is that it is a deliberate trade — most "modular" frameworks are modular in packaging only, and their pieces will
not run without the core.
