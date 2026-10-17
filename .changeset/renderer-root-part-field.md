---
'@verajs/renderer': patch
---

Creating and removing components is faster in every engine: a root's part is kept on the root, not in a WeakMap

**Performance:** the renderer found each root's part — a component's root, or any container handed to `renderInto` —
through a WeakMap keyed by the DOM node, and both engines' garbage collectors paid for every entry on creation and
removal. The part is now a field on its root, under a `Symbol` private to each copy of the renderer (two copies on one
page still never see each other's parts), and a removed root's part lets go of the root, so Firefox's cycle collector
has nothing to break. Measured on shadow components with a fresh browser per page: creation and churn about 11% faster
in Firefox and 9% faster in Chrome, and about 16–17% together with component roots owning their content.
