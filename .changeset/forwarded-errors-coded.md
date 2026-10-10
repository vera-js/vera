---
'@verajs/core': patch
'@verajs/renderer': patch
---

The line printed beside an error your own code threw now carries a code

When a hook, a hook's cleanup, an element ref or an element claim throws and no `'error'` insert is wired, the error
is reported the platform's way (`reportError`), and — in development, or wherever the platform has no `reportError`, as
in Node — printed with a line of ours beside it. That line was the one message without a code. It now has one:
production prints `[vera] hook-threw`, `[vera] cleanup-threw`, `[vera] ref-threw` or `[vera] claim-threw`, and
development the full sentence ending in that code, so every line the framework prints carries a code. The bare codes
are shorter than the words they replace: `vera.min.js` is 7 B smaller and `vera-renderer.min.js` 2 B.
