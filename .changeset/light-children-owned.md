---
'@vera-components/field': patch
'@vera-components/icon': patch
'@vera-components/input': patch
---

On a page that wires `@verajs/renderer/slots` (for another component's light-DOM slots), `<vera-field>`, `<vera-icon>`
and `<vera-input>` showed nothing: their children, the label and control, the `<svg>`, the `<input>` you wrote, were
moved into the hidden holder slots keeps for content no `<slot>` takes. Each now declares that its children are its own
(`ownsChildren`), so slots leaves them where you wrote them.
