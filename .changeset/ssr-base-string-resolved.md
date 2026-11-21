---
'@verajs/ssr': patch
---

With `base`, a module URL given as a string (`./`, `../`, `/` or a scheme) is resolved before it is checked, as
`import()` resolves it, and the URL checked is the URL imported: a `../` or `%2e%2e` segment after the base was compared
as written, passed the check, and ran a module outside the base. A bare specifier with `base` is refused, as before.
