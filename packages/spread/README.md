# @verajs/spread

Spread a props object onto an element in a VeraJS template, with names resolved at runtime.

```sh
npm i @verajs/spread
```

<!-- recipe -->
```js
import { init, createStore, render, setRenderer, html } from '@verajs/core';
import { render as domRender } from '@verajs/renderer';
import { spread } from '@verajs/spread';

setRenderer(domRender);

customElements.define(
  'x-field',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ disabled: false });
      const props = {
        id: 'email',                                  // attribute
        placeholder: 'you@example.com',               //   "
        '.value': '',                                 // property
        '?disabled': state.disabled,                  // boolean attribute
        onInput: (e) => console.log(e.target.value),  // event — @input works too
      };
      render(() => html`<input ${spread(props)} />`);
    }
  }
);

document.body.append(document.createElement('x-field'));
```

Keys carry the same sigils as written bindings — `.prop`, `?bool`, `@event`, React-style `onClick`,
or a plain attribute — so a spread key and a written binding mean the same thing.

## What it costs

`@verajs/renderer` grows **16 B** gzipped for the protocol this uses, whether or not you install
this package. This package is **<!--size:spread.gzip-->721 B<!--/size:spread.gzip-->** gzipped, and
only apps that import it pay for it.

Runtime is at parity with writing the bindings out: both do one comparison per binding per render,
and the spread does one part-dispatch where five written bindings do five.

## Why it is a separate package

Template renderers bake attribute names into the template at parse time. That is what makes them
small and fast, and it is why neither this renderer nor lit-html has had spread —
[lit's spread PR](https://github.com/lit/lit/pull/1960) has been an open draft since 2021.

`@verajs/renderer` holds only a protocol: a value at element position carrying `_$apply$` applies
itself. Everything else lives here, so a renderer that never spreads is 16 B heavier rather than
176 B. This package imports nothing — not even from the renderer — so it loads alongside any
renderer that honours the protocol, including your own.

## Removing a key

A key that disappears between renders **restores what the element held before the binding existed**.

```js
render(html`<input type="text" ${spread({ type: 'number' })} />`, host);  // type="number"
render(html`<input type="text" ${spread({})} />`, host);                  // type="text" again
```

Not removed — *restored*. The usual framing, "what value means absent", has no answer for a
property: assigning `undefined` runs through coercing setters, so dropping `.value` yields `""`
rather than reverting, and `delete` cannot remove a prototype accessor. Asked as "undo what this
binding did" it is well defined for every kind, and never invents a value you did not write.

A released event binding stops dispatching; the listener itself stays registered, which is how
written `@event` bindings behave too.

## Several spreads on one element

Supported. Each element position owns its own keys, so `<div ${spread(a)} ${spread(b)}>` works and
neither releases the other's bindings.

## Types

Keys are strings carrying sigils, so TypeScript cannot check them against the element's attributes
— this is a genuine step down from written bindings, and the trade for names that are not known
until runtime.

## License

MIT
