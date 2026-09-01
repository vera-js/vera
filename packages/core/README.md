# @verajs/core

The heart of VeraJS: reactive state, an effect system, template tags, and the lifecycle glue that
ties them to a custom element. <!--size:core.gzip-->2.99 KB<!--/size:core.gzip--> gzipped, no base
class, no build step required, and one dependency — [`@verajs/inserts`](../inserts), the
extension registry, which the production bundle inlines.

There is no `Component` to extend and no compiler to run. A VeraJS component is a custom element
that calls `init()` and then `render()`; everything reactive follows from the store it reads.

```sh
npm i @verajs/core @verajs/renderer
```

Core does not write to the DOM itself — a renderer does, and it is a separate install. That is the
one piece of wiring VeraJS asks for: `wire([renderer])`, once, at your app entry.

It is also what makes the renderer replaceable — a string renderer for tests, lit-html for an app
already written against it, or your own — but that is a door, not a step. `@verajs/renderer` and
core's `html` need nothing configured between them.

## A component, whole

<!-- recipe -->
```js
import { init, createStore, render, wire, html, useEffect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);   // once, at your app entry, before any component defines itself

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

Reactive `Map`, `Set`, `WeakMap` and `WeakSet` need `@verajs/reactivity/collections`: put one in a
store, wire that, and mutating methods notify like any other write. Without it core says so the first
time one is read.

### What "deep" reaches, and what it does not

A store proxies **plain objects, arrays, class instances, `Object.create(null)` objects, and the four
collections**. Everything else is handed back exactly as it was put in:

`Date`, `RegExp`, `Promise`, `Error`, `URL`, `URLSearchParams`, typed arrays, `ArrayBuffer`,
`DataView`, functions and DOM nodes.

That is deliberate, and it is the same reason collection methods have to be re-bound: these types
carry state in **internal slots** rather than in properties, so a proxy cannot see a change and in
several cases cannot even be called on one. Reading `state.when` gives you the real `Date`, and
`state.when.setHours(9)` changes it — but **nothing re-renders**, because no property was written.

Replace them instead of mutating them, which is what makes the change visible:

```js
state.when = new Date(state.when.setHours(9));   // a write to `when`, so it renders
state.pixels = new Uint8Array(next);             // not state.pixels[0] = …
```

There is no warning for this. A `Date` read to format it is far more common than a `Date` read to
mutate it, so a warning would be noise on the ordinary case — which is why it is written down here
instead.

### A frozen source object stays frozen

A store is a proxy, and a proxy has to respect its target's rules. `createStore(Object.freeze(…))`
reads fine and **throws on any write**, because JavaScript says the object is not writable and no
amount of proxying changes that. The same goes for a sealed object gaining a *new* key, an object
under `Object.preventExtensions`, a property defined `writable: false`, and a getter with no setter —
and it applies to a frozen object nested inside an ordinary store, which is the way it usually turns
up: a constants table sitting in state.

Everything that is *not* forbidden works, which is the larger half. Sealed objects take writes to
existing keys, setters run with `this` bound through the proxy, class instances keep their prototype
getters, `Object.create(null)` objects and symbol keys both round-trip.

In development the error names the rule that refused — *"the object is frozen, so `n` cannot be
changed"*. In production you get the engine's own `TypeError: 'set' on proxy: trap returned falsish`,
which is a message about the proxy's internals; the development build exists to tell you what it
actually means. It throws either way.

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
write, or use `useEffect`. In development the recursion is stopped and named at depth 50.

`useEffect` and a template can loop too, and there the loop is real but not always a mistake: the
default scheduler is an animation frame, so an effect that writes what it reads simply runs once per
frame — which is also how you write an animation. So development **warns and does not stop it**,
after 50 consecutive frames in which the pass fed itself:

```
[vera] useEffect has re-run for 50 consecutive frames because it writes state it also reads …
```

A write that lands *outside* the pass — from your own `requestAnimationFrame`, a timer, an event —
never trips it at any threshold, because the count resets on the first pass that does not feed
itself. Only a pass whose own body writes what it reads climbs. If that is deliberate, say so:

```js
init(this);
allowRenderLoop(this);           // an animation: one store write per frame, on purpose
useEffect(() => { state.t = state.t + 1 });
```

`allowRenderLoop(element)` silences the warning for that component, and is a no-op in production —
where none of this exists.

Every callback receives a signal describing the change: `signal.prop`, `signal.value`,
`signal.prevValue`, and on coalesced runs `signal.changed` — a `Map` of every property in the batch,
holding its value at the start and at the end.

## Rendering

| | |
| --- | --- |
| `init(element, shadowProps?)` | call first in `connectedCallback`. `{ mode: 'open' }` for shadow DOM — see [ARIA and the shadow boundary](#aria-and-the-shadow-boundary) |
| `render(template?, ...args)` | draw, and commit the setup. See below |
| `html` | the template tag. `@verajs/renderer` takes what it produces with no configuration |
| `svg` / `mathml` | for content inside `<svg>` / `<math>` |
| `css` | for `static styles`, with `@verajs/styles` |
| `mount()` | commit the setup for a component that draws nothing |
| `wire(renderer)` | choose what writes to the DOM |
| `setRenderScheduler(fn)` | defaults to `requestAnimationFrame`; pass `microtask` for Lit/Vue-style timing |
| `setHtml` / `setCss` | swap the template tags |

**`init()` opens a component's setup and one of two calls closes it.** `mount()` commits: it runs the
first pass of every hook registered since `init()` and clears the instance. `render(template)` is
exactly `useRender(template)` followed by that same commit — a compound over the base operation, not
a second way to do the same thing, which is why a component only ever calls one of them.

Use `mount()` when a component has no markup of its own. Hooks that are never committed never run:
no error, no render, an effect that simply does not happen — so in development a component that
finishes `connectedCallback` without reaching either call warns and names both.

**Setup is one synchronous block, which matters for `async connectedCallback()`.** Only one component
is being set up at a time, so a second component's `init()` takes the slot from the first — and an
`await` between `init()` and `render()` hands it over. One component alone is fine; two on a page,
each fetching, and whichever resumes second renders nothing. Await *before* `init()`:

```js
async connectedCallback() {
  const data = await fetch(this.dataset.url).then((r) => r.json());   // await first
  init(this, { mode: 'open' });                                       // then set up, synchronously
  const state = createStore({ data });
  render(() => html`<p>${state.data.title}</p>`);
}
```

Server-side this is already handled for you: `renderToStringAsync` awaits `connectedCallback`.

**Taking input from an attribute.** Attributes are half of how a web component receives anything, and
the wiring is yours: write the new value into a store the template reads. The one sharp edge is the
platform's ordering — `attributeChangedCallback` runs *before* `connectedCallback` for any attribute
already in the markup, so the store does not exist yet on that first call. Guard it, and read the
initial value in `connectedCallback`:

```js
static observedAttributes = ['label'];

