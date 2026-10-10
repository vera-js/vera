# @verajs/core

The heart of VeraJS: reactive state, an effect system, template tags, and the lifecycle glue that
ties them to a custom element. <!--size:core.gzip-->2.54 KB<!--/size:core.gzip--> gzipped, no base
class, no build step required, and one dependency — [`@verajs/inserts`](../inserts), the
extension registry, which the production bundle inlines.

There is no `Component` to extend and no compiler to run. A VeraJS component is a custom element
that calls `init()` and then `render()`; everything reactive follows from the store it reads.

```sh
npm i @verajs/core @verajs/renderer
```

Core does not write to the DOM itself — a renderer does, and it is a separate install. That is the
one piece of wiring VeraJS asks for: `wire([renderer])`, once, at your app entry.

It is also what makes the renderer replaceable — a string renderer for tests, or your own — but
that is a door, not a step. `@verajs/renderer` and core's `html` need nothing configured between
them. (The seam is real and continuously asserted — `tests/foreign-renderer.test.mjs` drives a
foreign renderer through it — but no alternative renderer is offered as a supported mode.)

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

## Props — what a parent passes in

A parent binds **properties**; the component reads them off `this`. Nothing is declared on either
side — no `static properties`, no props argument to `init()`:

<!-- recipe -->
```js
import { init, render, wire, html } from '@verajs/core';
import { renderer, renderInto } from '@verajs/renderer';
import { props } from '@verajs/renderer/spread';

wire([renderer]);

customElements.define(
  'order-summary',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<p>${this.customer} — ${this.items.length} items</p>`);
    }
  }
);

