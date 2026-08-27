# @verajs/reactivity

Reactivity primitives `@verajs/core` deliberately does not ship.

**Core *is* the reactivity system** — `createStore`, the proxy traps, the hook queue all live there.
This is what core leaves out: extensions to the store that not every app needs, and that every app
would otherwise pay for.

| Entry | | |
| --- | ---: | --- |
| `@verajs/reactivity/computed` | <!--size:computed.gzip-->241 B<!--/size:computed.gzip--> | memoised derived values |
| `@verajs/reactivity/collections` | <!--size:collections.gzip-->528 B<!--/size:collections.gzip--> | reactive `Map` and `Set` in a store |

Import from the package root and a bundler tree-shakes to what you used; point an import map at a
subpath and a buildless page downloads only that one. Both entries are **additive**: neither inlines
core, so loading both still leaves one core, one insert registry and one store identity.

The two reach core from opposite directions, and the difference decides how any future member is
written. `computed` **calls into** core — it imports `createStore` and `createHook`, because there is
no derived value without a store. `collections` is **called by** core: it implements the
`'collection'` extension point, so core hands it `addCallback` and `runCallbacks` at dispatch and it
imports nothing at all. The question that settles which shape a module takes is *does core call you,
or do you call core?*

```sh
npm i @verajs/reactivity
```

## `computed` — memoised derived values

```sh
npm i @verajs/reactivity
```

<!-- recipe -->
```js
import { init, createStore, render, wire, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { computed } from '@verajs/reactivity';

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
reader on every dependency write and lose exactly the memoisation this exists for.

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
you pay 233 B if you want memoised derivations and nothing at all if you do not.

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

Two more exports are the extension point itself, for anyone implementing the `'collection'` insert
rather than using this one:

| | |
| --- | --- |
| `collectionMethod` | the implementation `collections` wires. Wrap it to add a type, or read it as the reference |
| `GLOBAL` | the key that means *the collection changed shape*, as opposed to one entry changing |

`GLOBAL` is `'_global'`, and **it is a contract with `@verajs/core`, which declares the same literal
rather than importing it.** A production bundle inlines its dependencies, so an import would work in
development and, in production, subscribe to one string while notifying another. Core tracks it from
`ownKeys` and from a `size` read; a collection implementation notifies it on every mutation that adds
or removes an entry. Notify something else and `${state.map.size}` silently stops updating.

## License

MIT
