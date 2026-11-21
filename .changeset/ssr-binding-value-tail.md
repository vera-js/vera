---
'@verajs/ssr': patch
---

A sigil or event binding with static text beside its hole (`<a @click=${fn}x>`, `<a onClick="${fn}x">`) is served as
the client renders it: the whole attribute goes, static text included. The server dropped the name and the hole but
left the text, glued to the tag, so `<a onClick=${fn}x>` was served as `<ax>`, and a `<textarea>` carrying one became
an element that is not a textarea, its content parsed as markup.
