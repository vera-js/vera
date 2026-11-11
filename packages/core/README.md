# @verajs/core

The heart of VeraJS: reactive state, an effect system, template tags, and the lifecycle glue that
ties them to a custom element. <!--size:core.gzip-->7.39 KB<!--/size:core.gzip--> gzipped, no base
class, no build step required, and one dependency — [`@verajs/inserts`](../inserts), the
extension registry, which the production bundle inlines.

There is no `Component` to extend and no compiler to run. A VeraJS component is a custom element
whose setup — a function that runs once and returns what to draw — `define()` registers for you (or
your own class hands to `init()`); everything reactive follows from the store it reads.

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
import { define, createStore, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);   // once, at your app entry, before any component defines itself

define({ tag: 'tap-counter', shadow: 'open' }, () => {   // shadow DOM; define('tap-counter', () => …) for light DOM
  const state = createStore({ count: 0 });                 // the setup runs once per connect

  effect(() => {
    document.title = `${state.count} taps`;                // re-runs whenever what it read changes
  });

  return () => html`<button @click=${() => state.count++}>Tapped ${state.count} times</button>`;
});

document.body.append(document.createElement('tap-counter'));
```

Nothing here declares a dependency. The returned render and the `effect` subscribe to whatever they
read while they run, so a write to `state.count` schedules exactly the work that read it — and the
setup around them, which reads nothing tracked, never runs again.

The returned render draws into the component's own root. To draw somewhere else — a modal or a toast on
`document.body` — call `portal(target, template)` from `@verajs/renderer/portal` in the setup: it draws in a range of
its own, updates like the render, and leaves with the component.

`define(tag, setup)` and `define({ tag, …options }, setup)` register the element and return its
class. **Name the setup** — `define('tap-counter', function TapCounter() { … })` — and a stack trace
from inside the component reads `TapCounter`: engines print function names, and the setup is where a
component's code runs. The options are `init`'s (`shadow`, `foreignNodes`, any wired module's own key) plus
`props`, `attributes` and `methods`, below. The string form passes no options at all. A tag is
defined once: a second `define` of it throws, as the platform's `customElements.define` does.

## Writing the class yourself

`define` writes the custom element class for you. When you need the class itself — inheritance,
`formAssociated`, `adoptedCallback`, a class you already have — write it and hand its setup to
`init()` from `connectedCallback`:

<!-- recipe -->
```js
import { init, createStore, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

customElements.define(
  'tally-button',
  class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {   // init(this, () => …) for light DOM
        const state = createStore({ count: 0 });
        return () => html`<button @click=${() => state.count++}>${state.count}</button>`;
      });
    }
  }
);

document.body.append(document.createElement('tally-button'));
```

Both forms run the same lifecycle: core wraps every `customElements.define` after it loads, so a
component moved within its document keeps its state, and one removed is torn down once.

## Props — what a parent passes in

A parent binds **properties**; the component reads them off its host. Nothing has to be declared
on either side — no `static properties`, no props argument:

<!-- recipe -->
```js
import { define, wire, html, effect } from '@verajs/core';
import { renderer, renderInto } from '@verajs/renderer';
import { props } from '@verajs/renderer/spread';

wire([renderer]);

define({ tag: 'order-summary', shadow: 'open' }, (host) => () => html`<p>${host.customer} — ${host.items.length} items</p>`);

