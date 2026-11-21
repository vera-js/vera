---
'@verajs/core': patch
---

`define({ tag, formAssociated: true }, setup)` makes a form-associated custom element: the class gets the platform's
`static formAssociated = true` before it is registered, so a form lists it and submits the value its internals set, and
its form callbacks (given as `methods`) are called.
