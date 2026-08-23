# @verajs/inserts

The VeraJS extension registry (<!--size:inserts.gzip-->360 B<!--/size:inserts.gzip--> gzip). Every
capability that attaches to VeraJS — renderers, autoloaders, styling, error boundaries, batching —
attaches through here. It is the module system's backbone rather than a feature.

You rarely install this directly: `@verajs/core` and `@verajs/router` re-export what you need.

```js
import { insert } from '@verajs/core';
```

**Take `insert` from the package that owns the extension point, never from `@verajs/inserts`
directly.** A production `.min.js` inlines this package into every bundle, so registering through a
separately imported copy writes to a map that package never reads — it works in development and
silently does nothing in production.

## Registering

```js
insert('error', (error, element) => report(error, element), 40);
```

`insert(name, callback, priority)` — **priority is required.** Lower runs first. Registering at a
priority that is already taken **replaces** that entry, which is how `setRenderer` swaps renderers.
Chains are stored dense and priority-sorted rather than indexed by priority: indexing left holes
(a renderer at 50 produced a 51-element array with 50 of them) and every chain is walked on the hot
path, which cost roughly 238 ns per store read.

## The extension points

| Name | Runs when | Signature |
| --- | --- | --- |
| `'render'` | a component renders | `(template, element, ...args)` |
| `'init'` | `init()` sets an element up — after its shadow root exists, before its first render | `(element)` |
| `'proxy-handler'` | a store property is read | `(obj, prop, value, addCallback, runCallbacks)` |
| `'set-handler'` | a store property is written, before the default propagation. Return `false` to suppress it — that is how batching, transactions and undo/redo hold changes back | `(obj, prop, value, prevValue, runCallbacks)` |
| `'error'` | a hook callback threw. Core never lets one failing effect stop the others, so this decides what happens to it. With nothing registered it falls back to `console.error` | `(error, element)` |

Priority 50 is the convention for a default implementation: register below it to run first, or at it
to replace.

## `connectInserts`

```js
import { inserts } from '@verajs/core';
import { connectInserts } from '@verajs/router';

connectInserts(inserts);
```

Each standalone `.min.js` inlines its own copy of this package, so loading `vera.min.js` *and*
`vera-router.min.js` in CDN mode yields **two separate registries**. This points one at the other.
Under a bundler both already resolve to one instance and the call does nothing.

That is intentional, and it is the price of the modules being genuinely independent of core — not a
bug to fix by making bundles share global state.

**Order does not matter.** Anything registered before the call is replayed into the new registry at
its original priority, so `connectInserts` can come before or after your `setRenderer`. It used to
replace the registry outright, which made a `setRenderer` in the wrong place unreachable — silently,
since nothing throws and the callback simply lands in a map nobody reads. A replayed entry whose
priority is already taken replaces it, exactly as a direct `insert` would.

## Convenience wrappers

| | |
| --- | --- |
| `setRenderer(fn)` | registers `fn` on `'render'` at priority 50, passing the element's shadow root when it has one |
| `setAutoloader(fn)` | registers `fn` on `'render'` at priority 75, so discovery runs after the render that produced the markup |

## License

MIT
