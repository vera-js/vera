---
'@verajs/renderer': minor
---

Light slots' carrier is `<ins hidden data-vm-unassigned>`, no longer `<vm-unassigned hidden>`

Content no slot takes still waits connected and unrendered in the host's first child — only that child's element
changed. `<vm-unassigned>` was a dashed name nothing ever defined, so it matched `:not(:defined)` for good: a
discovery-based loader (`@verajs/autoloader` included) tried to import `vm-unassigned.js`, and a "wait until every
element is defined" check never finished. `<ins>` is a standard element — defined, valid HTML around any content, and
safe inside a `<p>`, where a `<div>` would close the paragraph.

**Breaking for a selector that names the old element:** write `[data-vm-unassigned]` where you wrote `vm-unassigned` —
`:scope > :not([data-vm-unassigned])` to skip it among a host's children.
