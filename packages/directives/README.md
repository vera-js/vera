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
import { directives, wireDirectives, expressions, interactions, stateOf, settled } from '@verajs/directives';

/** The engine activates per component; the packs supply the vocabulary. */
wire([renderer, directives]);
wireDirectives([expressions, ...interactions]);

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
re-exports every pack, while a typical app wires the engine plus expressions and interactions, and
an app using motion pays more than everything else combined.

| entry | gzip | what it is |
| --- | --- | --- |
| `@verajs/directives/core` | <!--size:directives.gzip.bytes-->6 141 B<!--/size:directives.gzip.bytes--> | the engine — registry, activation, context, delegation (core external) |
| `@verajs/directives/standalone` | <!--size:directives-standalone.gzip.bytes-->7 470 B<!--/size:directives-standalone.gzip.bytes--> | the engine with its own store, for a page running no vera |
| `@verajs/directives/expressions` | <!--size:directives-expressions.gzip.bytes-->2 343 B<!--/size:directives-expressions.gzip.bytes--> | arithmetic, comparisons, calls |
| `@verajs/directives/interactions` | <!--size:directives-interactions.gzip.bytes-->3 760 B<!--/size:directives-interactions.gzip.bytes--> | events, reflections, state |
| `@verajs/directives/query` | <!--size:directives-query.gzip.bytes-->3 186 B<!--/size:directives-query.gzip.bytes--> | `route`, `query`, `list` |
| `@verajs/directives/sensors` | <!--size:directives-sensors.gzip.bytes-->2 243 B<!--/size:directives-sensors.gzip.bytes--> | environment → state |
| `@verajs/directives/remote` | <!--size:directives-remote.gzip.bytes-->3 669 B<!--/size:directives-remote.gzip.bytes--> | server-driven interactions |
| `@verajs/directives/motion` | <!--size:directives-motion.gzip.bytes-->25 170 B<!--/size:directives-motion.gzip.bytes--> | presets, paint, path, sequence, split |

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

**Exit transitions for `show` are CSS now, not a feature.** An element leaving the page used to
need a JS grace period so its transition could finish before `hidden` landed; the platform closed
that gap, so this pack deliberately ships nothing for it. The whole recipe:

```css
nav[data-vd-show] {
  transition: opacity 0.3s, translate 0.3s, display 0.3s allow-discrete;
  opacity: 1;
}
nav[data-vd-show][hidden] {          /* leaving: transition runs, THEN display flips */
  display: none; opacity: 0; translate: 0 -8px;
}
@starting-style {                     /* entering: the frame it appears from */
  nav[data-vd-show] { opacity: 0; translate: 0 -8px; }
}
```

`transition-behavior: allow-discrete` lets `display` participate in the transition (it flips at
the end when leaving, at the start when entering), and `@starting-style` gives an appearing
element a first frame to transition from. Engines without them show and hide instantly — the
designed page.

## The packs

- **`expressions`** — the value tier. Without it a value is a literal or a state path; with it,
  arithmetic, comparisons, ternaries and a small allowlist of calls.
- **`interaction`** — `state`, the `on-*` event family, `show`, `class`, `style`, `bind-*`, `sync`,
  `text`, `every`, `watch`, `focus-*`, `scroll-*`, `persist`, `copy`, `doc-class`, `init`.
- **`query`** — `route` publishes `@route`; `query` binds state keys to the URL's query string;
  `list` filters, sorts, facets, ranges and pages the elements already inside it and publishes its counts back into state.
- **`sensors`** — `in-view`, `size`, `pointer`, `scroll-progress`, `swipe`. Every one degrades to
  a readable page when the capability is missing.
- **`remote`** — `data-vd-fetch` and `data-vd-stream`. The stream is fetch's law at push
  cadence: a live connection opened at activation (`http(s)` URL → server-sent events, with the
  platform's own reconnect; `ws(s)` → WebSocket, with this pack's capped-backoff reconnect —
  the one reconnect loop in the framework), each pushed JSON message a state patch, anything
  else markup swapped into `into`. Connections are SHARED per URL — five live regions on one
  feed hold one wire. `status` reports `connecting/open/error`; `event: 'score'` names SSE
  events; on a socket, `send: 'outbox'` makes writes to that key transmit (queued until open,
  wire-form-deduped, and a pre-seeded outbox never sends — establishment answers no one).
  For `data-vd-fetch`: a JSON response patches state; a markup response swaps a region,
  same-origin only, always. `place: 'append'` or `'prepend'` accumulates instead of replacing —
  existing content is parsed around, never rewritten, so its state and handlers survive; infinite
  scroll is `on` an in-view event + `place: 'append'` + a page key, three existing pieces
  composing — but keep the feed's DEPTH out of `data-vd-query`: an accumulating view's middle
  pages are DOM, not URL, so a shared link would open with holes. A feed shares a POSITION — an
  item fragment (`#id`), or a server cursor the establishment request can start from — and the
  engine warns about the depth-in-URL pun in development. `animate: true` sends the swap through
  the same flip door as `list`:
  the region morphs old-to-new via `startViewTransition` — the leave animation removed content
  never had — and degrades to the instant swap wherever the door refuses (`on: 'load'` is
  establishment and never animates; no support and reduced-motion fall through).
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
