---
'@verajs/ssr': patch
---

A tag that ends foreign content (`<svg><p>`) is read as the browser reads it, and an SVG `<template>`'s content is live

Inside `<svg>`/`<math>` the browser leaves foreign content at a "breakout" tag — `<p>`, `<b>`, `<div>`, `<table>` and
the rest of the standard's list, and `</p>`/`</br>` — and reads what follows as HTML. The server kept treating it as
foreign content, so a `<style>` after one was served escaped (`.a > .b` as `.a &#62; .b`) and a component after one
was not rendered. It now pops to the element the parser lands in, only where that is certain: never through
`<noscript>`, never at an integration point (those tags are HTML there already), and never out of a position a parent
template gave, which this template cannot see. `<font>` breaks out in a browser only with a `color`, `face` or `size`
attribute, and never does here, which only ever escapes more.

`<template>` content is inert only for an HTML `<template>`: inside `<svg>`/`<math>` it is a foreign element whose
content is live markup, so a binding there was dropped where the client renders it. And an end tag inside
`<template>` content no longer closes anything outside it, as the parser ignores it there.
