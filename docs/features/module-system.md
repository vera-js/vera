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
import { connectRouter } from '@verajs/router';
wire([connectRouter]);              // point the router at core's registry
```

That reads identically under a bundler and on a CDN page. **This is the price of independence, not a
bug** — a router that cannot work without core is not an independent module — and without core at
all the router takes what it needs directly (`setRouterRenderer`), with no registry involved.

## The extension points

| Name | Fires | Enables |
| --- | --- | --- |
| `'render'` | every component and route render | renderers, autoloaders |
| `'proxy-handler'` | every store property **read** | reactive `Map`/`Set`, value wrapping |
| `'set-handler'` | every property **write**, before propagation | `batch()`, transactions, undo/redo, persistence, time-travel devtools |
| `'error'` | a hook callback throws | error boundaries, fallback UI, error reporting |

Returning `false` from a `'set-handler'` suppresses core's default propagation, which is how a module
takes over. That is what makes `batch()` a module rather than core surface:

```js
wire({ on: 'set-handler', fn: (obj, prop, value, prevValue, runCallbacks) => {
  if (!batching) return;
  queued.push([obj, prop, value, prevValue, runCallbacks]);
  return false;                     // hold it back; flush later
}, priority: 50 });
```

Verified: three writes deduped to two propagations.

## What this buys, concretely

Things that are **modules, not core**, and need no changes to core to build:

- `computed` / derived values — ~8 lines, verified working with caching
- `batch()` / transactions / undo-redo / persistence — via `'set-handler'`
- error boundaries and error reporting — via `'error'`
- context / dependency injection — a `WeakMap` plus a DOM walk
- async resources, Suspense-style loading states
- reactive `Map` / `Set` began life exactly this way (a `'proxy-handler'` insert, 389 bytes)
  before being integrated into core — the original is kept as a reference insert, and
  `examples/cdn-js/src/inserts/computed.js` is a living one

## Renderer-agnostic

`setHtml`, and wiring a different function on `'render'`, mean the template function and the renderer are both swappable. Use
lit-html, use `@verajs/renderer`, or write your own.

That is a real strategic hedge rather than a checkbox: core survives lit-html falling out of favour,
and if TC39 Signals land natively the reactivity layer can be swapped to them and get *smaller*.

## Caveat

Independence has a cost and you should say it out loud: every module has to be wired, and a module
you forget is a module that does nothing until a development warning tells you so. The honest
framing is that it is a deliberate trade — most "modular" frameworks are modular in packaging only, and their pieces will
not run without the core.
