# @verajs/static

## 0.1.0

### Minor Changes

- 922e014: New package `@verajs/static`: `define` and the `html`, `svg` and `mathml` tags, rendered ONCE into markup — the same
  component source as `@verajs/lite` and `@verajs/core`, for pages that need markup and no updates. Every value is
  written as inert text and the HTML parser's result is judged: a script URL is removed, an event-handler or `srcdoc`
  attribute holding a value is not written, a `<style>` or JSON data block takes a value as text, and a value in a tag or
  attribute name, in a script, in never-shown content, or one the parser would drop is refused (`static-hole`). `?name`
  is honored; `.prop`, `!live`, `@event` and functions write nothing (behavior comes from `@verajs/directives`). It renders
  on the server through `@verajs/ssr`, and runs core's applicable test suites in every build.
