---
'@verajs/ssr': patch
---

A value in an executable `<script>` could be served as code. The script-hole check arrived in 0.3.1 (0.3.0 refused no
script hole at all), and this closes a gap in it. The server judged a hole in a `<script>` by the first script its
static opened, and kept judging by that tag after a later static closed that script and opened another. So in
`<script type="application/json">{}</script><script>${x}</script>` it took the hole in the second, executable script for
JSON: it wrote the value there with every `<` escaped as `\u003c`, which stops a breakout but not the value itself
running as script, where it should have been refused (`ssr-script-hole`). A hole is now judged by the start tag of the
script it is in. A JSON data block that follows a code script in one static is now accepted, as the client already
accepted it.
