---
'@verajs/core': patch
---

Creating and removing light-DOM components is up to 6% faster: core marks its own components with a field, not a WeakSet

**Performance:** core recorded every component it initialized in a WeakSet keyed by the element, and its
`customElements.define` wrapper asked that set on every connect and disconnect. A weak collection keyed by DOM nodes
costs both engines' garbage collectors for every entry, so the mark is now a field on the element under a `Symbol`
private to each copy of core — two copies of core on one page still each know only their own components. Measured on
light-DOM components with a fresh browser per page: creation 5–6% faster in Chrome and Firefox, churn 5% faster in
Chrome and even in Firefox.
