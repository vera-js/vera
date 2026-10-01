---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A comment ends where the HTML tokenizer ends it

The tokenizer closes a comment at `-->`, at `--!>`, and abruptly at `<!-->` and `<!--->`. Every scanner here knew
only `-->`, so `<p><!-->${value}</p>` dropped the value silently on the client and the server while a browser
renders it, and the server's DOM and its nested-component scan read the same markup differently from the browser.
All of them now follow the tokenizer's rule. The server also renders a template-shaped forgery as the constant text
`[object Object]`, never through the forgery's own `toString`, so a JSON `"toString"` key cannot make it throw.
