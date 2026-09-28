---
'@verajs/renderer': patch
---

Development names an event binding that is a keystroke or two from a real event

`@clik` — or `onClik` in JSX, which compiles to it — listened for an event that never fires, and
nothing said so. Development now warns once, where it is bound: *"@clik on <button> is not an event
<button> fires — did you mean @click?"*. Only names within two edits of an event the element really
has are named; real events, custom events and names that extend a real one (`changed`, `loaded`) are
left alone. Production carries neither the check nor the text.
