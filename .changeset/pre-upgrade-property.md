---
'@verajs/renderer': patch
---

Report, in development, when a class field destroys a `.prop=${…}` binding at upgrade.

A property set on a custom element that has not upgraded yet lands as an own property on the
instance. When the definition arrives — lazily imported, code-split, or a module that simply had
not run — `customElements.define` upgrades synchronously and the class's field initializers
execute. At target ES2022, where `useDefineForClassFields` is on, a field declaration is a
`[[Define]]`: `item?: Thing` emits `item;`, i.e.
`Object.defineProperty(this, 'item', { value: undefined })`. The bound value is gone before the
component reads it, nothing throws, and it reads as broken reactivity.

Detection rather than repair, deliberately. Repairing it — re-applying the value once the
definition existed — covered `item?: Thing` but not `item = someDefault`, which overwrites with the
default and so never looks clobbered. That made one mistake behave two different ways depending on
spelling, which is worse to diagnose than a consistent failure. It also cost 74 B in every app
while leaving `declare` mandatory regardless, since a property assigned imperatively cannot be
recovered by anyone: the renderer never saw it, and by the time `init()` runs the value is already
gone.

The check is `__DEV__`-only, so production carries no `whenDefined` subscription, no comparison and
no message — `vera-renderer.min.js` is unchanged at 3 623 B gzipped, verified by asserting both the
subscription and the message string are absent from the bundle.

Write custom-element fields as `declare item?: Thing`, which emits nothing. An eslint rule and an
`llms.txt` section now cover this too. Lit reached the same conclusion from the other direction —
for them a class field permanently shadows the prototype accessor, so the property never updates
again, and their development build throws (`lit.dev/msg/class-field-shadowing`).
