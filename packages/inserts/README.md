# @verajs/inserts

The VeraJS extension registry (<!--size:inserts.gzip-->344 B<!--/size:inserts.gzip--> gzip). Every
capability that attaches to VeraJS — renderers, autoloaders, styling, error boundaries, batching —
attaches through here. It is the module system's backbone rather than a feature.

You rarely install this directly: `@verajs/core` and `@verajs/router` re-export what you need.

```js
import { wire } from '@verajs/core';
```

Everything VeraJS does beyond state and templates is registered here, on the same five points and
the same public function you have. `@verajs/renderer` is a `'render'` insert. `@verajs/styles` is an
`'init'` insert. An error boundary is an `'error'` insert, and write batching is a `'set-handler'`
insert — both are a few dozen lines, and both are worked examples in
[`examples/cdn-js/src/inserts/`](../../examples/cdn-js/src/inserts).

**Take `insert` from the package that owns the extension point, never from `@verajs/inserts`
directly.** A production `.min.js` inlines this package into every bundle, so registering through a
separately imported copy writes to a map that package never reads — it works in development and
silently does nothing in production.

## Registering

```js
wire({ on: 'error', fn: (error, element) => report(error, element), priority: 40 });
```

`wire({ on: name, fn: callback, priority: priority })` — **priority is required.** Lower runs first. Registering at a
priority that is already taken **replaces** that entry, which is how a renderer is swapped.
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

Every callback in a chain runs, in priority order. An insert that wants to change what core does —
rather than merely watch — says so through its return value, and only `'set-handler'` has one:
returning `false` suppresses the default propagation, which is what lets a module hold writes back
and flush them itself.

For a whole new *kind* of hook rather than a new implementation of an existing one, `createHook` in
`@verajs/core` is the primitive `useEffect` and its siblings are built from.

## Two copies is a mistake, not an arrangement

Each standalone `.min.js` inlines its own copy of this package, so loading `vera.min.js` *and* a
module that imported this package directly would yield **two separate registries** — one written
to, the other read from, in production only.

There is no repair function for that any more. `connectInserts`, which replayed one registry's
chains into another, was removed once every module took the registry it writes to instead of
carrying its own:

```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { router } from '@verajs/router';
import { collections } from '@verajs/collections';

wire([renderer, router, collections]);
```

`router` is a **connector** — `wire` hands it this registry, and the router keeps no registry
of its own. That removes the hazard by construction rather than reconciling it afterwards, and it is
why `@verajs/router` has no dependencies at all. `tests/cdn-cross-bundle.test.mjs` guards the shape.

**Take `wire` from `@verajs/core`, never from this package.** `@verajs/eslint-config` has a rule for
exactly that mistake.

## License

MIT