renderInto(
  html`<order-summary ${props({ customer: 'Ada', items: [{ sku: 'a' }, { sku: 'b' }] })}></order-summary>`,
  document.body
);
```

Core **adopts** what the parent's property bindings delivered: each bound key becomes a
store-backed accessor on the element, so a read in a render is tracked and the parent's next
commit re-renders — reactivity in both directions, with values arriving **by identity** (an
array, a `Date`, a store or a `signal()` passed down stays itself, and stays live). Three things
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


### Declared props — for components other code drives

Adoption covers a Vera template passing values. A prop written by **plain code after the component
connected** — another framework, a CMS script, `card.heading = 'x'` — is not one it can hear: the
platform only lets a property write be observed through an accessor of that name, so the name has to
be known. Declaring it is how:

<!-- recipe -->
```js
import { define, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

define({ tag: 'note-card', props: { heading: 'Untitled', tags: [] } }, (host) => () =>
  html`<h3>${host.heading}</h3><p>${host.tags.join(', ')}</p>`);

const card = document.createElement('note-card');
document.body.append(card);
card.heading = 'Groceries';   // a plain write after connect: it repaints
card.tags.push('home');       // each card has its own list (the default is copied per element)
```

- **Defaults are lazy:** nothing is written for them until the first read or write, and an array or a
  plain-object default is shallow-copied per element (nested values stay shared). A `Set`, a `Map` or
  a class instance cannot be copied — every element would share one — so development says so: declare
  it `null` and create it in the setup.
- **A value set before the tag was defined wins** over the default, and is reactive from then on.
- **Types follow the defaults:** `host.heading` is a `string` in the setup and on the element.
- **Declare only what other code drives.** Declared props are public and reactive, which has a small
  price at creation; state nothing outside reads belongs in the setup's own store. (The measured
  engine behavior behind this is in [`docs/BROWSER-LEDGER.md`](../../docs/BROWSER-LEDGER.md).)
- Undeclared props keep the adoption above, unchanged.
- **Removing a component releases its props store** (Firefox keeps a removed element's fields alive
  until its cycle collector frees the node). The values survive a re-add, but outside code reading
  THAT element's props (`sensor.reading` from another component) does not follow it across a remove
  and re-add — share state through a store both read instead.

### Attributes — declared, the platform way

`attributes` lists observed attributes, as `observedAttributes` would; each arrives as a
`string | null` prop under its camel-cased name (`data-count` → `dataCount`). No `MutationObserver`:
a tag that declares none carries no attribute callback at all.

<!-- recipe -->
```js
import { define, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

define({ tag: 'tone-badge', props: { label: 'new' }, attributes: ['label', 'data-tone'] }, (host) => () =>
  html`<b>${host.label}</b> <small>${host.dataTone ?? 'plain'}</small>`);

const badge = document.createElement('tone-badge');
document.body.append(badge);
badge.setAttribute('label', 'beta');      // → host.label, and it repaints
badge.setAttribute('data-tone', 'warm');  // → host.dataTone
badge.removeAttribute('label');           // → null (not the default)
```

- **One way only:** attributes become props; writing the prop never touches the attribute.
- **Sharing a declared prop:** its default applies until the attribute appears. The attribute is a
  string, so a non-string default changes type when it does — development says so, and the type is
  widened to `default | string | null`.
- **A property set before the tag was defined beats the markup's attribute** for the same name.
- **Observing an attribute the platform already reflects** (`hidden`, `title`, `lang`, `aria-label`…)
  replaces that property: `el.hidden = true` then no longer hides the element. Development says so;
  read such an attribute with `host.getAttribute()` instead unless the component owns it.
- The server renders them: `@verajs/ssr` delivers a tag's observed attributes before it connects.

### Styles — the `styles` option

With `@verajs/styles` wired, `define({ tag: 'x-card', styles: css`b { color: tomato; }` }, setup)` styles the
component exactly as a class's `static styles` would — adopted into its shadow root, or hoisted once, scoped to the
tag, in light DOM. The option wins over `static styles` when both are given; `styles: null` means none.

### Methods — on the element, for the code that holds it

<!-- recipe -->
```js
import { define, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

define(
  {
    tag: 'confirm-dialog',
    shadow: 'open',
    props: { shown: false },
    methods: {
      open() { this.shown = true; },     // `this` is the element
      close() { this.shown = false; },
    },
  },
  (host) => () => html`<div ?hidden=${!host.shown}><slot></slot><button @click=${() => host.close()}>OK</button></div>`
);

const dialog = document.createElement('confirm-dialog');
document.body.append(dialog);
dialog.open();
```

Methods live on the class's prototype — one function for every element, `this` the element, as in
a class. They are enumerable, like the element's own interface (and so is a `define` component's
`connectedCallback`, unlike a class component's). `connectedCallback` and `constructor` are core's
own and never replaced (development says so); a `disconnectedCallback` among them runs as a teardown
hook. A name the platform's element already has (`focus`, `click`) replaces it — development says
that too.

## State

| | |
| --- | --- |
| `createStore(obj)` | deep reactive proxy — nested objects are tracked too (for a value held as it is, use `signal`) |
| `signal(value)` | a reactive box for one value, read and written as `.value` — **shallow**: replacing `.value` notifies, the contents are not proxied. `value` lives on a shared prototype: `JSON.stringify(sig)` is the value, `Object.keys(sig)` is `[]`, and only reading `.value` subscribes |
| `signal(value, { deep: true })` | the same, with the contents tracked too — a value you both replace and mutate inside (what `ref` was) |
| `computed(fn)` | a memoized derived value, read as `.value` — lazy, and linked only while something reads it |
| `untrack(fn)` | read current state without subscribing to it |

Reactive `Map`, `Set`, `WeakMap` and `WeakSet` need `@verajs/store/collections`: put one in a
store, wire that, and mutating methods notify like any other write. Without it core says so the first
time one is read.

```js
import { createStore, signal, untrack, effect } from '@verajs/core';

const state = createStore({ filter: 'all', rows: [] });
const focus = signal(null);                          // read and written as focus.value
const user = signal({ name: 'Ada' }, { deep: true }); // replace it, or mutate inside it: both tracked
const frame = signal(new Float32Array(64));          // .value tracked; the contents deliberately not

const total = () => untrack(() => state.rows.length);  // read without subscribing
// Reading a value inside a hook is what subscribes it — `void state.filter;` if you only need the dependency.
```

### `computed` — derived values

<!-- recipe -->
```js
import { init, createStore, computed, wire, html, effect } from '@verajs/core';
import { renderer } from '@verajs/renderer';

wire([renderer]);

customElements.define(
  'x-cart',
  class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        const cart = createStore({ items: [{ price: 3 }, { price: 4 }], coupon: '' });
        const total = computed(() => cart.items.reduce((n, item) => n + item.price, 0));

        return () => html`
        <p>Total: ${total.value}</p>
        <button @click=${() => cart.items.push({ price: 5 })}>Add</button>
        <input .value=${cart.coupon} @input=${(e) => (cart.coupon = e.target.value)} />
      `;
      });
    }
  }
);

