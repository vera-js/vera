---
'@verajs/ssr': patch
---

A light-DOM component inside a served declarative shadow root gets its `@scope (tag)` block inside that root, once
per class per root and in every render (`seen` governs the page's styles only), so it is styled at first paint. Before,
every light block went to the page's `styles`, which a shadow root's content never sees, so such a component was
unstyled until hydration. The block is served as `<style data-vm-sheet="light">`, so the client can tell it from
the root's own styles. A light child slotted into a shadow host sits in the page's light DOM, so its block is still
the page's. On the server, `document.contains` now answers as browsers do for a node inside a shadow root (`false`).
