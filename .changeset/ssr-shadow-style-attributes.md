---
'@verajs/ssr': patch
---

A `<style>` a component appends to its own shadow root is served with its attributes: `media="print"` was dropped, so
print-only CSS applied on screen, and `nonce` was dropped, so a nonce-based Content-Security-Policy blocked the style.
A style with no attributes is served as before.
