# @verajs/directives

Attribute-activated behaviour for VeraJS — the adjectives to the component system's nouns.

A directive is a `data-vd-*` attribute that makes ordinary markup do something. There is no build
step, no compile pass and **no hydration**: handlers are matched by attribute at dispatch time from
one root listener, so markup swapped in from a fetch, a server render or a CMS is live the instant
it lands.

```html
<div data-vd-state="{ open: false }">
  <button data-vd-on-click="{ open: !open }" data-vd-bind-aria-expanded="open">Menu</button>
  <nav data-vd-show="open">…</nav>
</div>
```

## Install

```sh
npm i @verajs/core @verajs/renderer @verajs/directives
```

<!-- recipe -->
```js
import { wire, init, render, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { directives, wireDirectives, expressions, interaction, stateOf, settled } from '@verajs/directives';

/** The engine activates per component; the packs supply the vocabulary. */
wire([renderer, directives]);
wireDirectives([expressions, ...interaction]);

customElements.define('menu-bar', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`
      <div data-vd-state="{ open: false, count: 0 }">
        <button data-vd-on-click="{ open: !open, count: count + 1 }">Menu</button>
        <nav data-vd-show="open" data-vd-class="{ busy: count > 3 }">…</nav>
      </div>`);
  }
});

document.body.append(document.createElement('menu-bar'));
await settled();

const region = document.querySelector('menu-bar').shadowRoot.querySelector('[data-vd-state]');
region.querySelector('button').click();
await settled();
console.assert(stateOf(region).open === true, 'the handler ran with no hydration step');
```

## Size

Enrolled per ENTRY rather than as one number, because one number would mislead: the root bundle
re-exports every pack, while a typical app wires the engine plus expressions and interaction, and
an app using motion pays more than everything else combined.

| entry | gzip | what it is |
| --- | --- | --- |
| `@verajs/directives/core` | <!--size:directives.gzip.bytes-->5 967 B<!--/size:directives.gzip.bytes--> | the engine — registry, activation, context, delegation (core external) |
| `@verajs/directives/standalone` | <!--size:directives-standalone.gzip.bytes-->7 282 B<!--/size:directives-standalone.gzip.bytes--> | the engine with its own store, for a page running no vera |
| `@verajs/directives/expressions` | <!--size:directives-expressions.gzip.bytes-->2 343 B<!--/size:directives-expressions.gzip.bytes--> | arithmetic, comparisons, calls |
| `@verajs/directives/interaction` | <!--size:directives-interaction.gzip.bytes-->3 561 B<!--/size:directives-interaction.gzip.bytes--> | events, reflections, state |
| `@verajs/directives/query` | <!--size:directives-query.gzip.bytes-->1 616 B<!--/size:directives-query.gzip.bytes--> | `route`, `query`, `region` |
| `@verajs/directives/sensors` | <!--size:directives-sensors.gzip.bytes-->2 234 B<!--/size:directives-sensors.gzip.bytes--> | environment → state |
| `@verajs/directives/remote` | <!--size:directives-remote.gzip.bytes-->1 302 B<!--/size:directives-remote.gzip.bytes--> | server-driven interactions |
| `@verajs/directives/motion` | <!--size:directives-motion.gzip.bytes-->22 251 B<!--/size:directives-motion.gzip.bytes--> | presets, easings, paint, path, sequence, split |

Packs you never import cost nothing — pinned by a Rollup tree-shaking test, not asserted.

## Event payloads

A handler reads the event that ran it through `$` variables:

<!--payloads-->
- every base — $type
- `click`, `dblclick`, `mousedown`, `mouseup`, `mousemove`, `contextmenu`, `pointerdown`, `pointerup`, `pointermove` — $x $y $button $type
- `keydown`, `keyup`, `keypress` — $key $type
- `input`, `change` — $value $checked $type
<!--/payloads-->

```html
<input data-vd-on-input="{ q: $value }" />
```

They are primitives by construction rather than the event object: native event properties live on
prototypes, so exposing them would mean handing attribute text the entire DOM API. Register your own base
with `wirePayloads({ 'my:event': { n: (e) => e.detail.n } })`, list the vocabulary with
`describePayloads()`, and know that an unknown `$var` refuses the whole handler rather than quietly
writing `undefined`.

## The packs

- **`expressions`** — the value tier. Without it a value is a literal or a state path; with it,
  arithmetic, comparisons, ternaries and a small allowlist of calls.
- **`interaction`** — `state`, the `on-*` event family, `show`, `class`, `style`, `bind-*`, `sync`,
  `text`, `every`, `watch`, `focus-*`, `scroll-*`, `persist`, `copy`, `doc-class`, `init`.
- **`query`** — `route` publishes `@route`; `query` binds state keys to the URL's query string;
  `region` filters, facets and pages a list of elements and publishes its counts back into state.
