---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

`.innerHTML` and `.textContent` render on the server, and hydrate

The trusted-markup binding, `<div .innerHTML=${markup}>`, used to serve an empty element that the client filled in,
and hydration then discarded the container for any non-empty value. The server now writes the content into the
page, made to behave as an `innerHTML` assignment does: a `<script>` in it is served inert and a
`<template shadowrootmode>` cannot attach a shadow root. Whatever the markup leaves open is closed before the
element ends, a raw-text, text-only or foreign host and any `.textContent` get escaped text, and each property's
null/undefined conversion follows its IDL. Hydration adopts such an element instead of rebuilding its container
(+44 B gzip on the hydrate entry; the base renderer is unchanged).
