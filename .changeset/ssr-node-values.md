---
'@verajs/ssr': patch
---

A DOM node at a child position no longer prints `[object …]` on the server and no longer costs adoption

A node handed to a template (`html\`<figure>${chart}</figure>\``) is inserted by the client as itself, and the server
cannot have rendered it. The server serialized it as `String(value)` instead — `[object EventTarget]` on the static
page — and the client then refused that text as markup the template does not describe, discarding the whole
container's server markup and re-rendering it (the `hydration-fallback` warning). The server now writes nothing for a
node, an element, a text node or a fragment alike, and hydration adopts everything around it.
