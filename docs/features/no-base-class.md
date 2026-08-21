# No base class

## The claim

**VeraJS attaches to a plain `HTMLElement`.** It does not require you to extend its class, which
means reactivity can be added to components you did not write.

## The evidence

```js
// VeraJS — a plain custom element
class Counter extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ count: 0 });
    render(() => html`<button @click=${() => state.count++}>${state.count}</button>`);
  }
}
```

```js
// Lit — you must extend LitElement
class Counter extends LitElement {
  static properties = { count: {} };
  constructor() { super(); this.count = 0; }
  render() { return html`<button @click=${() => this.count++}>${this.count}</button>`; }
}
```

Composition rather than inheritance. That is a structural difference, not a stylistic one.

## What it enables

- **Reactivity on an element that already extends something else** — a base class from a design
  system, a third-party component, a vendor's element.
- **Retrofitting components you do not control**, by calling `init()` in a subclass.
- **Incremental adoption** — one component at a time, no rewrite.
- **No change to the element's public surface.** It stays a standard custom element, so it works
  with any framework, or none.

## Against the field

| | Requires a base class |
| --- | --- |
| **VeraJS** | **no** — plain `HTMLElement` |
| Lit | yes — `extends LitElement` |
| React | n/a — not web components |
| Vue | n/a — not web components (Vue's `defineCustomElement` wraps) |
| Solid | n/a |
| Van.js | no, but not web-component-oriented |

Among web-component frameworks this is the clearest structural advantage VeraJS has over Lit, and
the one that survives every other comparison.

## Why it matters commercially

The strongest markets for VeraJS are ones where you are **adding to** an existing page rather than
owning it — design systems consumed by teams on other frameworks, embeddable widgets, Astro islands.
In all of those, "you must extend our class" is an adoption blocker and "reactivity attaches to what
you already have" is the pitch.

## Caveat

You call `init(this)` yourself in `connectedCallback`. Lit does that for you. That is one line of
ceremony traded for not owning your inheritance chain — worth stating plainly rather than pretending
there is no trade.
