---
'@verajs/ssr': patch
---

A `<template>` in the server's DOM has its markup as its `content`, a fragment of its own, as in browsers: its
`children` and `childNodes` are empty, a query on the template finds nothing inside it, and `template.content`
holds what was parsed, so `template.content.cloneNode(true)`, the usual way a component stamps a template, works on
the server, where it threw. `innerHTML` reads and writes the content, a deep `cloneNode` copies it, and a fragment
can be cloned. What the page receives is unchanged.
