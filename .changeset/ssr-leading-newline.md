---
'@verajs/ssr': patch
---

Content that starts with a line feed survives in `<pre>`, `<listing>` and `<textarea>`, and values a component reads from parsed markup are the browser's

The HTML parser drops one line feed right after a `<pre>`, `<listing>` or `<textarea>` start tag, so a server
render of `` html`<pre>${'\nabc'}</pre>` `` arrived as `abc` while the client held `\nabc`. That happened on
every route: a bound value, an empty first value, a list, a nested template, `.textContent`/`.value`/`.innerHTML`
and the server DOM's own serialization. The server now writes one extra line feed in front of such content, for
the parser to take. A browser's `innerHTML` does not, so the server DOM's `innerHTML`/`outerHTML` read one more
line feed there than a browser's: deliberately, because a browser's serialization of that content does not
parse back to it.

Values read from parsed markup now match a browser: line breaks normalized (CRLF and CR read as LF),
`<textarea>` and `<title>` content decoded, the leading line feed above taken, and a numeric reference decoded
without its `;`. The markup itself is still served byte for byte.

A spread's textarea `.value` after an earlier `.textContent` binding in the same template now replaces the
textarea's content; it used to keep the author's.
