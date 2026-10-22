# @verajs/hot

Redefine a component during development, and the live elements on the page run the new code. The element stays where
it is, with its attributes, its children, its focus and every reference to it. The old setup's cleanups run exactly
once, and the new setup runs.

> **Development only, and private while the API settles.** Production carries nothing of it. Core's one check for it
> sits in its development branch, so it is not counted in an app's size.

```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { hot } from '@verajs/hot';

wire([renderer, hot]); // FIRST in the entry, before any component module defines a tag
```

After that, defining a tag again does not throw. `define('x-card', …)` or `customElements.define('x-card', …)` swaps
the live `<x-card>` elements to the new version in place. Studio's editor and a Vite plugin (`import.meta.hot`) are
callers of the same thing.

## What a swap keeps

| | |
| --- | --- |
| The element | Its place in the page, its attributes, its children, its focus, and every reference to it, including the parent template's bindings |
| Stores at module scope | Untouched |
| Props | Their values. Code outside the component that reads them stays subscribed, unless the new version declares a different set of props; then it subscribes again on its next run |
| What the setup created | Not kept: the setup runs again |

What changes in place: the setup, `methods`, declared props (a newly declared prop gets its default), the class's
`connectedCallback`, `disconnectedCallback` and `attributeChangedCallback`, and `foreignNodes`.

## What a live element cannot take

These need a new element, which a live page cannot provide without breaking its bindings, so hot requests a
**reload**:

- a change of shadow-root mode, since a root cannot be detached;
- `formAssociated` or `disabledFeatures`, which the platform fixes per tag.

The request is a cancelable `vera-hot-reload` event on the element's window, with `detail: { tag, reason }`.
Uncanceled, that window reloads. A preview frame can cancel it and reload only itself.

A class component's constructor or class fields apply to new elements only, because an existing element is never
constructed again. Reload to apply them to live ones.

## Attributes

The platform fixes a tag's `observedAttributes` at its first definition. If a new version stops observing a name, the
name is filtered out. If it starts observing one, each element is watched for it with a `MutationObserver`, and the
name's current value is replayed once. Those deliveries are asynchronous, where the platform's own are synchronous,
until a reload.

## Rules

- **Wire it first, through `wire`.** hot has to sit outside core's own `customElements.define` wrapper. It checks that
  when wired and refuses with `hot-no-core` otherwise. A tag defined before hot was wired keeps its real class, and
  redefining it throws `hot-defined-first`.
- **Construct by tag or by the class `define` returns.** After a redefine, `define` still returns the registered class,
  so `new XCard()` and `instanceof` keep working.
- **Wiring it twice is harmless.** A second copy, or the module reloading itself, does nothing.
