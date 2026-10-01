---
'@verajs/ssr': patch
---

Security: a value inside `<svg><style>` (and every other place the browser does not read raw text) is escaped

The server writes a `<style>` or `<script>` value raw, neutralizing only that element's end tag, which is right only
where the browser reads the element as raw text. In 0.2.1 it decided that by the tag's name alone, so
`html`<svg><style>${text}</style></svg>`` served `text` unescaped inside an SVG `<style>` — whose content is markup —
and a value carrying `<img src=x onerror=…>` became a live element. The same held inside `<math>`, in an
`svg`/`mathml` template, in any template rendered into a foreign position, inside `<noscript>` (markup with
scripting off) and inside `<xmp>`, `<noembed>`, `<noframes>` and `<plaintext>`, where `</xmp>` in a value closed the
text the server thought it was in. Raw text is now recognized only in HTML; everywhere else every value is escaped.
A `<noscript>` link is URL-checked like any other.

The cost is the safe direction of the same misreading: a `<style>` the server cannot place in HTML (inside
`<foreignObject>`, or after a tag that breaks out of SVG) is served escaped, so a `>` in it reads as `&#62;` until
hydration. The SSR README lists it under what cannot round-trip.
