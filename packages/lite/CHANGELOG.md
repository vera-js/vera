# @verajs/lite

## 0.1.2

### Patch Changes

- 4dce381: A bound `href` on a `<base>` is refused, as a bound `<script>` URL is: every relative and path-absolute URL after a
  `<base>` resolves against it, a module script's `src="/assets/app.js"` included, so a value there chooses where the
  page's code loads from (measured in Chromium, Firefox and WebKit, served and client-rendered). The renderer and `spread`
  ignore the binding, `@verajs/lite` and `@verajs/static` do not write it, and `@verajs/ssr` never serves it; development
  names it `base-href`. A `<base href>` written in the template is the author's own and untouched, and `<base target>`
  still binds. What this takes away: a base computed per request in a template. Write the base for each deployment, or
  give `@verajs/router` its prefix with its `base` option (`router({ base: '/app' })`).
- 41113e5: The client's template scanners read whitespace as HTML does: tab, line feed, form feed, carriage return and space, and
  nothing else, as `@verajs/ssr` does. U+000B, U+00A0 and JavaScript's other non-HTML spaces are part of a name or an
  unquoted value to a browser. Development now refuses a hole one of them joins to an attribute name
  (`name-expression`), as the server does, and the scanners read tag and attribute names where a browser ends them.
- 85f12ac: A `<script>` no longer takes a property binding. Its properties include its code (`.textContent`, `.innerHTML`,
  `.innerText`, `.text`, `.outerHTML`, `.outerText`), so `.name=${…}`, `!name=${…}` and a `.`/`!` spread key on a script —
  a JSON data block's included — are now refused: the renderer and `spread` ignore the binding, `@verajs/lite` writes
  nothing, and `@verajs/ssr` no longer serves `.textContent` or `.innerHTML` there (it served no other property on a
  script already). Development says so (`script-property`), and the server says so once in every build. This changes what
  such a template does: a bound `.textContent` used to write the value, and a page the server rendered ran it. Every
  script property has an attribute form: bind `?async=${…}`, `?defer=${…}`, `type=${…}`, `nonce=${…}` instead. To hand
  data to the client, write a text hole in a JSON data block, `<script type="application/json">${data}</script>`, which
  escapes `<` as `\u003c` (JSON reads it back unchanged). An object kept on the script element itself, or a customized
  built-in script's own property (`<script is="…">`), has no binding any more; for code, load a module.
- 044fb04: A `<script>`'s URL can no longer be bound. `src` (and an SVG script's `href` or `xlink:href`) chooses the code the
  script runs, so `<script src=${url}>`, `.src=${url}` and a spread `src` key on a script are now refused: the renderer
  and `spread` ignore the binding, and `@verajs/lite`, `@verajs/static` and `@verajs/ssr` never write the attribute.
  Development says so (`script-source`). This changes what such a template does: it used to write the URL, and a page
  the server rendered ran that script on load (as WebKit does on the client for an SVG script). Write the URL into the
  template, where it is the author's own (`<script src="/app.js">`), or load the module with `import()`. A written `src`
  beside a spread one stays.

## 0.1.1

### Patch Changes

- 71b9d17: `isServer` is now a function, `isServer()`, read when it is called. As a constant computed when core loaded, it answered
  `false` for the whole process whenever core was imported before `@verajs/ssr`, so per-user state guarded by it was
  rendered into server markup. **Code written as `if (!isServer) …` must become `if (!isServer()) …`**: a function is
  always truthy, so the old spelling no longer throws, it silently takes the server branch everywhere, in the browser
  too. TypeScript (strict, 6.0.3) reports `if (isServer)`, `isServer ? … : …` and `isServer && …` as TS2774, but not
  `if (!isServer)`, the guard's usual spelling: search for `isServer` not followed by `(` (`grep -rnE 'isServer($|[^(])'`).
  `@verajs/lite` gains the same `isServer()`, so a component guarding per-user state runs unchanged on either tier.

## 0.1.0

### Minor Changes

- 922e014: New package `@verajs/lite`: `define`, `signal` and the `html`, `svg` and `mathml` tags, with a renderer built in and
  nothing to wire. A render patches values in place (events, properties, live and boolean bindings, nested templates,
  unkeyed lists and any iterable). It is reactive, shares `@verajs/core`'s refusals and development warnings in core's
  words, and runs on `@verajs/core` after changing the import and wiring a renderer. The HTML parser judges each template
  once, so a value it would move or drop is refused. The text of `<title>`, `<textarea>` and `<style>`, and a JSON data
  block, take a value as text. Lite components render on the server through `@verajs/ssr`. It runs core's applicable
  test suites in every build.
