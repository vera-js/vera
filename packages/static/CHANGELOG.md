# @verajs/static

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
