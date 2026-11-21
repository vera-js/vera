# @verajs/lite

VeraJS's small tier: `define`, `signal` and the `html`, `svg` and `mathml` tags, with a renderer built in and nothing to
wire.

| Package | gzipped | A render | For |
| --- | ---: | --- | --- |
| `@verajs/lite` | <!--size:lite.gzip-->4.17 KB<!--/size:lite.gzip--> | patches the values that changed, in place | small sites |
| `@verajs/core` + `@verajs/renderer` | <!--size:core.gzip-->8.11 KB<!--/size:core.gzip--> + <!--size:renderer.gzip-->6.26 KB<!--/size:renderer.gzip--> | patches in place, keyed lists, hydration | everything else |

<!-- recipe -->
```js
import { define, html, signal } from '@verajs/lite';

const cart = signal([]);   // module-level: every component that reads it re-renders when it is replaced

define({ tag: 'add-to-cart', props: { item: 'tea' } }, (host) => () =>
  html`<button @click=${() => (cart.value = [...cart.value, host.item])}>Add ${host.item}</button>`);

define('cart-badge', () => () => html`<b>${cart.value.length} in the cart</b>`);

document.body.append(document.createElement('add-to-cart'), document.createElement('cart-badge'));
```

<!-- recipe -->
```js
import { define, html } from '@verajs/lite';

define({ tag: 'price-tag', attributes: ['amount', 'currency'] }, (host) => () =>
  html`<span class="price">${host.amount ?? '—'} ${host.currency ?? ''}</span>`);

const price = document.createElement('price-tag');
price.setAttribute('amount', '12.50');
price.setAttribute('currency', 'EUR');
document.body.append(price);
```

**It is reactive.** A write to a declared prop or an observed attribute, or to a `signal` a render read, re-renders
the component once, in a microtask, however many writes came first. A `signal` is the one store: shallow, read and
written as `.value`, as in `@verajs/core`.

**A render patches in place**, so focus, the caret, typed input and child components survive it. Lite binds text,
attributes (whole or partial), `?bool`, `.prop`, `!live`, `@event` (or `onClick=${…}`, as in `@verajs/core`), nested
templates and arrays (unkeyed: items are reused by position). The text of a `<title>`, `<textarea>` or `<style>` takes a value as TEXT, and so does a JSON data
block (`<script type="application/json">`, any type ending in `json`) — a list there is its items' text, joined, and a
template is refused (`template-in-text`), as in `@verajs/core` and on the server; any other `<script>` refuses a value. Markup you
trust goes in through `.innerHTML=${markup}`, as in `@verajs/core`.

**SVG and MathML.** Markup inside an `<svg>` or `<math>` element is SVG or MathML already; a fragment rendered INTO one
from a template of its own is tagged `svg` or `mathml`, so the parser reads it in that namespace (as in `@verajs/core`).
An HTML element written in such a fragment breaks out of it, where the parser puts it, and is kept. Development names
an element placed where its namespace does not render, such as an `html`-tagged `<circle>` inside an `<svg>`
(`wrong-namespace`, `@verajs/core`'s words).

<!-- recipe -->
```js
import { define, html, svg } from '@verajs/lite';

const dot = (x, color) => svg`<circle cx=${x} cy="5" r="4" fill=${color}/>`;

define({ tag: 'dot-row', props: { colors: ['tomato', 'teal', 'gold'] } }, (host) => () =>
  html`<svg viewBox="0 0 30 10" width="90">${host.colors.map((color, i) => dot(5 + i * 10, color))}</svg>`);

document.body.append(document.createElement('dot-row'));
```

**The HTML parser judges every template, once.** A hole the parser would move or drop (a `<div>` inside `<select>`, a
duplicate attribute, a hole inside a comment, `<noscript>`, `<iframe>` or `<template>`) is refused
(`tier-hole-position`), and so is a template that ends inside a tag (`unfinished-tag`). An `<iframe>` is set through its attributes (`src`, `title`), which work here; a `<noscript>` shows only with scripting off, when this tier never runs, so it belongs in the served page (or `@verajs/ssr`). A binding's name is checked
against the parser's, which lowercases only ASCII, so a `.prop` or event name with a non-ASCII capital letter is refused
(`@verajs/core` binds it).

**What only `@verajs/core` has:** `createStore`, `computed`, `effect`, `keyed` lists, `spread`, refs, light-DOM slots,
hydration and an async setup. Importing one from lite fails when the module loads;
development names an option or a value only `@verajs/core` handles (`tier-needs-core`). An object shaped like a template
that is not one — data from `JSON.parse`, or a `{ strings, values }` wrapper core's `hold` and `tag` build — renders as the
text `[object Object]` and is never converted (development says `forged-template` or `template-wrapper`; core renders such
a wrapper as its template).

**Values render as they do in core:** a list or any other iterable (a `Set`, a `Map`) as its items, a property bound to
`undefined` gets `undefined` (the platform's setter writes it as the text "undefined" in a field, as core does), and
development says core's warnings in core's words — a boolean child that renders as a word (`boolean-child`), an attribute
value that is not text (`attribute-value`), a handler that cannot listen (`not-a-listener`), a misspelled event
(`event-name-typo`). Production carries none of the warnings. One known difference, in the DOM's shape only: a hole that
is its element's only content and went from a list to text to `null` ends holding only lite's position marker (a comment)
where a fresh render holds an empty text node — the same text and the same rendering, a different node.

**Moving up.** A component written for lite runs on `@verajs/core`: add `@verajs/core` and `@verajs/renderer`, change
the import, and `wire([renderer])`. The refusals are the same in both: escaped text, no script URLs (in an attribute or
a property), no bound inline handlers.

**Server rendering** (`@verajs/ssr`) renders lite components. Lite does not hydrate: on the client, a component's first
render replaces what the server sent (hydration is `@verajs/core`'s). The page looks the same throughout (measured on
Chromium, Firefox and WebKit: the same DOM, no frame painted empty, no layout shift), but **what a visitor did before
lite's module ran is lost**: typed text and focus, a ticked checkbox, a chosen `<select>` option, an opened `<details>`,
a scrolled container. Load lite's module early (a module script in the `<head>`, before the content), and serve
`@verajs/core` for pages whose forms people use before the scripts finish. **On the server, keep HTML out of SVG and
MathML content** (put it in a `<foreignObject>` or an `<mtext>`): a browser moves an HTML element written inside an
`<svg>` out of it, which the server's DOM does not reproduce, so a template with a hole in such a subtree is refused
there (`tier-hole-position`). **Speed:** lite is built to be small; on large
lists, `@verajs/core` with `@verajs/renderer` updates faster. **JSX** compiles for lite with
`veraJsx({ html: ['html', '@verajs/lite'], namespaces: false })`; `key` and `{...spread}` need `@verajs/core`.
