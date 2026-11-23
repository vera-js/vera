---
'@verajs/renderer': patch
'@verajs/lite': patch
'@verajs/static': patch
'@verajs/ssr': patch
---

A bound `href` on a `<base>` is refused, as a bound `<script>` URL is: every relative and path-absolute URL after a
`<base>` resolves against it, a module script's `src="/assets/app.js"` included, so a value there chooses where the
page's code loads from (measured in Chromium, Firefox and WebKit, served and client-rendered). The renderer and `spread`
ignore the binding, `@verajs/lite` and `@verajs/static` do not write it, and `@verajs/ssr` never serves it; development
names it `base-href`. A `<base href>` written in the template is the author's own and untouched, and `<base target>`
still binds. What this takes away: a base computed per request in a template. Write the base for each deployment, or
give `@verajs/router` its prefix with its `base` option (`router({ base: '/app' })`).