document.body.append(document.createElement('x-cart'));
```

`() => a + b` runs on every read; `computed(() => a + b)` runs once per **change** of what it read.
Reading it a hundred times in one render costs one evaluation, and typing in that coupon field costs
none, because `total` never read `coupon`. Computeds chain — one may read another — and reading
`.value` inside a render or effect subscribes it, so the reader re-runs when the result changes (an
equal result re-runs nothing).

**It is linked only while something reads it.** Read by a render, an effect or another computed, it
is kept current inside the write that changes its source. Read by nothing, it holds no subscription at
all: it does not evaluate until read, and a read from plain code (a handler, module scope) evaluates
it then and caches the answer until the next store write. When its last reader goes — the component
removed, or a render that no longer reads it — it lets go of its sources by the end of that microtask.
So there is nothing to dispose: a computed made in a setup, in a render, in an effect or at module
scope never keeps anything alive past its last reader, even over a store that is never written again.

A computed made **inside a render** is a new one on every render (it is code in the render); the
previous render's lets go when the new render stops reading it. That is fine for something cheap to
evaluate; one that should live across renders belongs in the setup.

An evaluation that throws is reported through the `'error'` insert rather than escaping, and `.value`
keeps the **last good value**.

**A computed's internals are own properties: read `.value`.** `JSON.stringify` gives the value (of a computed, or of a
store or object holding one), but `Object.keys`, `for…in` and a spread see its internal fields.

**A diamond is not settled between its halves.** Where two computeds read one store and a third reads
both, a write re-evaluates the third once per half. A render or a plain `effect` (both coalesced) only ever
sees the settled value; a `'sync'` effect, which runs at once per write, can see the step between.

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

### A write that changes nothing wakes nothing

Writing a key the value it already has is not a change, by `Object.is`, the one rule stores, signals and computeds share:
`-0` over `0` is a change (stored and notified), `NaN` over `NaN` is not. `state.count = state.count` re-renders
nothing, and neither does `state.items = update(state.items)` when `update` returns its input. A key
behind a setter that already returns the value is not written either (the setter does not run).

Writing `undefined` to a key the object does not have **is** a change, as it is in the language: the
key now exists, so `'k' in state`, `Object.keys(state)` and anything listing the keys see it.

One deliberate exception: a value the object only **inherits** (from its prototype), written onto
it as itself (`state.x = state.x` where `x` comes from the prototype), is treated as no change, although
the language would create an own key there. Telling the two apart would cost every same-value write;
write a different value, or use `Object.defineProperty`, to create the own key.

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
changed"*. In production it is a short `TypeError` carrying the code, `store-refused`, which the
docs explain. It throws either way, **and a refused write throws even through `Reflect.set`**, which
on a plain object would return `false` instead: through a store, a write the language refuses is
always an error, never a quiet `false`. A refused `delete` throws the same way.

**Adding and removing keys counts as a change.** A component that enumerates — `Object.keys`,
`for…in`, `{ ...state.filters }`, `JSON.stringify`, or `key in state.form` — depends on the set of
keys rather than on any one of them, and hears about a key arriving or leaving. That is what makes
`state.byId[newId] = row` and `Object.assign(state.filters, patch)` render, and it is checked as a
matrix: every container kind crossed with every way of mutating it, against the data itself
(`tests/core-reactivity-matrix.test.mjs`).

**What a store keeps of what you assign: your object as you gave it, except an array of the store's own proxies.**
Reading a store hands you proxies, so `state.rows = state.rows.filter((r) => !r.done)` (or `slice`, or
`[...state.rows].sort(…)`) builds an array OF proxies. The store keeps a raw copy of such an array instead, one level
deep, and leaves your array exactly as it was; a list walked later then meets plain rows, which is faster. Anything
else is kept as you gave it, a record included: `state.row = { ...row, label }` is stored as that object, and the
store never scans it (so its getters never run on a write). Reading through the store is the same either way.
Write through the store (`state.rows.push(…)`), never through a variable you kept: a write the store does not see
renders nothing.

The copy is one level deep and of plain arrays only, so a few shapes keep proxies inside, each a somewhat slower
list, never a wrong answer: a frozen array, an Array subclass, and a second level (`state.grid = state.grid.map((r) =>
r.slice())` stores plain arrays of the cell proxies). One known limit: the copy reads every index, so a getter defined
on an array INDEX (`Object.defineProperty(list, 0, { get })`) runs when that array is written into a store.

**A getter on an Array subclass sees the raw array, so its reads are untracked.** With
`class List extends Array { get first() { return this[0]; } }` in a store, `state.list.first` returns the right value,
but a render that reads it is not woken when `state.list[0]` changes: the getter runs with the raw array as `this`, not
the store. Read through the indices (`state.list[0]`), or put the logic in a `computed` that reads them. A getter on a
plain object, a class instance included, runs with the store as `this` and is tracked.

**A subclass's own mutator runs with the raw array as `this`, so a field it writes isn't tracked.** With
`class Log extends Array { push(...x) { this.added = (this.added ?? 0) + x.length; return super.push(...x); } }` in a
store, `state.log.push(…)` updates the items and the length (both tracked), but a render reading `state.log.added` is
not woken. Development says so once per class (`subclass-mutator`), for a list held in a store (a store made from
the subclass itself is not checked). Keep that state in the store beside the list
(`state.log.push(x); state.added++`), derive it (`computed(() => state.log.length)`), or write the field through the
store (a helper taking `state.log`).

<!-- recipe -->
```js
import { createStore, effect } from '@verajs/core';