- **`sensors`** — `in-view`, `measure`, `pointer`, `scroll-progress`, `swipe`. Every one degrades to
  a readable page when the capability is missing.
- **`remote`** — `data-vd-fetch`. A JSON response patches state; a markup response swaps a region,
  same-origin only, always.
- **`motion`** — one `data-vd-motion` attribute taking a preset or an object of two halves:
  animated properties inside `keyframes`, settings outside it. That is also what makes `%`
  unambiguous — inside `keyframes` it is progress along the animation, outside it a position on the
  screen.

  ```html
  <div data-vd-motion="fade-up">…</div>   <!-- needs wireDirectives([motion, presets]) -->

  <div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 40px, 100% 0px' },
                         scroll: '70%, 50%' }">…</div>

  <div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '50%', play: 0.6 }">…</div>
  ```

  **`scroll` names where the animation begins and ends. Scrubbing spreads it across that span;
  playing runs it at each end.** Without `play` it tracks scroll position; with `play` (in seconds)
  crossing a threshold runs the keyframes over time — one `scroll` half is a line crossed both ways,
  two halves are an entrance and an exit, and `run-once` latches after the first play.

  The settings are the half worth knowing about, because three of them — `transform-origin`,
  `perspective` and `will-change` — are real CSS property names that do NOT animate here. They
  configure the animation, so they live outside `keyframes` with `scroll`, `play`, `ease`, `anchor`,
  `inertia`, `stagger`, `when`, `run-once`, `pin` and `progress`. Put one in the wrong half and it is refused by
  name with the move spelled out, in both directions.

  **Presets are a pack, and ours is an example rather than the list.** A preset is a motion value
  with a name — `keyframes` plus any settings — so a project can encode its whole house style under
  one word. `presets` is a dual, like `motion`: bare for the shipped ten, called for your own.

  ```js
  wireDirectives([motion, presets({
    'hero-in': { keyframes: { opacity: '0% 0, 100% 1' }, ease: 'out-cubic', inertia: 0.4 },
  })]);
  ```

  `presets(table)` **merges** over the shipped ten, yours winning key by key — so redefining
  `fade-up` keeps the other nine — and it builds a safe lookup for you, since a bare `TABLE[name]`
  answers `Object.prototype.constructor` for `"constructor"` and preset names are attribute text.
  Wire one or the other, never both: the chain answers from the first resolver, so `presets` beside
  `presets(table)` means your overrides silently never apply, and it is refused.

  A preset expands before every other key is read, so an explicit key on the element always wins —
  `{ preset: 'hero-in', inertia: 0.9 }` is `hero-in` with your inertia, whichever order you write
  the two in.

  To inherit nothing, use `motionExtension` — which is also how a module adds animatable properties,
  new settings, or hooks a lifecycle point:

  ```js
  motionExtension({ on: 'preset', fn: (name) => resolve(name) });          // your own resolver
  motionExtension({ key: 'letter-spacing', category: 'text', /* … */ });   // a new property
  motionExtension({ key: 'hero-delay', type: 'number', min: 0, max: 10 }); // a new setting
  motionExtension({ on: 'release', fn: (node) => cache.delete(node) });    // per-element cleanup
  ```

  Keys **replace** with a `motion-vocabulary-replaced` warning; inserts (`preset`, `easing`,
  `prepare`, `release`, `teardown`, `forget`) **chain**, first answer winning.

## Actions — the escape hatch

The value grammar is bounded on purpose: no `eval`, no `Function`, no inline JavaScript. For the
last one percent, register a named function and invoke it from a handler:

```js
wireActions({ checkout: (ctx, event) => api.checkout(ctx.get('cart')) });
```
```html
<button data-vd-on-click="{ res: checkout() }">Buy</button>
```

The attribute names a function and never contains one; `describeActions()` enumerates every one a
page can reach; and actions run only while a handler is firing, so a reflection cannot fire one on
every render.

## Server rendering

`wire([directives])` is correct in a browser **and** under `@verajs/ssr` — the connector picks its
insert point per runtime. Reflections are evaluated into the markup server-side, so a `show` that
resolves false arrives already hidden and the client's first pass changes nothing. Guard your
*renderer* wiring for SSR, never your directives wiring.

## Diagnostics

Every refusal is recorded rather than thrown: `rejections(el?)` returns
`{ element, directive, code, message, fix }`. Production keeps the element, directive and code and
drops the prose, so a code is the stable thing to match on — `diagnostics.json` in this package maps
all of them to their sentences, and is what a tool or an editor should read.

`describeDirectives()` returns the live vocabulary, so build a picker from it rather than a
hand-written list.

## Documentation

The complete API, the value classes and the directive-authoring contract are in `llms.txt` at the
repository root, whose examples are executed by the test suite.
