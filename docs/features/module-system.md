# Module system

## The claim

**The modules are genuinely independent, and the extension system is the product.** Core covers what
most people need; everything else is opt-in, including things you write yourself.

## Genuine independence

`@verajs/router`, `@verajs/autoloader` and `@verajs/renderer` **do not require
`@verajs/core` at runtime**. Take one on its own, or use it with another framework entirely.

The proof is uncomfortable but honest: production bundles inline everything, so loading
`vera.min.js` *and* `vera-router.min.js` gives you **two separate internal registries**. That is why
`connectInserts()` exists:

```js
import { inserts } from '@verajs/core';
import { connectInserts } from '@verajs/router';
connectInserts(inserts);            // point the router at core's registry
```

Under a bundler everything resolves to one instance and the call does nothing. **This is the price
of independence, not a bug** — a router that cannot work without core is not an independent module.

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
insert('set-handler', (obj, prop, value, prevValue, runCallbacks) => {
  if (!batching) return;
  queued.push([obj, prop, value, prevValue, runCallbacks]);
  return false;                     // hold it back; flush later
}, 50);
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

`setHtml` and `setRenderer` mean the template function and the renderer are both swappable. Use
lit-html, use `@verajs/renderer`, or write your own.

That is a real strategic hedge rather than a checkbox: core survives lit-html falling out of favour,
and if TC39 Signals land natively the reactivity layer can be swapped to them and get *smaller*.

## Caveat

Independence has a cost and you should say it out loud: the duplicated registries are surprising the
first time, and `connectInserts` is a papercut in the CDN path. The honest framing is that it is a
deliberate trade — most "modular" frameworks are modular in packaging only, and their pieces will
not run without the core.
