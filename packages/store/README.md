# @verajs/store

Reactivity primitives `@verajs/core` deliberately does not ship.

**Core *is* the reactivity system** — `createStore`, the proxy traps, the hook queue all live there.
This is what core leaves out: extensions to the store that not every app needs, and that every app
would otherwise pay for.

| Entry | | |
| --- | ---: | --- |
| `@verajs/store/collections` | <!--size:collections.gzip-->672 B<!--/size:collections.gzip--> | reactive `Map` and `Set` in a store |
| `@verajs/store/resource` | <!--size:resource.gzip-->396 B<!--/size:resource.gzip--> | async data as a reactive cell |

Import from the package root and a bundler tree-shakes to what you used; point an import map at a
subpath and a buildless page downloads only that one. Every entry is **additive**: none inlines core,
so loading them all still leaves one core, one insert registry and one store identity.

`computed` lived here until 2026-10-22; it is core's now (`import { computed } from '@verajs/core'`).

```sh
npm i @verajs/store
```

## `collections` — reactive `Map` and `Set`

`wire([collections])` and a `Map` or `Set` inside a store tracks like anything else.

| Reading | Subscribes to |
| --- | --- |
| `get(k)`, `has(k)` | that key |
| `size`, `entries()`, `keys()`, `values()`, `forEach()` | every change |
| `for…of`, `[...collection]` | every change |

`set`, `add`, `delete` and `clear` notify. **Reactivity is per entry, not deep**: a value comes back
as it was put in, so mutating an object *inside* a collection notifies nothing — replace the entry
instead. `WeakMap` and `WeakSet` work and cannot be iterated, so they subscribe per key only.

**A reactive type of your own is a `'store'` insert too** — the extension point `collections`
itself uses, and the only one. It decides per **type** — the name `Object.prototype.toString` gives a
value, lower-cased: `'object'`, `'array'`, `'map'` — once, never per store, read or write; it is handed
the handler chosen so far plus core's kit. Your class names its type the way the platform's own do,
with `Symbol.toStringTag`:

```js
import { wire } from '@verajs/core';

class MyCollection {
  get [Symbol.toStringTag]() { return 'MyCollection'; }   // → type 'mycollection'
  // …
}

wire({
  on: 'store',
  priority: 60,
  fn: (type, handler, kit) =>
    type === 'mycollection'
      ? {
          get(obj, prop) {
            if (prop === 'size') kit.track(obj, kit.shape);   // shape readers subscribe here
            // …wrap methods: kit.track(obj, key) on reads, kit.trigger(obj, key, next, prev) and
            // kit.trigger(obj, kit.shape, …) on mutations
            return Reflect.get(obj, prop, obj);
          },
        }
      : handler,
});
```

A subclass of `Map` without a tag of its own is a `'map'`, and `collections` handles it. **Wire it
whenever you like**: every store of the type — ones created, even used, before the `wire` call — takes
it, because every proxy of a type shares one handler and `wire` decides it again.

`kit.shape` is the channel meaning *the container changed shape*, as opposed to one entry changing.
It comes from core at runtime rather than as a literal of your own, so what you notify is always
what core and every other module track.

## `resource` — async data as a reactive cell

```js
import { resource } from '@verajs/store/resource';

define('x-user', (host) => {
  const user = resource((signal) => fetch(`/api/users/${host.id}`, { signal }).then((r) => r.json()));
  return () =>
    user.loading ? html`<p>loading…</p>`
    : user.error ? html`<p>couldn't load</p>`
    : html`<h2>${user.value.name}</h2>`;
});
```

One cell — `loading`, `value`, `error`, `refreshing` — that a render reads like any store.

- **What its source reads, it follows.** The source runs tracked up to its first `await`: when something it read
  changes, the previous request's `AbortSignal` fires and the source runs again. Only the latest request ever writes,
  so a slow old answer can never overwrite a newer one, and an aborted request is not an error.
- **The states.** First load: `loading` is true and `value` undefined. A refetch keeps the previous `value` on screen
  with `refreshing` true. An error after a value keeps the value and sets `error`. A source that throws is an error; one
  that returns a plain value settles at once.
- **It belongs to its component.** Create it in a setup (outside one it throws, as any hook does — a render included).
  The first request starts as the component sets up; removing the component aborts the request in flight and drops a
  late answer. A component moved within a page, or into another window, keeps its data: a move never refetches.
- **Load, then fetch:** make the source itself async — `resource(async (signal) => { const cfg = await loadConfig();
  return fetchUser(cfg, { signal }); })` — so the resource is created in the setup's synchronous part.
- **On a server it does not fetch**: the page renders the loading state and the browser fetches. A handoff — the
  server waiting for the data and the page carrying it to hydration, with no second request — is planned; `key` names a
  resource for it and does nothing yet.

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.

## License

MIT
