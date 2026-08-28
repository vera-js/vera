---
'@verajs/ssr': patch
---

`before`, `after`, `replaceWith`, a fragment that empties, and an `outerHTML` setter

- **`before`, `after` and `replaceWith`** were out of scope for needing "the parent it has none of",
  which stopped being true when child nodes started being retained. All three work on elements, text
  and comments, and a plain string becomes a text node as the spec says.
- **A document fragment hands over its children and is left empty**, which is what a browser does and
  the entire point of the type. Its markup was inlined instead, so the fragment still reported the
  children it had supposedly given away.
- **`outerHTML` can be assigned.** It was a getter only, so `element.outerHTML = '<p>x</p>'` — an
  ordinary way to swap a node out — was a `TypeError` on the server and worked in the browser. With
  no parent it returns silently, which is what the spec says and what Chromium, Firefox and WebKit
  all do; the obvious guess of `NoModificationAllowedError` is wrong, as the spec raises that only
  when the parent is a *Document*.
