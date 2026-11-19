# @verajs/lite

## 0.1.0

### Minor Changes

- 922e014: New package `@verajs/lite`: `define`, `signal` and the `html`, `svg` and `mathml` tags, with a renderer built in and
  nothing to wire. A render patches values in place (events, properties, live and boolean bindings, nested templates,
  unkeyed lists and any iterable). It is reactive, shares `@verajs/core`'s refusals and development warnings in core's
  words, and runs on `@verajs/core` after changing the import and wiring a renderer. The HTML parser judges each template
  once, so a value it would move or drop is refused. The text of `<title>`, `<textarea>` and `<style>`, and a JSON data
  block, take a value as text. Lite components render on the server through `@verajs/ssr`. It runs core's applicable
  test suites in every build.