attributeChangedCallback(name, previous, value) {
  if (!this.state) return;          // upgrade: setup has not run yet
  this.state.label = value;
}

connectedCallback() {
  init(this, { mode: 'open' });
  this.state = createStore({ label: this.getAttribute('label') });   // the initial value
  render(() => html`<p>${this.state.label}</p>`);
}
```

Without the guard the component still renders, because a custom-element reaction that throws is
*reported* rather than rethrown — so the cost is an uncaught `TypeError` in the console of every page
using one, and nothing here can warn about it.

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

## ARIA and the shadow boundary

**Every ID-based ARIA relationship resolves within a single tree, so a shadow root breaks it
silently.** `aria-labelledby`, `aria-describedby` and `<label for>` all match by ID, and IDs do not
cross a shadow boundary — there is no error and no warning, just an element with no accessible name.
Verified in Chromium, Firefox and WebKit (`tests/browser/aria-shadow-boundary.test.js`); it is the
platform's rule, not this framework's.

```js
// Broken: the label is in the page, the input is in the shadow root.
<label for="email">Email</label>
<my-field></my-field>            //  init(this, { mode: 'open' }); render(() => html`<input id="email">`)
```

Three ways through, in the order worth reaching for:

1. **Keep the relationship inside one root.** Render the label and the control in the same template.
   This is the common case and needs nothing special.
2. **Put the ARIA on the host with `ElementInternals`.** The host lives in the outer tree, so a role
   and an accessible name set there are visible to the page and need no ID at all:

   ```js
   connectedCallback() {
     this._internals ??= this.attachInternals();
     this._internals.role = 'button';
     this._internals.ariaLabel = 'Save';
     init(this, { mode: 'open' });
   }
   ```
3. **Use light DOM** — omit the second argument to `init` — when a component's whole job is to
   participate in relationships the page owns. Style isolation is what you give up; `static styles`
   still works, hoisted once per class.

`delegatesFocus: true` is the related shadow option: it makes the host focusable and forwards focus
to the first focusable child, which is what a custom control usually wants.

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
