---
'@verajs/renderer': patch
---

Keep `.prop=${…}` bindings from being wiped when the target element upgrades.

A property set on a custom element that has not upgraded yet lands as an own property on the
instance. When its definition arrives, `customElements.define` upgrades synchronously and the
class's field initializers run — and under ES2022 class-field semantics a declared field compiles
to a `[[Define]]`. So a component written `item?: Thing` emits `item;`, i.e.
`Object.defineProperty(this, 'item', { value: undefined })`, and the bound value is gone before the
component ever reads it.

This is the autoloader's ordinary case, not an edge case: a parent renders
`<child-element .item=${store}>` and the child's module is fetched only afterwards, so the binding
always runs first. Reproduced end to end through the real renderer, and confirmed in Chromium — the
clobber is a platform behaviour, not a jsdom artifact.

The property is now re-applied once the definition exists, and only if the slot was actually
clobbered, so a component that assigns the property itself keeps what it chose. Already-defined
elements and plain built-ins never enter the path — the guard is one `indexOf('-')` and one
`customElements.get`.

Costs 74 B gzipped. A working app goes 5 600 B to 5 665 B, still below Lit and Preact + signals.

Development builds also warn when a restore happens, naming the property and pointing at `declare`.
Reaching the restore proves a class field clobbered a bound value, so there are no false positives.
The warning costs production nothing: `__DEV__` folds to `false` before terser, and the bundle is
byte-identical with and without it.

Writing the field as `declare item?: Thing` remains the rule and is still required for a property
assigned imperatively, which cannot be restored — the renderer never saw it. It is simply no longer
something every consumer must know before a binding will work. Lit reached the same conclusion from
the other direction: a class field permanently shadows their prototype accessors, and their
development build throws (`lit.dev/msg/class-field-shadowing`).
