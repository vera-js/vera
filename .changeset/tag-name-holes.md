---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A value in tag position is refused, and the server reads raw-text elements as the client does

`<${x}>`, `</${x}>` and `<my-${x}>` without `@verajs/renderer/tag` cannot make an element — the parser reads a tag
name before any value exists. The client rendered `&lt;&gt;` and the server served `<>`; now the server refuses the
template in every build and the client in development, both naming the tag entry, where a runtime tag name is a tag
value. Only markup counts: a `<` inside a comment, a raw-text element or a quoted attribute value never makes a tag
position.

The server's scanner now treats `<textarea>`, `<title>` and `<iframe>` content as text, as the client always has
(escaping unchanged), so `<textarea><b title=${v}>` serializes the value as text instead of quoting it as an
attribute.
