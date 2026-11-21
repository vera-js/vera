---
'@verajs/core': patch
---

`define({ tag, register: false }, setup)` builds the component class and returns it without registering it, so the
caller decides when and under which name it is defined; `customElements.get(tag)` stays `undefined` until then.
