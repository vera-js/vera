# @verajs/styles

Styles for VeraJS components (<!--size:styles.gzip-->875 B<!--/size:styles.gzip--> gzip): the `css` tag, and
`static styles` adopted into every component as it comes to life — constructed stylesheets in a shadow
root, `@scope`-wrapped hoisting for light DOM, in whatever window the component lives in.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';

wire([renderer, styles]);
```

Once, at your app entry, alongside the renderer. From then on every component's `init()` adopts its
class's `static styles`. Forget the wiring and a component with `static styles` renders unstyled —
development says so, once.

## Writing styles

```js
import { init, render, html } from '@verajs/core';
import { css } from '@verajs/styles';

class Card extends HTMLElement {
  static styles = css`
    :host { display: block; padding: 1rem; }
    h2 { margin: 0; }
  `;
  connectedCallback() {
    init(this, { mode: 'open' });                 // or init(this) for light DOM — the same sheet works
    render(() => html`<h2>Title</h2><slot></slot>`);
  }
}
customElements.define('x-card', Card);
```

`css` returns `{ styleSheet, cssText }`: a constructed sheet for the engines that adopt one, and its
text for everything that cannot (a `<style>` element, a server render, jsdom). Interpolated values are
joined as text — `0` stays `0`, and `''` or `undefined` add nothing.

`static styles` takes one `css` result, a string of CSS, or an array of either. A falsy member is
skipped, so conditional styles read naturally: `static styles = [base, compact && compactSheet]`.

## Shadow DOM

Constructed sheets are adopted by the shadow root, which scopes them. Plain strings become one
`<style data-vm-sheet="styles">` in the root. Re-`init` is safe: a component reconnecting reuses that
element rather than adding another, and when every style is an adopted sheet, the copy a server render
wrote (markup cannot carry a constructed sheet, so `@verajs/ssr` serializes one as a `<style>`) is
removed, so the rules are not applied twice.

A **closed** shadow root is styled too — `element.shadowRoot` is null for one, so the root `init()`
created is used.

## Light DOM — one stylesheet for both modes

With no shadow root, styles are **hoisted to the document once per component class**, wrapped in
`@scope (tag-name) { … }` so they apply only inside that component's subtree — scoping without a shadow
root, done by the platform. A `<style>` inside the element would be wiped by the first render; hoisting
survives renders.

**`:host` works in light DOM.** Inside that `@scope` block the scoping root is the element, so `:host`
is translated to `:scope` and `:host(.a)` to `:scope.a`. The same sheet styles the element in both
modes — which matters most for a component you installed rather than wrote, since it will use `:host`
and cannot know how you render it. Only selectors are translated: a `:host` in a value
(`content: ":host"`, `url(/x/:host.png)`) and an escaped identifier (`.md\:host`) are left as written.

**`::slotted()` has no light-DOM equivalent**, and cannot: slotted nodes are ordinary descendants there,
and matching "assigned to this slot" would mean marking your own markup. Page CSS already reaches them,
so an ordinary descendant selector does the job. Development says so if a light component's sheet uses
`::slotted()`. `:host-context()` is not translated — Firefox and WebKit never shipped it.

**On an engine with no `@scope`** (Safari before 17.4, Firefox before 128) the block is hoisted
**unscoped** rather than dropped — dropped would leave the component unstyled — so its rules apply
page-wide on that engine. Development says so, once. Attach a shadow root, or write selectors that carry
the tag, to scope them everywhere.

A subclass hoists its own copy for its own tag (it inherits the base's CSS, but `@scope (base-tag)`
does not match it), and two copies of this package on one page hoist a class once, not twice.

## Popped-out windows and iframes

A component works in whatever window its element is in. Styles go into **the element's own
document**, built with **that window's** stylesheet constructor; a component moved into a popped-out
window or an iframe is hoisted there too (per class, per document). A constructed sheet can only be
adopted by documents of its own window — the engine refuses — so a `css` sheet created in the opener
reaches a shadow root in another window as a `<style>` element instead. Verified on real engines in
`tests/browser/styles-realm.test.js`.

## Dynamic styles

`static styles` is adopted **once**: per element for shadow DOM, per class per document for light DOM.
Reassigning `MyComponent.styles` afterwards changes nothing, and the sheet is **shared by every
instance** — mutating it restyles all of them:

```js
a.shadowRoot.adoptedStyleSheets[0] === b.shadowRoot.adoptedStyleSheets[0]   // true
```

**What changes goes in custom properties**, which need no help from this package: `var()` resolves
against the element's inherited custom properties at computed-style time, re-resolves the moment one
changes, and custom properties inherit through the shadow boundary.

<!-- recipe -->
```js
import { init, createStore, render, html, wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { css, styles } from '@verajs/styles';

wire([renderer, styles]);

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

Clicking writes `state.accent`, which re-renders the binding, and the adopted sheet re-resolves
`var(--accent)`; the sheet itself is never touched. `el.style.setProperty('--accent', 'red')` and an
inherited value from an ancestor work the same way, on both paths. Verified in a real browser in
`tests/browser/styles-dynamic.test.js`.

## API

| Export | |
| --- | --- |
| `styles` | the module: `wire([renderer, styles])` |
| `css` | the tagged template — `{ styleSheet, cssText }` |
| `adoptStyles(element)` | what `styles` registers on `'init'`: adopts `element.constructor.styles` |
| `applyStyles(styles, element)` | the adoption step alone, for an element whose `init()` this package never sees |

`wire({ on: 'init', fn: adoptStyles, priority: 50 })` is the same registration as `styles`, written out
— for a priority other than the default 50.

**Take `wire` from `@verajs/core`, never from `@verajs/inserts`.** A production `.min.js` inlines the
registry into every bundle, so registering through your own copy writes to a map core never reads —
working in development and silently doing nothing in production.

**Security.** A `</style>` in CSS text is written as `<\/style>` wherever this package puts text into a
`<style>` element. No engine executes it from there, but the element's *serialization* would otherwise
carry a breakout into anything that re-parses the markup — a server round trip, a copied `innerHTML`.

Styles lived in `@verajs/core` until 0.2.0, and `css` until the lean-core rebuild; most apps do not use
`static styles`, and every app was paying for it.

## For AI assistants — and anyone who wants the whole API on one page

The repository root's [`llms.txt`](../../llms.txt) is the complete, hand-maintained API
reference for every package, written to be pasted into a model's context window: full export
tables, the buildless CDN and JSX recipes, semantics that differ from other frameworks, and the
mistakes that come up most. Its recipes are executed by the test suite, so they stay honest.
