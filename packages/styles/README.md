# @verajs/styles

`static styles` for VeraJS components (<!--size:styles.gzip-->597 B<!--/size:styles.gzip--> gzip): constructed stylesheets into shadow
roots, and `@scope`-wrapped hoisting for light DOM.

<!-- recipe -->
```js
import { insert } from '@verajs/core';
import { adoptStyles } from '@verajs/styles';

insert('init', adoptStyles, 50);
```

Once, at your app entry, next to `setRenderer`. Every component `init()` adopts its `static styles`
from that point on.

`insert` comes from **`@verajs/core`**, not from `@verajs/inserts`. A production `.min.js` inlines
the registry into every bundle, so registering through your own copy would write to a map core never
reads — working in development and silently doing nothing in production. Taking core's own `insert`
removes the question. Forget the wiring and core says so, once, in development.

**Shadow DOM** — constructed sheets go to `shadowRoot.adoptedStyleSheets`; plain strings become a
`<style vera-styles>` in the shadow root. Both are naturally scoped and safe to re-`init`.

**Light DOM** — styles are hoisted to the document once per component class, wrapped in
`@scope (tag-name) { … }` so they apply only inside that component's subtree: scoping without a
shadow root, done by the platform. Hoisting also survives renders, since a `<style>` inside the
element would be wiped by the first render pass.

## Dynamic styles

A sheet is adopted **once** and never re-read. `adoptStyles` runs on the `init` insert — once per
element for shadow DOM, and once per component *class ever* for light DOM. Reassigning
`MyComponent.styles` afterwards changes nothing.

The sheet is also **shared by every instance**, because `static styles` is a static member:

```js
a.shadowRoot.adoptedStyleSheets[0] === b.shadowRoot.adoptedStyleSheets[0]   // true
```

That is what makes constructed sheets cheap — one object, adopted by every instance, parsed once —
and it is why the sheet is the wrong place to put anything that varies. Mutating it to restyle one
component restyles all of them.

**Custom properties are the seam**, and they work with no help from this package. `var()` resolves
against the element's inherited custom properties at computed-style time, not when the sheet was
adopted, so it re-resolves the moment one changes — and custom properties inherit *through* the
shadow boundary:

<!-- recipe -->
```js
import { init, createStore, render, setRenderer, css, html, insert } from '@verajs/core';
import { render as domRender } from '@verajs/renderer';
import { adoptStyles } from '@verajs/styles';

setRenderer(domRender);
insert('init', adoptStyles, 50);

customElements.define(
  'x-tinted',
  class extends HTMLElement {
    static styles = css`p { color: var(--accent, blue); }`;

    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ accent: 'blue' });
      render(
        () => html`
          <div style="--accent: ${state.accent}">
            <p>tinted</p>
            <button @click=${() => (state.accent = 'red')}>Redden</button>
          </div>
        `
      );
    }
  }
);

document.body.append(document.createElement('x-tinted'));
```

Clicking the button writes `state.accent`, which re-renders the binding; the adopted sheet
re-resolves `var(--accent)` against the new value. The sheet itself was never touched.

Setting the property on the host works too, from anywhere — `el.style.setProperty('--accent', 'red')`
— as does inheriting it from an ancestor, and both apply equally to the light-DOM `@scope` path.

So `static styles` is deliberately not reactive: it carries the structure, custom properties carry
what changes. Verified against a real browser in `tests/browser/styles-dynamic.test.js`.

`applyStyles(styles, element)` is exported for manual use.

This lived in `@verajs/core` until 0.2.0. It moved because most apps do not use `static styles` and
every app was paying for it. If a component declares `static styles` with this package absent, core
warns once in development.