const state = createStore({ log: [], added: 0 });
let seen = -1;
effect(() => { seen = state.added; }, { owner: {}, timing: 'sync' }).run();
state.log.push('a');
state.added++;                                          // the count lives in the store, beside the list
if (seen !== 1 || state.log.length !== 1) throw new Error('the count kept in the store was not tracked');
```

**To clone, send or save state, take a `snapshot`.** A record is stored as given, so the raw data you passed to
`createStore` can hold stores, and a store can't be cloned (`structuredClone`, `postMessage` and IndexedDB throw on
one). `snapshot(state)` is a deep plain copy: every store replaced by its data at every depth, `Map`s and `Set`s copied
with their entries, cycles kept; anything else (a class instance, a `Date`) kept as it is. It costs a walk of what it
copies, only when you call it.

<!-- recipe -->
```js
import { createStore, snapshot } from '@verajs/core';

const user = createStore({ name: 'Ana' });
const state = createStore({ profile: null });
state.profile = { user, tags: new Set(['admin']) };   // a plain object holding a store

const plain = snapshot(state);                        // stores unwrapped at every depth
const copy = structuredClone(plain);                  // so it clones; the raw data itself would throw
if (copy.profile.user.name !== 'Ana' || !copy.profile.tags.has('admin')) throw new Error('snapshot lost data');
```

**A store isn't meant to be a prototype.** A write through `Object.create(store)` to a key the child doesn't own, or a
`Reflect.set` with a foreign receiver, lands in the store, not on the child or the receiver as it would with a plain
object. Telling the two apart costs every store write a check, so the store doesn't. When you want a child that keeps
its own values:

1. Give the child its own keys first, so it keeps them: `Object.create(store, { k: { value, writable: true,
   enumerable: true, configurable: true } })`, or `Object.defineProperty(child, k, …)`. Keys it doesn't own still read
   through to the store.
2. Make an independent reactive copy: `createStore({ ...snapshot(store), k })`.
3. Make a merged reactive view: `computed(() => ({ ...store, ...overrides }))`, which follows the store.
4. For `Reflect.set`, write to the receiver directly.

<!-- recipe -->
```js
import { createStore } from '@verajs/core';

