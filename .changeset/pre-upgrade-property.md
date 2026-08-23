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

Writing the field as `declare item?: Thing` remains correct and is still needed for a property
assigned imperatively outside a template, but it is no longer something every consumer has to know
to use a binding.
