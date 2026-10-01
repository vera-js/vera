---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

An expression inside an attribute name is refused, with the spread that does what it meant

`<p data-${key}="1">`, `<b ${name}="x">` and `<p ${key}-x>` cannot be rendered — the parser reads a name before
any value exists. The client renderer used to write a broken `data-="1"` with no warning, and the server threw
for some of these shapes while serving garbage for others (`<p data->`, and `<p ${k}-x>` fused into the tag
name as `<p-x>`). The server now refuses every shape, and the client refuses them in development; both errors
show the rewrite: `${spread({ [`data-${key}`]: '1' })}`. A value inside an HTML comment is dropped by the server,
as the client drops it, instead of being treated as part of a tag.
