---
'@verajs/ssr': patch
---

A binding is classified by the server's tag scan, so a sigil inside a comment or a text-only element is no binding

The server decided whether a hole was a sigil binding (`.prop`, `?bool`, `@event`, `&ref`, `!live`), an `onClick`
binding, or a tag-name hole by testing the static's tail with patterns that knew nothing of comments or raw text. So
`<!-- <div .innerHTML=${v}> -->` wrote `v` as markup inside the comment, and a `-->` in it ended the comment early;
`<textarea><b .innerHTML=${v}>` and `<title>` broke out the same way; `.value` in a comment wrote an attribute; and a
`?a=`, `.a=` or `onClick=` inside a quoted attribute value, or after a `<` that is only text, was treated as a
binding. The client drops all of these. The server now reads every one of those answers off the same scan that reads
the tags, as the tokenizer reads them. A form property on an upper-case tag (`<INPUT .value=…>`) is mirrored as it is
on `<input>`, a hole inside a tag name is refused whatever the tag name contains, and an attribute named
`data-onClick` is an attribute, as it is on the client. Compiling a template is about 14% faster, and so is a page
of spreads (8%).
