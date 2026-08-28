---
'@verajs/ssr': patch
---

`<svg>` and `<math>` no longer decline the whole fragment

Foreign content switches the HTML spec into rules this parser does not implement — self-closing tags
mean something different, names stay case-sensitive, attributes are adjusted — so it used to refuse
the markup outright. That meant **a card with an icon in it got no node view at all**, which is a
great deal to give up for one `<svg>`.

The element is modelled and its interior is kept as one opaque chunk. The surrounding markup parses
normally, the icon is an element you can find and read attributes from, and nothing inside it is
claimed. `tests/ssr-parse-differential.test.mjs` compares foreign content at its boundary and
everything around it in full.

The parser now reads 61 of 67 corpus inputs with no disagreement against parse5. The six it declines
all need the spec's error recovery or cannot be represented: an unclosed non-optional element,
misnested formatting, `<div/>`, an implied `<tbody>`, `<template>`, and a stray end tag.