renderInto(
  html`<order-summary ${props({ customer: 'Ada', items: [{ sku: 'a' }, { sku: 'b' }] })}></order-summary>`,
  document.body
);
```

`init()` **adopts** what the parent's property bindings delivered: each bound key becomes a
store-backed accessor on the element, so a read in a render is tracked and the parent's next
commit re-renders — reactivity in both directions, with values arriving **by identity** (an
array, a `Date`, a store or a `ref()` passed down stays itself, and stays live). Three things
worth knowing:

- **Values come from property bindings** — `.date=${…}` in a template, `props({ date })` in
  either surface, or a sigil-keyed `spread()` bag. An attribute (`date="…"`) is a string in
  markup, not a prop; the renderer README draws the full property/attribute line.
- **Lazy modules are safe.** A value bound before the component's module ran would be destroyed
  by class-field initializers at upgrade; the renderer records it and `init()` re-applies —
  a bound value outranks a class default, in both field spellings (`item;` and `item = default`).
- **A prop's default belongs where the prop is born**: bind
  `props({ date: date ?? defaultDate })` in the parent, or read `this.date ?? defaultDate` in the
  component — a class field initializer is not a default for a bound key, because bound always
  wins.
- **A class that declares its own accessors keeps them.** A `get item()`/`set item()` pair
  receives bound values through the setter — adoption never shadows it — which also means the
  pair owns its reactivity: back it with your own store (`set item(v) { this.#state.item = v }`)
  and later commits re-render exactly as adopted props do. A getter with no setter refuses the
  binding by name in development instead of silently losing the value. **A setter that READS state
  (`this.#state.seen = this.#state.item`) must read it through `untrack()`** — the setter runs during the
  parent's render, so a tracked read subscribes the PARENT, and a parent that passes a fresh object each
  render (`.items=${[...]}`) then re-renders forever. A plain write, as above, is safe.
- **SSR delivers them too.** Under `@verajs/ssr`, a property bound on a rendered component tag
  reaches that child's server render by identity, so the server's output comes from the same data
  the client render gets.

## State

| | |
| --- | --- |
| `createStore(obj)` | deep reactive proxy — nested objects are tracked too |
| `ref(value)` | a deep reactive box for a single value, read and written as `.value` |
| `shallowRef(value)` | `.value` is tracked; the contents are **not** proxied |
| `untrack(fn)` | read current state without subscribing to it |

Reactive `Map`, `Set`, `WeakMap` and `WeakSet` need `@verajs/store/collections`: put one in a
store, wire that, and mutating methods notify like any other write. Without it core says so the first
time one is read.

```js
import { createStore, ref, shallowRef, untrack } from '@verajs/core';

const state = createStore({ filter: 'all', rows: [] });
const focus = ref(null);                    // read and written as focus.value, deeply tracked
const frame = shallowRef(new Float32Array(64)); // .value tracked; the contents deliberately not

const total = () => untrack(() => state.rows.length);  // read without subscribing
// Reading a value inside a hook is what subscribes it — `void state.filter;` if you only need the dependency.
```

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
of them, and reading every field back through those proxies measures 20–30× the cost of the same
read on a plain array (three runs, 2026-09-05 — an earlier pass of this doc said 60×, which the
store has since outgrown). When rows are replaced rather than mutated — which is the usual case —
`shallowRef` is the right tool.

## Effects

| | Runs | Batching |
| --- | --- | --- |
| `useLayoutEffect` | right after the render, before every `useEffect` — it sees the DOM the render just made, as in React | coalesced, one flush |
| `useEffect` | after the render, in the same flush — before the browser paints | coalesced, one flush |
| `useSyncEffect` | immediately on every change | **not** batched |
| `useHook` | at the priority you give it — `25` runs before the render and sees the DOM the last render left; `65` between layout effects and effects | coalesced, one flush |

**Every queued render, layout effect and effect runs in one flush, on a microtask — so after any `await`,
everything Vera has queued is done:** the DOM and its effects are current, on every device. In a flush, renders run
first, then layout effects, then effects, and parents before their children: a child re-rendered by its parent's new
props renders once. A hook may run **twice** in one flush — so an effect that measures what was just rendered and
stores it lands before paint. `flush()` runs everything queued at once, synchronously, without waiting for an
`await`.

The cases where Vera has deliberately **not** queued the work yet, so an `await` does not wait for it:

- **a self-feeding loop** — a hook's third run in one flush waits for the next frame, so a loop can never freeze the page;
- **`frameBudget`, if you opt in** (`setRenderScheduler(frameBudget)`) — for apps that receive bursts of data as many
  tasks in one frame: past about 4 ms of flush work in a frame, the next flush waits for the frame, so a burst renders
  about once per frame (2–4× faster to the final DOM, measured). The trade: after `await` the DOM may still be on its
  way — call `flush()` before reading it. User input gains nothing from it; browsers already merge it;
- **a scheduler of your own** set with `setRenderScheduler` — it decides;
- **work waiting on the network** — a component whose module is still loading, a navigation fetching its route;
- **an effect's own `await`s** — they are the effect's work, not Vera's.

Two caveats: an effect runs before the browser paints its update, so a slow one delays that paint; and one event
whose several listeners each write state renders once per listener (the browser runs microtasks after each one) —
measured, the click still paints a frame sooner than frame scheduling did, but the work is repeated, so a hot event is
best handled by one listener making one write.

`useLayoutEffect`, `useEffect` and `useSyncEffect` take `(callback, element?)`, and `useHook` takes
`(callback, priority, element?)` — the same shape with the one thing it adds (`createHook`, the raw primitive under
all of them, takes an options object instead: it is the building block for modules, not a hook to call in setup). All four treat a returned function as
cleanup — run before the next pass, **and on element removal**. No `disconnectedCallback` is needed for it; if the component has
one of its own, it still runs first.

```js
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});

useLayoutEffect(() => {
  // runs right after the render — measure here; a write re-renders in the same flush, before paint (no flash)
  height = list.getBoundingClientRect().height;
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

`useEffect` and a template can loop too, and there the loop is real but not always a mistake: an
effect that writes what it reads runs twice per flush and then once more per frame — it can never
freeze the page. So development **warns and does not stop it**, after 50 consecutive frames in which
the pass fed itself, naming the hook that writes:

```
[vera] useEffect on <x-clock> has re-run for 50 consecutive frames because it writes state it also reads …
```

A write that lands *outside* the pass — from your own `requestAnimationFrame`, a timer, an event —
never trips it at any threshold: only a pass whose own body writes what it reads is held. A frame
loop is plainest written with `requestAnimationFrame`; if a self-feeding effect is deliberate, say so:

```js
init(this);
allowRenderLoop(this);           // an animation driven by its own writes, on purpose
useEffect(() => { state.t = state.t + 1 });
```

`allowRenderLoop(element)` silences the warning for that component, and is a no-op in production —
where none of this exists. In such a loop the render's third run waits for the frame along with the
effect's, so for that moment the DOM shows the state one step behind; this happens only past two runs
in one flush — a genuine loop — never to a measure-then-set, which settles in its second run.

Every callback receives a signal describing the change: `signal.prop`, `signal.value` and
`signal.prevValue`. A coalesced run describes the write that scheduled it; `useSyncEffect` runs once
per write, so it sees every one.

### Coming from React

| In React | In Vera |
| --- | --- |
| `useLayoutEffect` runs after the DOM update, before paint | The same. |
| `useEffect` usually runs after paint (before it, after a click or a key press) | Always before paint, in the same flush as the render — so an effect's write never flashes, and a slow effect delays its update's paint. |
| An effect re-runs when its dependency array changes | There is no dependency array: an effect re-runs when a store value it **read** changes. |
| The component function re-runs on every update | Setup runs once; only `render()` and the hooks re-run. State lives in `createStore`. |
| Several handlers for one event render once (React routes events through the root) | Each listener that writes state renders on its own microtask — handle a hot event with one listener making one write. |
| An update loop throws "Maximum update depth exceeded" | It never freezes the page: a self-feeding hook runs twice per flush, then once per frame, and development warns after 50 frames. |
| React owns the DOM | A light host changed directly by page code is redistributed by the next microtask — read it after `await`. |

## Rendering

| | |
| --- | --- |
| `init(element, shadowProps?)` | call first in `connectedCallback`. `{ mode: 'open' }` for shadow DOM — see [ARIA and the shadow boundary](#aria-and-the-shadow-boundary) |
| `render(template?, ...args)` | draw, and commit the setup. See below |
| `html` | the template tag. `@verajs/renderer` takes what it produces with no configuration |
| `svg` / `mathml` | for content inside `<svg>` / `<math>` |
| `mount()` | commit the setup for a component that draws nothing |
| `useRender(template, element, ...args)` | the lower-level half of `render`: registers a render on the component being set up that draws into `element` — which may be a different element |
| `wire([renderer])` | choose what writes to the DOM |
| `flush()` | run every queued render and effect now, synchronously — a test, or work that must see the DOM settled (a View Transition's callback). Inside a running flush (a hook, a render, or an event one of them fired) it does nothing — the DOM updates when that flush ends; development says so once. To read what a render made from a hook, use `useLayoutEffect` |
| `setRenderScheduler(fn)` | when a FLUSH runs. The default, `microtask`, runs every flush at once. `frameBudget` opts into merging bursts of data: a microtask within about 4 ms of flush work per frame, and past it the **element's own window's** next frame (a component in a popped-out window or an iframe waits on that window's frames). A scheduler receives `(run, element)` and returns the one it replaced |

```js
import { init, mount, useRender, useEffect, mathml, html, flush } from '@verajs/core';

class TickerLogger extends HTMLElement {
  connectedCallback() {
    init(this);                          // light DOM: no second argument
    useEffect(() => console.log(state.tick));
    mount();                             // commits the setup — this component draws nothing
  }
}

const formula = html`<math>${mathml`<mi>x</mi><mo>=</mo><mn>${x}</mn>`}</math>`;

useRender(() => html`<p>${state.n}</p>`, element);  // during setup: draw into another element, on this component's lifecycle

document.startViewTransition(() => { state.rows = next; flush(); });  // the DOM settled inside the snapshot
```

**`init()` opens a component's setup and one of two calls closes it.** `mount()` commits: it runs the
first pass of every hook registered since `init()` and clears the instance. `render(template)` is
exactly `useRender(template)` followed by that same commit — a compound over the base operation, not
a second way to do the same thing, which is why a component only ever calls one of them.

Use `mount()` when a component has no markup of its own. Hooks that are never committed never run:
no error, no render, an effect that simply does not happen — so in development a component that
finishes `connectedCallback` without reaching either call warns and names both.

**Set up on every connection, not once.** `connectedCallback` runs again each time the element is put
back in the page after leaving it — removed and re-appended later, or taken into a popped-out window.
Call `init()` and register the hooks there every time, and keep state on the
element (`this.state ??= createStore(…)`) or in a store, so it survives the trip. Each `init()` starts
a fresh generation of hooks, so re-attached components show current state and have live effects. Guarding setup with `if (this.started) return` — the habit the platform's
own guidance on repeated `connectedCallback` suggests — leaves effects torn down as soon as they run
after a re-attach, and what it shows stays as it was.

**A move is not a removal.** A component moved in ONE operation — `append` or `insertBefore` of an
element that is already in the page, which is how a keyed list reorders and how light-DOM slots
place a slotted component — keeps everything: neither its own
`disconnectedCallback` nor its `connectedCallback` runs, its effects stay live, and nothing is set up
twice. Core tells a move from a removal the way the platform lets it: a moved element is still
connected when its `disconnectedCallback` runs. Taking the element out first (`remove()` then
`append()`, or a hop through a `DocumentFragment`) is a removal followed by a connection, and gets
both. This applies to components — elements that have called `init()`; any other custom element
gets the platform's callbacks untouched.

**Setup is one synchronous block, which matters for `async connectedCallback()`.** It starts at `init()` and ends
at the end of that microtask turn, so a hook, `render()` or `mount()` after an `await` in setup finds no component
and **throws** (`no-owner`) — every time, whatever else is on the page. Await *before* `init()`:

```js
async connectedCallback() {
  const data = await fetch(this.dataset.url).then((r) => r.json());   // await first
  init(this, { mode: 'open' });                                       // then set up, synchronously
  const state = createStore({ data });
  render(() => html`<p>${state.data.title}</p>`);
}
```

Or set up first and write what arrives into state: `init(this)`, `const state = createStore({ data: null })`,
`render(…)`, then `state.data = await load()`. A hook created later can still be given its element explicitly
(`useEffect(fn, this)`). Server-side, `renderToStringAsync` awaits `connectedCallback` either way.

**Taking input from an attribute.** Attributes are the other half of how a web component receives
anything — [Props](#props--what-a-parent-passes-in) is the half that carries *values*, and an
attribute carries a **string** that is visible in markup, which makes it the right channel for CSS
hooks, static markup and anything a person may write by hand in HTML. Reach for a prop for data
(objects, arrays, stores, dates) and an attribute for the rest.

Unlike props, the wiring here is yours: write the new value into a store the template reads. The one
sharp edge is the platform's ordering — `attributeChangedCallback` runs *before* `connectedCallback`
for any attribute already in the markup, so the store does not exist yet on that first call. Guard
it, and read the initial value in `connectedCallback`:

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

The tag is chosen where a template is WRITTEN, not where it lands, so a template handed across a
function boundary into an `<svg>` keeps the tag it was written with — `` Frame(html`<path/>`) ``
does not draw, and the call site has no way to know. **`@verajs/renderer` names that in
development**, with both remedies; see its README. In JSX it mostly cannot happen, because
`@verajs/jsx` tags an SVG-rooted template automatically.

## Extending it

Core dispatches seven extension points and knows nothing about what is registered on them.
Renderers, autoloaders, `static styles` adoption, reactive collections, error boundaries and write
batching are all built this way, outside core, on the same public surface you have.

| | |
| --- | --- |
| `wire({ on: name, fn: callback, priority: priority })` | register on an extension point — **priority is required** |
| `inserts` | the registry itself |
| `createHook({ callback, priority, element? })` | the raw hook primitive, for modules — it runs inside every write it hears, unbatched (what a `computed` needs). For a hook scheduled like the built-in ones, use `useHook` |

The points are `'render'`, `'init'`, `'store'` (a store first using a value — returns the handler that
makes it reactive: how `@verajs/store/collections` claims `Map`/`Set`, and how batching or devtools
wrap core's `set`), `'error'` (a hook or an element ref threw) and `'value'` (a child-position value
the renderer has no built-in answer for).
[`@verajs/inserts`](../inserts) documents each one, with signatures.

```js
import { wire, inserts, createHook } from '@verajs/core';

wire({ on: 'error', fn: (error, element) => report(error, element?.localName), priority: 50 });

const errorChain = inserts.get('error');            // the registry itself: name -> ordered chain

createHook({                                        // the raw primitive: runs INSIDE every write it hears, unbatched
  callback: (change, first) => { if (!first) log(change); },
  priority: 65,                                     // its first pass: after useLayoutEffect (60), before useEffect (75)
});
```

**Take `wire` from `@verajs/core`, not from `@verajs/inserts`.** A production bundle inlines the
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

**An element that never calls `init()` must `declare` its TypeScript fields.** At ES2022 a class
field is a definition, not an assignment: `item?: Item` emits `item;`, which runs during element
upgrade and overwrites whatever a parent bound there before the element's module loaded. A component
that calls `init()` is repaired for you — `init()` re-applies every value bound before it ran, so a
bound value outranks the class default in both spellings and no `declare` is needed. An element that
never calls `init()` (a plain custom element a vera template binds) keeps the loss: write
`declare item?: Item`, which emits nothing, and development names the clobber when it observes one.

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

## Diagnostics — reading a `[vera]` line

Every line the framework prints starts `[vera]`, so one console filter finds them all. Every package but `@verajs/cms`
also gives every line a code; cms's messages carry codes before release.
Development prints the explanation and the fix, ending with the code in parentheses:
`[vera] core: <x-card> — registered 2 hook(s) but its setup was never committed, so none of them will ever run. … (setup-uncommitted)`.
Production prints a short line instead — the subject and a link, `[vera] core: <x-card> — https://verajs.dev/e/setup-uncommitted`,
or, where even the link would cost bytes, the bare code, `[vera] router-redirect-loop: /checkout`; a thrown error
names its function, `initRouter: router-no-view`. Whichever form you hold, the full explanation of a code is at
`https://verajs.dev/e/<code>`.

## The rest

The complete API reference lives in the repository's [`llms.txt`](../../llms.txt) — written to be
pasted into an AI context window, and just as readable by people. It carries the full export list,
the buildless CDN and JSX recipes, what VeraJS deliberately does not support, and the mistakes that
come up most.

## License

MIT
