# @verajs/inserts

The VeraJS extension registry (<!--size:inserts.gzip-->344 B<!--/size:inserts.gzip--> gzip). Every
capability that attaches to VeraJS — renderers, autoloaders, styling, error boundaries, batching —
attaches through here. It is the module system's backbone rather than a feature.

You rarely install this directly: `@verajs/core` and `@verajs/router` re-export what you need.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
```

Everything VeraJS does beyond state and templates is registered here, on the same points and the
same public function you have. `@verajs/renderer` is a `'render'` insert. `@verajs/styles` is an
`'init'` insert. Reactive `Map`/`Set` (`@verajs/store/collections`) is a `'store'` insert. An error
boundary is an `'error'` insert, and write batching is a `'store'` insert wrapping core's `set` —
both are a few dozen lines, and both are worked examples in
[`examples/cdn-js/src/inserts/`](../../examples/cdn-js/src/inserts).

**Take `wire` from the package that owns the extension point, never from `@verajs/inserts`
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
(a renderer at 50 produced a 51-element array with 50 of them), and a chain is walked every time its
point fires.

`inserts` is the registry itself — a `Map` from point name to its ordered chain — for a module that
dispatches a point of its own. (Remember the rule below before importing it directly:
**registering** goes through core's `wire`, always.)

## The extension points

| Name | Runs when | Signature |
| --- | --- | --- |
| `'render'` | a component renders | `(template, element, ...args)` |
| `'init'` | `init()` sets an element up — after its shadow root exists, before its first render | `(element)` |
| `'store'` | a store first USES a value — a store on its first read or write, a nested value on its first read — and decides, once, how that value is reactive. Handed the value, the handler chosen so far (core's for a plain object or array, `undefined` for anything core leaves alone) and a kit — `{ track, trigger, shape }`, core's subscribe and notify and the shape channel's name. Return a handler to use instead, or nothing to leave it: claim a type core leaves alone (`@verajs/store/collections` claims `Map`/`Set`/`WeakMap`/`WeakSet`), or wrap core's — `{ ...handler, set(obj, prop, value, receiver) { … } }` — for batching, transactions, undo, persistence, devtools; writing to the raw target notifies nobody and `kit.trigger` notifies later, which is how a module holds changes back. Never consulted on an ordinary read or write, so it costs nothing when unused. A value already used before a module was wired keeps the handler it got | `(value, handler, kit)` |
| `'error'` | a hook callback or an element ref (`&ref`) threw. Neither stops its siblings — one failing effect never stops the others, one failing ref never stops the render — so this decides what happens to it; `element` is the component being rendered. With nothing registered it goes to `reportError`, which fires the window's `error` event (so `window.onerror` and test runners see it), and off-browser to `console.error` | `(error, element)` |
| `'slot'` | a `<slot>` in a rendered template, handed over by `slotDiscovery` (from `@verajs/renderer/slots`, which includes it — an `'element'` claimant on `@verajs/renderer/elements`) once the render that created the instance has finished — `@verajs/renderer/slots` takes it over and distributes the host's own children. A custom strategy wires `slotDiscovery` beside itself: `wire([renderer, slotDiscovery, myStrategy])`. Returning null or undefined declines, which is what a shadow root gets (the platform slots there) and what the SSR shim gets (the server distributes in its own pass). One registrant owns it: the highest-priority answer, not a chain. A strategy may also carry `$o(parent, node, owner)`, told about every node the renderer inserts | `(slot, root, name)` |
| `'element'` | `@verajs/renderer/elements` asking about each element of a template, once, as the template is first used — the claimant returns a shared `{ mount?, unmount? }` for an element it wants, `undefined` for the rest; every instance then runs `mount(element, { root, adopted })` once its render has finished and `unmount(kept, element)` at teardown. Every registrant runs, in priority order | `(element)` |
| `'template'` | the renderer BUILDING a template — once per template, cached for the page. A hook may set `_$at$` on it, a resolver asked once per instance created which template to build at a position — `@verajs/renderer/namespaces` uses it to parse an `html` template in the namespace of where it lands — and may set its `_$inst$` to an INSTANCE HOOK — `{ $c, $m, $q }`, called for every instance of that template before its first update, once the render that created it has finished, and at teardown, each handed what the last returned — `@verajs/renderer/elements` uses it, and claims (slots' included) ride on that. One per template: `elements` sets its own at priority 10 — first — so a hook wired at the default priority wraps it; claim elements through `'element'` rather than writing a second one. Templates without one pay nothing per instance. Every registrant runs | `(template, result, readScope)` |
| `'loader'` | a DIRECTIVE NAME nobody has wired — `@verajs/directives` asks before rejecting an unknown `data-vd-*`, and `@verajs/autoloader`'s `directiveLoader` answers by convention (`{base}/{name}.js`). First claimer wins: return the `import()` promise (or any truthy) to claim, false/undefined to decline; the claimed module registers itself through `wireDirectives`, and the asker re-checks its registry when the promise settles | `(name, element)` |
| `'settle'` | a SERVER render's component tree is final — lifecycle run, frames drained, markup about to be serialized. The only moment a server can offer for reading rendered content, since `'init'` fires before the first render and a server has no observer to catch what follows. `@verajs/directives` evaluates declarative directives here, so reflections are correct before any JavaScript reaches the browser | `(element)` |
| `'value'` | a **child-position** value the renderer does not already handle — `<div>${value}</div>`. For types you do not own: a `Promise`, an `Observable`, a `Temporal.PlainDate`. Return `true` to claim the value and stop the chain. **Strings, numbers, `null` and `undefined` never reach it** — those take a fast path — so this cannot be used to intercept text | `(part, value)` |

Priority 50 is the convention for a default implementation: register below it to run first, or at it
to replace.

Every callback in a chain runs, in priority order. An insert that wants to change what core does —
rather than merely watch — says so through its return value: a `'store'` insert returns the handler
to use, each seeing the one chosen before it, so they compose.

For a whole new *kind* of hook rather than a new implementation of an existing one, `createHook` in
`@verajs/core` is the primitive `useEffect` and its siblings are built from.

## An insert that throws

**Nothing catches it, and that is deliberate — but it is not the same as a hook.** A `useEffect` that
throws is isolated and reported through the `'error'` insert, because core runs an element's hooks in
one loop and an escaping error would skip every hook after the failing one. An insert is not in that
position:

- **A `'store'` insert runs inside the store's first use of a value, and the handler it returns runs
  inside the store's own traps**, so a throw comes out of `state.count = 1` (or the read) in the
  caller's own stack, at the line that did it. That is the most useful place it could surface, and
  swallowing it would leave the write in an undefined state — the handler has already decided
  whether the value propagates. An insert that throws while deciding leaves the value undecided, so
  its next use asks again.
- **`'value'` is the same case**, for the same reason: it runs inside a child-position commit, so a
  throw comes out of `renderInto` at the line that called it.
- **`'init'` and `'render'` run inside `init()` and the render, so a throw surfaces there.** And the
  chain **stops** there: an insert is not isolated from the ones beside it, so every insert after
  the failing one is skipped. `'init'` is where per-element setup hooks in, so one throwing module
  keeps the rest from initializing at all — which is why the practical rule below matters most
  here.
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
import { collections } from '@verajs/store/collections';

wire([renderer, router, collections]);
```

`router` is a **connector** — `wire` hands it this registry, and the router keeps no registry
of its own. A module can also be an **array** of descriptors and connectors, nested as deep as it
likes — `@verajs/renderer/slots` is its discovery plus its `'slot'` strategy — and sits in the list
like any other module. That removes the hazard by construction rather than reconciling it afterwards, and it is
why `@verajs/router` has no dependencies at all. `tests/cdn-cross-bundle.test.mjs` guards the shape.

**Take `wire` from `@verajs/core`, never from this package.** `@verajs/eslint-config` has a rule for
exactly that mistake.

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.

## License

MIT
