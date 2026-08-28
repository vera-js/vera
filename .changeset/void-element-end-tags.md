---
'@verajs/ssr': patch
---

A void element is serialised without an end tag

`appendChild(document.createElement('br'))` served `<br></br>`. A parser reads `</br>` as *another*
`<br>`, so the server rendered two line breaks where the client has one — and the same content
assigned as a markup string was already correct, so the two paths disagreed with each other as well
as with the browser. The same applied to `<img>`, `<input>`, `<hr>` and the rest.

`outerHTML` and `insertAdjacentElement` inlined the same expression and had the same bug; all three
now share one definition.
