# @verajs/lite

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
