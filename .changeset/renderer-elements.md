---
'@verajs/renderer': patch
'@verajs/inserts': patch
---

`@verajs/renderer/elements`: attach behavior to elements in templates

A new wired module. A claimant is an ordinary `'element'` insert, asked about each element of a
template once — its tag and static attributes — and answering with a shared `{ mount?, unmount? }` or
`undefined`. Every instance of the template runs `mount(element, { root, adopted })` once the render
that created it has finished, with the tree in place, and `unmount(kept, element)` at teardown with
what `mount` returned. `hold()` is not teardown; several claimants may claim one element. An app that
wires no claimant pays nothing.

```js
const autofocus = { mount: (element) => element.focus() };
wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('autofocus') ? autofocus : undefined), priority: 50 }]);
```

That example is a real platform gap: on Chromium, Firefox and WebKit only the first `autofocus`
rendered after page load takes focus, so every later form an app shows ignores it.

**`@verajs/renderer`:** an instance hook's `$m` now runs once the render that created the instance has
finished, rather than straight after its first update, when the instance was still in a detached
fragment. An instance torn down before its render ends never gets `$m`.

**`@verajs/inserts`:** declares the `'element'` insert point.
