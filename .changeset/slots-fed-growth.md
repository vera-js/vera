---
'@verajs/renderer': patch
---

Template-rendered lists of light-DOM slotted components are about twice as fast to create and churn

**Performance:** slots recorded every slotted component a template created, so it could distribute their content at
the end of that template's render, and kept each record until the browser's garbage collector freed the component. A
list of slotted cards that kept changing therefore re-read a growing record on every render. A component that left the
page is now dropped at its root's next render. Measured with a fresh browser per page, a template-rendered list of
slotted components: Firefox 56% faster to create and to churn, Chrome 51%.

**Behavior:** a slotted component you remove by hand and put back follows the rule for any hand edit to a light host:
what its outer template then writes into it is distributed a microtask later, by the component's own observer. The
slots API reads it at once.
