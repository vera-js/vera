---
'@verajs/router': patch
---

Active-link marking now works for relative hrefs. `href="hello"` was compared as written against a
path of `/hello` — two spellings of the same destination — so a nav bar built with relative links
never highlighted. Hrefs are resolved through `document.baseURI` first, the same source the
link-click handler uses, so a link is judged active by exactly the URL clicking it would reach. A
cross-origin href never matches, though its pathname could collide.
