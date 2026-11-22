---
'@verajs/ssr': patch
---

A value bound inside what looks like a comment in a text element the server cannot place for certain (a `<style>`,
`<textarea>`, `<title>` and the like after an end tag the browser may ignore at an SVG or MathML integration point, or in
`<noscript>`/`<select>` markup) is now served as escaped text instead of dropped. In those places the browser reads the
element's text, not a comment, and the client renderer writes the value there, so the server left out a value the
client shows. An ordinary comment still drops its value, as the client does, and a template in such a place is refused
as in any text-only element.
