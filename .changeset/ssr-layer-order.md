---
'@verajs/ssr': patch
---

A render's `styles` opens with the layer-order statement, `@layer theme, base, vera, components, utilities;`, whenever it holds any CSS, for `@verajs/styles`' light defaults in `@layer vera`: serve `styles` first in `<head>`, before any other layered CSS, and a server-rendered page needs no setup.
