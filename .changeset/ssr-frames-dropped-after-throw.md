---
'@verajs/ssr': patch
---

A frame a component requested before its `connectedCallback` threw is dropped when that render ends, as the README
says leftover frames are. Frames drain after the callback returns, so this one never drained and ran inside the next
render instead: with that render's document (a title it wrote landed on the next page), and, when it threw, failing the
next render in that render's component's name.
