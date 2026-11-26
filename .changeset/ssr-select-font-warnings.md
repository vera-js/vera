---
'@verajs/ssr': patch
---

Two places where the served page cannot match the client now say so, once per template and never per render. A bound
`<select>` value or `selectedIndex` that matches no option (`ssr-select-no-match`): the client shows nothing selected,
while a served select with no `selected` option shows its first, and markup has no way to say "none". The line names the
binding and the option count, never the value, which is often a user's own input. A bound `color`, `face` or `size` on
a `<font>` inside `<svg>` or `<math>` (`ssr-font-in-foreign`): the client builds that `<font>` as SVG, while the
browser's parse of the served page leaves the `<svg>` at it. Nothing served changes.
