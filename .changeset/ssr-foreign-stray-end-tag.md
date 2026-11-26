---
'@verajs/ssr': patch
---

Fixes an injection on a server-rendered page: inside SVG or MathML, an end tag that closes nothing the template opened
(`<math></div>`) can close an element outside the template, such as the page's `<div id="host">`, taking the `<math>`
with it, so what follows is HTML. The server read it as ignored and stayed in MathML, so in
`<math></div><script><b><style>${value}` it took the `<script>` as a MathML element, let the `<b>` break out, and wrote
the value raw, where the browser was inside the script's raw text and a value's `</script>` ended it. Such an end tag
now makes the namespace unknown, as one at an integration point already did, so what follows is escaped or refused
for both readings. Every SVG and MathML element a template opens is tracked for this, so a matched `</g>` keeps the
namespace known, and an SVG element a template leaves open is closed at its end (`<svg><g>` ends `</g></svg>`).
