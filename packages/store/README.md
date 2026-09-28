# @verajs/store

Reactivity primitives `@verajs/core` deliberately does not ship.

**Core *is* the reactivity system** — `createStore`, the proxy traps, the hook queue all live there.
This is what core leaves out: extensions to the store that not every app needs, and that every app
would otherwise pay for.

| Entry | | |
| --- | ---: | --- |
| `@verajs/store/computed` | <!--size:computed.gzip-->238 B<!--/size:computed.gzip--> | memoized derived values |
| `@verajs/store/collections` | <!--size:collections.gzip-->714 B<!--/size:collections.gzip--> | reactive `Map` and `Set` in a store |

Import from the package root and a bundler tree-shakes to what you used; point an import map at a
subpath and a buildless page downloads only that one. Both entries are **additive**: neither inlines
core, so loading both still leaves one core, one insert registry and one store identity.

The two reach core from opposite directions, and the difference decides how any future member is
written. `computed` **calls into** core — it imports `createStore` and `createHook`, because there is
no derived value without a store. `collections` is **called by** core: it is a `'store'` insert, so
core hands it its reactivity (the kit: `track`, `trigger`, `shape`) when a store first meets a
`Map` or `Set`, and it imports nothing from core. The question that settles which shape a module takes is *does core call you,
or do you call core?*

```sh
npm i @verajs/store
```

## `computed` — memoized derived values

<!-- recipe -->
```js
import { init, createStore, render, wire, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { computed } from '@verajs/store';

wire([renderer]);

customElements.define(
  'x-cart',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const cart = createStore({ items: [{ price: 3 }, { price: 4 }], coupon: '' });
      const total = computed(() => cart.items.reduce((n, item) => n + item.price, 0));

      render(() => html`
        <p>Total: ${total.value}</p>
        <button @click=${() => cart.items.push({ price: 5 })}>Add</button>
        <input .value=${cart.coupon} @input=${(e) => (cart.coupon = e.target.value)} />
      `);
    }
  }
);

document.body.append(document.createElement('x-cart'));
```

## What it buys over a plain function

`() => a + b` runs on every read. `computed(() => a + b)` runs once per **change**, and only when
something it actually read moves. Reading it a hundred times in one render costs one evaluation;
typing in that coupon field above re-renders and costs none, because `total` never read `coupon`.

That is the entire reason the primitive exists — and it is what the older "computed is a ten-line
insert" recipe never provided. That one re-invoked the function on every read, which is a getter
with extra steps.

## It is a store

Reading `.value` subscribes, so a component that reads a computed re-renders when it changes, and
computeds chain — one may read another and invalidation propagates through:

```js
const doubled = computed(() => state.n * 2);
const quadrupled = computed(() => doubled.value * 2);
```

The shape matches `ref()` deliberately: both are `.value`, so they are interchangeable at a call
site. It derives through anything a store tracks — nested objects, arrays, `Map`, `Set`, `WeakMap`,
`WeakSet`.

An evaluation that throws is reported through the `'error'` insert rather than escaping, exactly as
a hook is, and `.value` keeps serving the **last good value** — a derivation that fails once does not
take the render down with it.

## It is eager, not lazy — which is the opposite of the name's usual promise

**A computed evaluates when it is created and re-evaluates on every dependency change, whether or not
anything reads it.** Vue, Solid and Preact all defer to the read and cache until invalidated; this
does not. Measured: five writes with no reader at all produce six evaluations.

That is a consequence of how invalidation reaches a component, not an oversight. Reading `.value`
*subscribes*, so a component re-renders when the computed changes — and knowing it changed means
having computed it. A lazy computed can only say "I might have changed", which would re-render every
reader on every dependency write and lose exactly the memoization this exists for.

The practical consequence, and the reason it is written down here: **an expensive derivation that
nothing currently reads still costs on every write.** Reads are free and repeated reads are free —
what is not free is holding a computed nobody is using. If a derivation is expensive and conditional,
guard the *dependency*, not the read:

```js
// Runs on every `rows` write, even while the panel is closed.
const summary = computed(() => expensive(state.rows));

// Runs only while the panel is open.
const summary = computed(() => (state.panelOpen ? expensive(state.rows) : null));
```

## Lifetime

A computed lives as long as you hold it. One created inside a component is collected with that
component; one at module scope lasts for the page. There is nothing to dispose.

## Nothing was added to core for this

It is built on `createStore` and `createHook` through their public API — `@verajs/core` grew **two
bytes**, for returning a function it already constructed. That is the module system doing its job:
you pay <!--size:computed.gzip-->238 B<!--/size:computed.gzip--> if you want memoized derivations and nothing at all if you do not.

Unlike the other modules, this one keeps `@verajs/core` **external** in every build rather than
inlining it. It is built *on* core rather than beside it, and a standalone copy would hand a CDN
page a second core — a second insert registry, a second store identity, and computeds tracking
different objects from the components reading them.

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

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.

## License

MIT
