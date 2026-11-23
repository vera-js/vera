---
'@verajs/renderer': patch
---

Development's tag-shape check reads a slash an unquoted attribute value takes as part of the value, as HTML does:
`<svg class=a/>` stays open, so a binding beside an element in its `<title>` is refused as it is in any open `<svg>`,
and `<div class=a/>` is no longer warned as a self-closed `<div />`. A quoted value, a bare name or a binding before the
slash still self-closes. Production is unchanged.
