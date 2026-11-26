---
'@verajs/ssr': patch
---

A static attribute written after a binding of its own name is no longer served. The client's parse of the template keeps
the first attribute of a name, in any case and in SVG too, so in `<a title=${v} title=x>` the static is gone before any
value exists: the client has `title` from `v`, or none when `v` is `null`. The server wrote the static as well, and when
the binding wrote nothing (`null`, `undefined`, `?hidden=${false} hidden`) the browser kept it: `title="x"` served where
the client rendered none. The static is now dropped once per template, never per render. A static before the binding,
and a spread's keys, are unchanged.
