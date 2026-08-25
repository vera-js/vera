# @verajs/core

The heart of VeraJS: reactive state, an effect system, template tags, and the lifecycle glue that
ties them to a custom element. <!--size:core.gzip-->2.56 KB<!--/size:core.gzip--> gzipped, no base
class, no build step required, and one dependency — [`@verajs/inserts`](../inserts), the
extension registry, which the production bundle inlines.

There is no `Component` to extend and no compiler to run. A VeraJS component is a custom element
that calls `init()` and then `render()`; everything reactive follows from the store it reads.

```sh
npm i @verajs/core @verajs/renderer
```

Core does not write to the DOM itself — a renderer does, and it is a separate install. That is the
one piece of wiring VeraJS asks for, and it is what lets you swap in lit-html, a string renderer for
tests, or your own.

## A component, whole

<!-- recipe -->
```js
import { init, createStore, render, wire, html, useEffect } from '@verajs/core';
import { domRender } from '@verajs/renderer';

wire([domRender]);   // once, at your app entry, before any component defines itself

customElements.define(
  'click-counter',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });               // shadow DOM; omit the second argument for light DOM
      const state = createStore({ count: 0 });

      useEffect(() => {
        document.title = `${state.count} clicks`; // re-runs whenever what it read changes
      });

      render(() => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`);
    }
  }
);

document.body.append(document.createElement('click-counter'));
```

Nothing here declares a dependency. `render` and `useEffect` subscribe to whatever they read while
they run, so a write to `state.count` schedules exactly the work that read it.

## State

| | |
| --- | --- |
| `createStore(obj)` | deep reactive proxy — nested objects are tracked too |
| `ref(value)` | a deep reactive box for a single value, read and written as `.value` |
| `shallowRef(value)` | `.value` is tracked; the contents are **not** proxied |
| `untrack(fn)` | read current state without subscribing to it |
| `deps(...values)` | touch values explicitly, to register them as dependencies |
| `store._delete()` | sever every subscription for an object store at once |

Reactive `Map`, `Set`, `WeakMap` and `WeakSet` are built in: put one in a store and mutating methods
notify like any other write.

**Adding and removing keys counts as a change.** A component that enumerates — `Object.keys`,
`for…in`, `{ ...state.filters }`, `JSON.stringify`, or `key in state.form` — depends on the set of
keys rather than on any one of them, and hears about a key arriving or leaving. That is what makes
`state.byId[newId] = row` and `Object.assign(state.filters, patch)` render, and it is checked as a
matrix: every container kind crossed with every way of mutating it, against the data itself
(`tests/core-reactivity-matrix.test.mjs`).

**Use `shallowRef` for list data.** Putting 1 000 row objects through `createStore` proxies every one
of them, at roughly 60× the per-render cost of a plain array. When rows are replaced rather than
mutated — which is the usual case — `shallowRef` is the right tool.

## Effects

| | Runs | Batching |
| --- | --- | --- |
| `useLayoutEffect` | before render | coalesced, microtask |
| `useEffect` | after render | coalesced, animation frame |
| `useSyncEffect` | immediately on every change | **not** batched |

All three take `(callback, element?)` and treat a returned function as cleanup — run before the next
pass, **and on element removal**. No `disconnectedCallback` is needed for it; if the component has
one of its own, it still runs first.

```js
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

The difference between coalesced and sync is what they observe:

```js
state.n = 1; state.n = 2; state.n = 3;
// useEffect     → one run, sees 3
// useSyncEffect → three runs, sees 1, 2 and 3
```

`useSyncEffect` **can infinite-loop** if it unconditionally writes state it also reads. Guard the
write, or use `useEffect`.

Every callback receives a signal describing the change: `signal.prop`, `signal.value`,
`signal.prevValue`, and on coalesced runs `signal.changed` — a `Map` of every property in the batch,
holding its value at the start and at the end.

## Rendering

| | |
| --- | --- |
| `init(element, shadowProps?)` | call first in `connectedCallback`. `{ mode: 'open' }` for shadow DOM |
| `render(template?, ...args)` | draw, and commit the setup. See below |
| `html` | the template tag. Produces a lit-compatible result |
| `svg` / `mathml` | for content inside `<svg>` / `<math>` |
| `css` | for `static styles`, with `@verajs/styles` |
| `wire(domRender)` | choose what writes to the DOM |
| `setRenderScheduler(fn)` | defaults to `requestAnimationFrame`; pass `microtask` for Lit/Vue-style timing |
| `setHtml` / `setCss` | swap the template tags |

**`render()` ends the setup as well as drawing it.** Call it bare when a component has no markup of
its own — its effects still run, and without that call the setup is never committed. In development,
a component that finishes `connectedCallback` without reaching `render()` warns.

`svg` and `mathml` are not stylistic. A namespace is decided when markup is parsed and cannot be
fixed afterwards, so `html` alone produces an `HTMLUnknownElement` named `circle` — which parses
fine and never draws anything.

```js
render(() => html`
  <svg viewBox="0 0 10 10">
    ${svg`<circle cx=${x} cy=${y} r=${r} fill=${color} />`}
  </svg>
`);
```

## Extending it

Core dispatches five extension points and knows nothing about what is registered on them. Renderers,
autoloaders, `static styles` adoption, error boundaries and write batching are all built this way,
outside core, on the same public surface you have.

| | |
| --- | --- |
| `wire({ on: name, fn: callback, priority: priority })` | register on an extension point — **priority is required** |
| `inserts` | the registry itself |
| `createHook({ callback, priority, element? })` | build your own hook type |

The points are `'render'`, `'init'`, `'proxy-handler'` (a store read), `'set-handler'` (a store
write — return `false` to hold the default propagation back) and `'error'` (a hook threw).
[`@verajs/inserts`](../inserts) documents each one.

**Take `insert` from `@verajs/core`, not from `@verajs/inserts`.** A production bundle inlines the
registry, so registering through a separately imported copy writes to a map core never reads — it
works in development and silently does nothing in production.

## Two things that will bite you

**Custom-element fields must be `declare`d in TypeScript.** At ES2022 a class field is a definition,
not an assignment: `item?: Item` emits `item;`, which runs during element upgrade and overwrites
whatever a parent already bound there. Write `declare item?: Item` — it emits nothing, and the
binding survives. In development the renderer warns when it observes this happening.

**Prefer a stable template shape over swapping subtrees.** Rendering the same elements every pass
and toggling `?hidden` keeps template identity, so values update in place instead of the subtree
being torn down and rebuilt:

```js
// fragile
html`<section>${items.length ? html`<ul>${rows}</ul>` : html`<p>empty</p>`}</section>`;

// preferred
html`<section>
  <ul ?hidden=${!items.length}>${rows}</ul>
  <p ?hidden=${items.length > 0}>empty</p>
</section>`;
```

## The rest

The complete API reference lives in the repository's [`llms.txt`](../../llms.txt) — written to be
pasted into an AI context window, and just as readable by people. It carries the full export list,
the buildless CDN and JSX recipes, what VeraJS deliberately does not support, and the mistakes that
come up most.

## License

MIT
