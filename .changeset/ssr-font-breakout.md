---
'@verajs/ssr': patch
---

Inside `<svg>` or `<math>`, a `<font>` with a static `color`, `face` or `size` attribute ends foreign content, as the
HTML parser reads it. The server now reads it the same way: a hole after it is served where the browser puts it (a
value after `<font color=x><style>` and a static `<!--` was dropped), and a registered component after it is rendered
on the server instead of only on the client. A bound one (`<font color=${c}>`) keeps the foreign reading for the
template's own holes, as the client's template parse does; the nested-component scan reads the served page, so it
renders a component after one, which the client leaves a foreign element.
