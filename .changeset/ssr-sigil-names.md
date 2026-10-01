---
'@verajs/ssr': patch
---

Sigil bindings whose name does not start with a letter are read as the client reads them

The server recognized `.prop`, `?bool`, `@event` and `!live` only when the name after the sigil began with
a letter. `<p ._private=${v}>`, `.$x`, `?_flag` and `!_live` were served as attributes with the sigil in
them, `@_tap=${handler}` printed the handler's source into the page, and `.__proto__` — refused on the
client — was served as an attribute. A sigil character inside a name (`data-x.y`) was also misread as a
sigil. The server now takes the client's rule: the sigil is the first character of the attribute name, and
the name after it is any attribute-name character.