const settings = createStore({ theme: 'light', size: 14 });
const child = Object.create(settings, { theme: { value: 'light', writable: true, enumerable: true, configurable: true } });
child.theme = 'dark';                                  // the child owns `theme`, so it keeps the write
if (child.theme !== 'dark' || settings.theme !== 'light') throw new Error('the own key did not stay on the child');
if (child.size !== 14) throw new Error('a key the child does not own reads through to the store');
```

<!-- recipe -->
```js
import { createStore, snapshot } from '@verajs/core';

const settings = createStore({ theme: 'light', size: 14 });
const draft = createStore({ ...snapshot(settings), theme: 'dark' });   // its own reactive store
draft.size = 16;
if (settings.size !== 14 || settings.theme !== 'light') throw new Error('the copy wrote back into the original');
if (draft.size !== 16 || draft.theme !== 'dark') throw new Error('the copy lost its own values');
```

**An array's mutators are fresh functions on every read.** `state.rows.push` runs the whole `push` and notifies once
(a hook never sees the array half-written), and to do that each read hands back a new function: `state.rows.push ===
state.rows.push` is `false`, unlike a plain array's. Call it where you read it; a kept reference still works, it is just
not `===` to the next read. A stable function per name was measured and cost a `push` on an unwatched array 18–35%.

**Use a `signal` for list data.** Putting 1 000 row objects through `createStore` proxies every one
of them, and reading every field back through those proxies costs about 15× the same read on a plain array
(the median ratio, 2026-10-16, Apple M1, Node 24 — `VERA_DIST=production node --test tests/perf-claims.test.mjs` prints
it; the gate requires at least 5× on every run). Earlier passes of this doc said 60× and then 20–30×: the store has
outgrown both as its reads got cheaper. When rows are replaced rather than mutated — which is the usual case —
a `signal` (shallow by default) is the right tool.

## Effects

| | Runs | Batching |
| --- | --- | --- |
| `effect(fn)` | after the render, in the same flush — before the browser paints | coalesced, one flush |
| `effect(fn, { timing: 'layout' })` | right after the render, before every plain effect — it sees the DOM the render just made, as a layout effect does in React | coalesced, one flush |
| `effect(fn, { timing: 'sync' })` | immediately on every change | **not** batched |
| `effect(fn, { priority })` | at the priority you give it — `25` runs before the render and sees the DOM the last render left; `65` between layout effects and effects | coalesced, one flush |

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
  way — call `flush()` before reading it. User input gains nothing from it; browsers already merge it. The frame it
  waits for is the window of the component that scheduled the flush: while that window is in the background, the
  browser slows its frames and timers, so an update can be delayed until the window is shown or its throttled timer
  fires;
- **a scheduler of your own** set with `setRenderScheduler` — it decides;
- **work waiting on the network** — a component whose module is still loading, a navigation fetching its route;
- **an effect's own `await`s** — they are the effect's work, not Vera's.

Two caveats: an effect runs before the browser paints its update, so a slow one delays that paint; and one event
whose several listeners each write state renders once per listener (the browser runs microtasks after each one) —
measured, the click still paints a frame sooner than frame scheduling did, but the work is repeated, so a hot event is
best handled by one listener making one write.

`effect(fn, { timing, priority, owner })` — every option optional. A `priority` is any finite number (a non-finite one
registers nothing, in both builds, and development says why, as for `wire`). Its owner is the component being set up;
pass `owner` for an effect made elsewhere — a module's own value, retired by whoever owns it — and that effect runs
when you call its `run()`. A returned function is its cleanup — run before the next run, **and on element removal**. No
`disconnectedCallback` is needed for it; if the component has one of its own, it still runs first. `effect` returns the
effect itself: `run()` runs it now, `stop()` ends it for good (its cleanup runs once; nothing runs it again).

```js
effect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});

