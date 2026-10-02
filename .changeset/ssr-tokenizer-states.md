---
'@verajs/ssr': patch
---

Security: the server reads a tag where the browser's tokenizer does, so `<script.x>${text}` no longer serves `text` raw

The server decides how to write a value (escaped text, an attribute, or raw `<style>`/`<script>` content) by
scanning the template's markup, and that scan approximated the HTML tokenizer. In 0.2.1 it ended a tag name at the
first character outside `[a-zA-Z0-9-]`, so `html`<script.x>${text}</script.x>`` and `<style:x>` read as a
`<script>`/`<style>` and served `text` unescaped inside what the browser parses as an unknown element. A value
carrying `<img src=x onerror=…>` became a live element. A static unquoted value ending in `/` (`<svg a=x/>`) read as
a self-closing tag, so a `<style>` value after it was served raw inside what the browser parses as SVG. The scan
now follows the tokenizer's own states: a tag name runs to whitespace, `/` or `>`; a `<` before anything but a
letter is text; `<!x>`, `<?x>` and `</ x>` are comments; an `=` or a quote inside a name is part of the name;
only the tokenizer's whitespace separates; `<style/>` opens raw text as `<style>` does; and `</scripts` ends nothing.

`.innerHTML`'s inertness scan, which made a trusted value's `<script>`s and `<template shadowrootmode>`s inert, ran
a separate scanner, and it served both live in `<b x"><script>` (it read the quote as opening a value) and in
`<svg><style><script>` (it skipped the SVG `<style>`'s content as raw text). It now uses the same scan, so the two
cannot disagree. An unfinished tag at the end of such a value is dropped, as an `innerHTML` assignment drops it,
instead of swallowing the page after it. Both scans got faster (see the SSR performance entry).
