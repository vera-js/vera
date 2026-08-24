---
'@verajs/ssr': patch
---

A stylesheet keeps the characters CSS needs.

`@verajs/styles` sets a `<style>` element's `textContent` to the stylesheet, and the shim's setter
escaped it like any other text — so `>` became `&#62;` and `"` became `&#34;`. A browser does not
decode character references inside `<style>`, so a component with a string `static styles` shipped a
stylesheet with every child selector, attribute selector and `content: "…"` broken. The client never
had it: there, `textContent` sets real text and a raw-text element serializes it verbatim.

What a stylesheet does need — `</style` neutralised — is a different escape and was already applied.
