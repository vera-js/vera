---
'@verajs/ssr': patch
---

A sigil binding whose value holds statics or several holes is served as the client renders it. With a static before
its hole (`@click="x${fn}"`, `?hidden="x${v}"`, `.value="x${v}"`) the binding was served as a literal attribute: an
event binding wrote the handler's source into the page. A `?bool`, `.prop` or `!live` value with several holes took the
first hole alone; it is now the joined text, as on the client (`?hidden="${false} ${''}"` is truthy, `.value="${a}
${b}"` is `"a b"`). And a nullish value bound after a static attribute of the same name (`<a title=x title=${null}>`)
removes that attribute, as the client's `removeAttribute` does, as does a refused `javascript:` URL.