effect(() => {
  // runs right after the render — measure here; a write re-renders in the same flush, before paint (no flash)
  height = list.getBoundingClientRect().height;
}, { timing: 'layout' });
```

The difference between coalesced and sync is what they observe:

```js
state.n = 1; state.n = 2; state.n = 3;
// effect(fn)                       → one run, sees 3
// effect(fn, { timing: 'sync' })   → three runs, sees 1, 2 and 3
```

A `'sync'` effect **can infinite-loop** if it unconditionally writes state it also reads. Guard the
write, or use a plain `effect`. In development the recursion is stopped and named at depth 50.

A plain effect and a template can loop too, and there the loop is real but not always a mistake: an
effect that writes what it reads runs twice per flush and then once more per frame — it can never
freeze the page. So development **warns and does not stop it**, after 50 consecutive frames in which
the pass fed itself, naming the hook that writes:

```
[vera] core: an effect on <x-clock> has re-run for 50 consecutive frames because it writes state it also reads …
```

A write that lands *outside* the pass — from your own `requestAnimationFrame`, a timer, an event —
never trips it at any threshold: only a pass whose own body writes what it reads is held. A frame
loop is plainest written with `requestAnimationFrame`; if a self-feeding effect is deliberate, say so:

```js
init(this, () => {
  allowRenderLoop(this);         // an animation driven by its own writes, on purpose
  effect(() => { state.t = state.t + 1 });
});
```

`allowRenderLoop(element)` silences the warning for that component, and is a no-op in production —
where none of this exists. In such a loop the render's third run waits for the frame along with the
effect's, so for that moment the DOM shows the state one step behind; this happens only past two runs
in one flush — a genuine loop — never to a measure-then-set, which settles in its second run.

Every effect receives the change that woke it: `change.prop`, `change.value` and `change.prevValue` (its type is
`Change`). A coalesced run describes the write that scheduled it; a `'sync'` effect runs once per write, so it sees
every one.

### Coming from React

| In React | In Vera |
| --- | --- |
| React's `useLayoutEffect` runs after the DOM update, before paint | `effect(fn, { timing: 'layout' })`: the same. |
| React's `useEffect` usually runs after paint (before it, after a click or a key press) | `effect(fn)` runs always before paint, in the same flush as the render — so an effect's write never flashes, and a slow effect delays its update's paint. |
| An effect re-runs when its dependency array changes | There is no dependency array: an effect re-runs when a store value it **read** changes. |
| The component function re-runs on every update | The setup runs once; only the render it returns and the hooks re-run. State lives in `createStore`. |
| Several handlers for one event render once (React routes events through the root) | Each listener that writes state renders on its own microtask — handle a hot event with one listener making one write. |
| An update loop throws "Maximum update depth exceeded" | It never freezes the page: a self-feeding hook runs twice per flush, then once per frame, and development warns after 50 frames. |
| React owns the DOM | A light host changed directly by page code is redistributed by the next microtask — read it after `await`. |

## Rendering

| | |
| --- | --- |
| `init(element, setup?)` | in `connectedCallback`. `setup(host)` runs once and returns the render — a function returning a template — or nothing. See below |
| `init({ host, shadow, foreignNodes, persist }, setup?)` | the same with options: `shadow` is `'open'`, `'closed'`, `false` (light DOM) or a `ShadowRootInit`; omitted, the app default `renderer({ shadow })`, else light DOM — see [ARIA and the shadow boundary](#aria-and-the-shadow-boundary). `foreignNodes` is `'drop'` (the default: the template owns its shadow root, and nodes something else put there go when the template changes) or `'preserve'`; omitted, the app default `renderer({ foreignNodes })`. `persist`: seconds a removed component stays paused before it is torn down (see the setup section) |
| `html` | the template tag. `@verajs/renderer` takes what it produces with no configuration |
| `svg` / `mathml` | for content inside `<svg>` / `<math>` |
| `wire([renderer])` | choose what writes to the DOM |
| `flush()` | run every queued render and effect now, synchronously — a test, or work that must see the DOM settled (a View Transition's callback). Inside a running flush (a hook, a render, or an event one of them fired) it does nothing — the DOM updates when that flush ends; development says so once. To read what a render made, use an effect with `{ timing: 'layout' }` |
| `setRenderScheduler(fn)` | when a FLUSH runs. The default, `microtask`, runs every flush at once. `frameBudget` opts into merging bursts of data: a microtask within about 4 ms of flush work per frame, and past it the **element's own window's** next frame (a component in a popped-out window or an iframe waits on that window's frames). A scheduler receives `(run, element)` and returns the one it replaced |

```js
import { init, mathml, html, flush, effect } from '@verajs/core';

