# @verajs/static

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
- 044fb04: A `<script>`'s URL can no longer be bound. `src` (and an SVG script's `href` or `xlink:href`) chooses the code the
  script runs, so `<script src=${url}>`, `.src=${url}` and a spread `src` key on a script are now refused: the renderer
  and `spread` ignore the binding, and `@verajs/lite`, `@verajs/static` and `@verajs/ssr` never write the attribute.
  Development says so (`script-source`). This changes what such a template does: it used to write the URL, and a page
  the server rendered ran that script on load (as WebKit does on the client for an SVG script). Write the URL into the
  template, where it is the author's own (`<script src="/app.js">`), or load the module with `import()`. A written `src`
  beside a spread one stays.

## 0.1.1

### Patch Changes

- 3756cfb: Development now says `@verajs/core`'s warnings in core's words where static renders a value as core does but it is
  probably a mistake: a boolean child that renders as the word (`boolean-child`), an attribute's whole value that is not
  text (`attribute-value`), and a `javascript:` URL that static removes (`script-url`). Each is said once — a boolean per
  template, hole and value, an attribute value per tag, name and kind, a removed URL per tag, name and value — and never
  for a value static already names. Production is unchanged, byte for byte.

## 0.1.0

### Minor Changes

- 922e014: New package `@verajs/static`: `define` and the `html`, `svg` and `mathml` tags, rendered ONCE into markup — the same
  component source as `@verajs/lite` and `@verajs/core`, for pages that need markup and no updates. Every value is
  written as inert text and the HTML parser's result is judged: a script URL is removed, an event-handler or `srcdoc`
  attribute holding a value is not written, a `<style>` or JSON data block takes a value as text, and a value in a tag or
  attribute name, in a script, in never-shown content, or one the parser would drop is refused (`static-hole`). `?name`
  is honored; `.prop`, `!live`, `@event` and functions write nothing (behavior comes from `@verajs/directives`). It renders
  on the server through `@verajs/ssr`, and runs core's applicable test suites in every build.
