# @verajs/inserts

The VeraJS extension registry (<!--size:inserts.gzip-->357 B<!--/size:inserts.gzip--> gzip). Every
capability that attaches to VeraJS — renderers, autoloaders, styling, error boundaries, batching —
attaches through here. It is the module system's backbone rather than a feature.

You rarely install this directly: `@verajs/core` and `@verajs/router` re-export what you need.

<!-- recipe -->
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
| `'collection'` | a method is read off a `Map` or `Set` **inside a store**. Type-keyed, so a plain-object read never reaches it — that is what lets reactive collections live outside core. With nothing registered, a `Map` in a store is inert and core raises a `__DEV__` error naming the package | `(obj, prop, propValue, addCallback, runCallbacks)` |
| `'value'` | a **child-position** value the renderer does not already handle — `<div>${value}</div>`. For types you do not own: a `Promise`, an `Observable`, a `Temporal.PlainDate`. Return `true` to claim the value and stop the chain. **Strings, numbers, `null` and `undefined` never reach it** — those take a fast path — so this cannot be used to intercept text | `(part, value)` |

Priority 50 is the convention for a default implementation: register below it to run first, or at it
to replace.

Every callback in a chain runs, in priority order. An insert that wants to change what core does —
rather than merely watch — says so through its return value, and only `'set-handler'` has one:
returning `false` suppresses the default propagation, which is what lets a module hold writes back
and flush them itself.

For a whole new *kind* of hook rather than a new implementation of an existing one, `createHook` in
`@verajs/core` is the primitive `useEffect` and its siblings are built from.

## An insert that throws

**Nothing catches it, and that is deliberate — but it is not the same as a hook.** A `useEffect` that
throws is isolated and reported through the `'error'` insert, because core runs an element's hooks in
one loop and an escaping error would skip every hook after the failing one. An insert is not in that
position:

- **`'set-handler'` and `'proxy-handler'` run inside the store's own `set` and `get` traps**, so a
  throw comes out of `state.count = 1` in the caller's own stack, at the line that wrote it. That is
  the most useful place it could surface, and swallowing it would leave the write in an undefined
  state — a suppressed handler has already decided whether the value propagates. These are also the
  hottest paths in the framework, and a `try`/`catch` on every property read is not free.
- **`'collection'` and `'value'` are the same case as those two**, for the same reason: the first
  runs inside a `Map` or `Set` method and the second inside a child-position commit, so a throw comes
  out of `tags.add('x')` or of `renderInto` at the line that called it.
- **`'init'` and `'render'` run inside `init()` and the render, so a throw surfaces there.**
- **`'error'` is the one that must not throw.** It is already handling a failure, and a throw from it
  replaces the error being reported with its own.

The practical rule: an insert is framework-level code and is expected not to throw. If yours can,
catch inside it and decide what to do — the callback knows what a failure means and core does not.

## Two copies is a mistake, not an arrangement

Each standalone `.min.js` inlines its own copy of this package, so loading `vera.min.js` *and* a
module that imported this package directly would yield **two separate registries** — one written
to, the other read from, in production only.

There is no repair function for that any more. `connectInserts`, which replayed one registry's
chains into another, was removed once every module took the registry it writes to instead of
carrying its own:

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { router } from '@verajs/router';
import { collections } from '@verajs/reactivity/collections';

wire([renderer, router, collections]);
```

`router` is a **connector** — `wire` hands it this registry, and the router keeps no registry
of its own. That removes the hazard by construction rather than reconciling it afterwards, and it is
why `@verajs/router` has no dependencies at all. `tests/cdn-cross-bundle.test.mjs` guards the shape.

**Take `wire` from `@verajs/core`, never from this package.** `@verajs/eslint-config` has a rule for
exactly that mistake.

## License

MIT