class TickerLogger extends HTMLElement {
  connectedCallback() {
    init(this, () => {                   // light DOM: no options
      effect(() => console.log(state.tick));
    });                                  // returns nothing — this component draws nothing
  }
}

const formula = html`<math>${mathml`<mi>x</mi><mo>=</mo><mn>${x}</mn>`}</math>`;

document.startViewTransition(() => { state.rows = next; flush(); });  // the DOM settled inside the snapshot
```

**The setup is the component, and its return decides what is drawn.** `init` calls it once, with the
element as its argument (`host`), untracked — a read in it subscribes nothing. Every hook it registers
belongs to that element; when it returns, the first pass of each runs, then the render it returned.
Return a function and that function is the render, re-run when what it read changes. Return nothing and
the component draws nothing — its effects still run. Return a template itself instead of a function and
it is drawn once, never updated, and development says so: write `return () => html…`.

The one mistake the shape invites is state in the render: `return () => { const s = createStore(…); … }`
creates a new store on every render. State and hooks go in the setup, above the `return`.

**A class can keep a method instead.** `init(this)` with no setup calls the element's own `setup()`,
so this is the same component as the first one above:

```js
class ClickCounter extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }); }
  setup() {
    const state = createStore({ count: 0 });
    return () => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`;
  }
}
```

`init(this, () => this.setup())` is the same thing spelled out. Development names a near-miss
spelling (`setUp`, `Setup`, `set_up`) once.

**Set up on every connection, not once.** `connectedCallback` runs again each time the element is put
back in the page after leaving it — removed and re-appended later.
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

**A move into another window keeps the component too** — a panel popped out into a `window.open` window or
an iframe, and back, with plain DOM (`popup.document.body.append(panel)`, then `main.append(panel)`). Its
setup does not run again, so its state survives the trip both ways. What belongs to a window does run again:
every plain and `'layout'` effect runs its cleanup and then runs again, against the new window, as if
its inputs had changed — so a listener on the element's window, a frame loop or an observer follows the
panel. Its styles are applied again too (a move empties a shadow root's adopted stylesheets). Content is
built in the realm of the element it renders into, so a component that moved out keeps building with its
own window's classes and its child components work in every engine; an element the other window made — a
plain container, or a component that window's own registry defines — gets that window's classes. (Adoption
keeps an element's realm, so a container the main document made and then moved into an iframe still
builds with the main window's.) Three things follow:

- **Read the window inside an effect, not in setup**: `const win = host.ownerDocument.defaultView` in the
  setup is read once and stays the old window after a move.
- **Other side effects in an effect run again on such a move** — an analytics ping, a `fetch` written by
  hand. A `resource()` does not refetch, and an effect at a `priority` of your own is not re-run.
- **To reset a component on a move**, take it out and put it back in two steps (`remove()`, then
  `append()`): that is a removal and a connection, and it sets up fresh.

Focus does not survive a move into another document (the browser drops it); re-focus after the move. A
component left in a pop-out whose opener has closed is not supported: its code belonged to the opener.

**Hooks register while the setup runs, which matters for an async setup.** A setup may be `async`: its
hooks belong to the component up to its first `await`, and a hook after it finds no component and
**throws** (`no-owner`) — every time, whatever else is on the page. An async setup is atomic: nothing it
registered runs until it resolves, a write while it is pending does not run it again, and a rejection is
reported once through the error chain and draws nothing. **Removed while it is pending, the component waits up to 5 s
for it:** re-added in that time, the SAME setup carries on — it is never set up twice, so it fetches once and nothing it
registered runs twice; still out after 5 s, it is torn down (development says so).

**`persist: seconds` keeps a removed component paused.** Removing a component normally tears it down at once. With
`persist`, removal PAUSES it — every effect's cleanup runs (its listeners and intervals stop), its state and DOM are
kept — and re-adding it within that many seconds RESUMES it: every hook runs once, so anything it missed is drawn, and
its setup is not run again. Past the window it is torn down. Tabs, cached routes, a panel taken out and put back:

```js
define({ tag: 'x-tab', persist: 30 }, setup);   // removed: paused for up to 30 s, then torn down
```

`persist` takes seconds, 0 or more (0, the default: torn down at removal); anything else is 0, and development says so.
Its author's `connectedCallback` does not run again on a resume, as on a move.

```js
connectedCallback() {
  init({ host: this, shadow: 'open' }, async () => {
    const state = createStore({ data: null });
    effect(() => { document.title = state.data?.title ?? '…'; });   // hooks before the first await
    state.data = await fetch(this.dataset.url).then((r) => r.json());
    return () => html`<p>${state.data.title}</p>`;
  });
}
```

Or keep the setup synchronous and write what arrives into state: create `state` with `data: null`, return
the render, and assign `state.data` when the fetch resolves — the component shows its empty state first.
An effect made after the first `await` throws (`no-owner`): make it before the `await`. Server-side,
`renderToStringAsync` awaits an async setup either way.

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
  init({ host: this, shadow: 'open' }, () => {
    this.state = createStore({ label: this.getAttribute('label') });   // the initial value
    return () => html`<p>${this.state.label}</p>`;
  });
}
```

Without the guard the component still renders, because a custom-element reaction that throws is
*reported* rather than rethrown — so the cost is an uncaught `TypeError` in the console of every page
using one, and nothing here can warn about it.

`svg` and `mathml` are not stylistic. A namespace is decided when markup is parsed and cannot be
fixed afterwards, so `html` alone produces an `HTMLUnknownElement` named `circle` — which parses
fine and never draws anything.

```js
return () => html`
  <svg viewBox="0 0 10 10">
    ${svg`<circle cx=${x} cy=${y} r=${r} fill=${color} />`}
  </svg>
`;
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
| `effect(fn, { owner, priority })` | for a module's own reactive value: owned by `owner` (any object), run by its `run()`, ended by `stop()` |

The points are `'render'`, `'init'`, `'store'` (a store first using a value — returns the handler that
makes it reactive: how `@verajs/store/collections` claims `Map`/`Set`, and how batching or devtools
wrap core's `set`), `'error'` (a hook or an element ref threw) and `'value'` (a child-position value
the renderer has no built-in answer for).
[`@verajs/inserts`](../inserts) documents each one, with signatures.

```js
import { wire, inserts, effect } from '@verajs/core';

wire({ on: 'error', fn: (error, element) => report(error, element?.localName), priority: 50 });

const errorChain = inserts.get('error');            // the registry itself: name -> ordered chain

const watcher = effect((change, first) => { if (!first) log(change); }, {
  owner: myModule,                                  // a module's own: not a component's, so it runs when asked
  priority: 65,                                     // between the layout effects (60) and the effects (75)
});
watcher.run();                                      // its first run subscribes it; watcher.stop() ends it
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
<my-field></my-field>            //  init({ host: this, shadow: 'open' }, () => () => html`<input id="email">`)
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
     init({ host: this, shadow: 'open' }, setup);
   }
   ```
3. **Use light DOM** — no `shadow` option — when a component's whole job is to
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

Every line the framework prints starts `[vera]`, so one console filter finds them all, and every package gives every
line a code — including the line printed beside an error your own code threw, `[vera] hook-threw` in production
(only where the platform has no `reportError`; a browser reports it the platform's way).
Development prints the explanation and the fix, ending with the code in parentheses:
`[vera] core: <x-card> — registered 2 hook(s) but its setup was never committed, so none of them will ever run. … (setup-uncommitted)`.
Production prints a short line instead — the subject and a link, `[vera] core: <x-card> — https://verajs.dev/e/setup-uncommitted`,
or, where even the link would cost bytes, the bare code, `[vera] router-redirect-loop: /checkout`. A thrown error
names its function and then the link, `untrack: https://verajs.dev/e/untrack-not-function` (or the bare code,
`initRouter: router-no-view`), with its subject, where it has one, before the link in the same ` — `:
`parseFrontmatter: line 3 — https://verajs.dev/e/cms-frontmatter-unsupported`. A cms validation line names its field
rather than a function, `"date": this required field is missing. (cms-entry-required)`, and keeps its words in every
build. A few thrown errors keep their words in every build instead of a code: cms's programmer contracts
(`serializeContent`, the writer's and reader's name and path checks) and the server DOM's imitations of the platform's
own errors. A JSX compile error names its position, `app.jsx:1:15 — https://verajs.dev/e/jsx-tag-mismatch`. Whichever
form you hold, the full explanation of a code is at `https://verajs.dev/e/<code>`.

## The rest

The complete API reference lives in the repository's [`llms.txt`](../../llms.txt) — written to be
pasted into an AI context window, and just as readable by people. It carries the full export list,
the buildless CDN and JSX recipes, what VeraJS deliberately does not support, and the mistakes that
come up most.

## License

MIT
