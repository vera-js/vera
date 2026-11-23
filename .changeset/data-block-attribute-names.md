---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

The JSON data-block check reads attribute names as the HTML parser does: a quote or a leading `=` is part of a name, so
`<script x"type="application/json">` has no `type`, is code, and a hole in it is refused (`script-hole`,
`ssr-script-hole`), on the client and the server alike.
