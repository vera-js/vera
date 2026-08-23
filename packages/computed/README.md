# @verajs/computed

Memoised derived values (<!--size:computed.gzip-->233 B<!--/size:computed.gzip--> gzip).

```sh
npm i @verajs/computed
```

<!-- recipe -->
```js
import { init, createStore, render, setRenderer, html } from '@verajs/core';
import { render as domRender } from '@verajs/renderer';
import { computed } from '@verajs/computed';

setRenderer(domRender);

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
a hook is.

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

## License

MIT
