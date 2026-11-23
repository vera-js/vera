---
'@verajs/ssr': patch
---

A URL property of the server's DOM (`a.href`, `img.src`, `link.href`, `script.src`, `q.cite` and 15 more) reads back
resolved against the document's URL, as in a browser: `a.href = '/x'` then read answered `/x`, where every engine
answers an absolute URL. The served markup is unchanged: the attribute keeps what was written.
