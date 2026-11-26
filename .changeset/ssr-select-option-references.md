---
'@verajs/ssr': patch
---

A bound `<select>`'s option value decodes `&nbsp;` and every reference the page decodes. The server read its options
with a decoder of its own that knew five names, so `<option value="a&nbsp;b">` never matched `.value="a b"` and
the page was served with nothing selected, where a browser selects that option. Options are now read with the decoder
the rest of the server DOM uses: an option's `value` as an attribute value, its text as text.
