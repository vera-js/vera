---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A value in a `<style>` or a JSON data block stays text after the page is saved from the DOM and parsed again. A
browser writes such an element's text verbatim, so a value holding `</style><img onerror=…>` was inert on the live page
and became markup once the page was saved (an editor's publish, `outerHTML`) and served again. The renderer and the
server now write the same bytes: the element's statics and values composed together (a closer can form across a hole),
a data block's every `<` as `\u003c` and a style's every `</style` as `<\/style` — the same JSON and the same CSS.
Hydration adopts a served text equal to that and rewrites one that differs (the hydration hand-off's protocol is now 2:
a renderer and a hydration from different releases decline cleanly). A value in a style or data block is text by one
rule on both sides: nothing for `null`/`undefined`, a list its items' text joined, a template refused
(`template-in-text`, `ssr-template-in-text`). A template placed in an HTML `<title>` or `<textarea>` still renders, and
development now says it is never shown there. The renderer's raw-text scan ends a `<style>` only at a real end tag
(`</stylex>` had ended it early and lost the binding). On the server, a style hole no longer re-reads the whole document
written so far.
