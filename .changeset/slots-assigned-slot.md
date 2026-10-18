---
'@verajs/renderer': patch
---

`node.assignedSlot` now answers light-DOM slots, as it does shadow ones

**Behavior:** a light child of a light-DOM component used to read `assignedSlot` as `null`, because the platform's
getter knows only shadow roots. slots now replaces that getter once per window, at the window's first light host. It
answers for the nodes slots placed, from what distribution already records, so nothing is written per node, and it
defers to the getter it replaced for every other node. So shadow-DOM nodes, another copy of Vera on the page, and other
code that patched the getter answer as before. Measured with the getter installed mid-session on a warm page, in
Chromium, Firefox and WebKit: no measurable cost to code that never reads it, and none to a page that reads it on every
element. A node created in another window and placed into a light host here reads `null` unless its own window also
has a light host.
