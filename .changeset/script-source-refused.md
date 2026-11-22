---
'@verajs/renderer': patch
'@verajs/lite': patch
'@verajs/static': patch
'@verajs/ssr': patch
---

A `<script>`'s URL can no longer be bound. `src` (and an SVG script's `href` or `xlink:href`) chooses the code the
script runs, so `<script src=${url}>`, `.src=${url}` and a spread `src` key on a script are now refused: the renderer
and `spread` ignore the binding, and `@verajs/lite`, `@verajs/static` and `@verajs/ssr` never write the attribute.
Development says so (`script-source`). This changes what such a template does: it used to write the URL, and a page
the server rendered ran that script on load (as WebKit does on the client for an SVG script). Write the URL into the
template, where it is the author's own (`<script src="/app.js">`), or load the module with `import()`. A written `src`
beside a spread one stays.
