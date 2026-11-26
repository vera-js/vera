---
'@verajs/ssr': patch
---

Inside SVG or MathML, a component after a stray end tag is rendered again where the browser upgrades it. After an end tag that closes nothing the template opened, a breakout tag (`<p>`, `<b>`, `<font color>`…) reaches HTML whichever way the browser read that tag, and an end tag of a raw-text or void element (`</style>`, `</img>`…) is ignored and keeps the namespace known; 0.3.9 read both as unknown and left `<math></style><p><x-kid>` unrendered. A `<script>` inside `<noscript>` markup now holds until its own `</script>`, as a parser with scripting off reads it, so a hole after a `</noscript>` inside it is refused.
