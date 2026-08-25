# @verajs/collections

Reactive `Map` and `Set` inside VeraJS stores. Mutations notify, reads subscribe, per entry.

```js
import { init, createStore, render, html, wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { collections } from '@verajs/collections';

wire([renderer, collections]);

const state = createStore({ users: new Map([['u1', 'Ada']]) });
render(() => html`<p>${state.users.get('u1')} of ${state.users.size}</p>`, host);

state.users.set('u1', 'Grace');   // re-renders
```

Take `wire` from `@verajs/core`, never from `@verajs/inserts`: a production `.min.js` inlines its
dependencies, so registering through your own copy writes where core never looks — working in
development and silently doing nothing in production.

## Why it is a package

Most stores hold plain objects, and before the split every app carried **367 B gzipped** for
collections it never created. An app that does not wire this is **292 B smaller**; one that does
pays **24 B** over having it built in.

Nothing is silent if you forget. Native collection methods throw when invoked on a proxy — their
internal slots live on the raw target — so core raises a `__DEV__` error naming this package the
first time a `Map` or `Set` is read from a store with nothing registered, and the call after it
throws rather than quietly doing nothing.

## What is reactive, and what is not

Change detection is per method, and no-op mutations are silent:

| | fires when |
| --- | --- |
| `set` | the key was absent, or the value differs |
| `add` | the value was absent |
| `delete` | it returned `true` |
| `clear` | the collection was non-empty — every previous key is notified |

| | subscribes to |
| --- | --- |
| `get`, `has` | that key |
| `entries`, `keys`, `values`, `forEach`, `size` | every change |
| `for…of`, spread | **nothing** — iterate via `entries()` when you need reactivity |

Reactivity is **per entry, not deep**: values come back raw. `map.get === map.get` holds, because
one wrapper is cached per collection per method rather than allocated per read.

`WeakMap` and `WeakSet` work too; their keys are held in a `WeakMap` container so a tracked key
does not keep an object alive.

## History

This shipped as `@verajs/map-support`, was folded into core on 2026-08-20, and moved back out on
2026-08-24. Both objections that retired it were about the extension point it used, and both are
answered by the one it uses now:

- *It threw until the insert was registered.* Wiring is one entry in a list an app already
  maintains, and the `__DEV__` error above names the fix.
- *The per-read insert-chain walk.* That cost belonged to `'proxy-handler'`, which runs on every
  read of every store. `'collection'` is **type-keyed** — core dispatches it only when the target is
  already known to be a `Map` or `Set`, so a plain-object read never reaches the lookup, which is
  resolved once per process. Measured over 24 rotated rounds and 300 000 reads, a plain read got
  *faster* (139.3 → 129.9 ns/op) and a `Map.size` read stayed flat.

## Writing your own

`'collection'` is a public insert point. Register below priority 50 to run first, or at 50 to
replace this implementation:

```js
wire({ name: 'my-collections', on: 'collection', fn: myCollectionMethod, priority: 50 });
```

`fn` receives `(obj, prop, propValue, addCallback, runCallbacks)` and returns the function to hand
back from the proxy's `get` trap. `obj` is the raw collection, `propValue` its native method;
`addCallback(obj, key)` subscribes the current render and `runCallbacks(obj, key, value, prevValue)`
notifies. The `'_global'` channel means "the container changed shape" — core tracks it from
`ownKeys` and from a `size` read, so notify it alongside the key on every mutation.
