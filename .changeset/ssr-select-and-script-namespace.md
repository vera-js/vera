---
'@verajs/ssr': patch
---

A value inside an open `<select>` is never written as raw text: a `<style>` hole there is served escaped, as inside
`<svg>`, `<math>` and `<noscript>`. The select parser before customizable select (jsdom's, and older browsers') reads
that `<style>` as markup, so a value holding `</select><img onerror>` ran there. A `<script>` or `<textarea>` straight
inside a select is read as before: both parsers read its content as text.

A hole in a `<script>` whose namespace the server cannot know is refused (`ssr-script-hole`): one in a template
rendered inside `<svg>` (an `<svg><template>` too) or `<math>`, or inside `<noscript>`. It was served as escaped text,
which does nothing to code, and an SVG script runs. A hole inside a tag in an SVG script's content is refused too.
`.innerHTML` on or inside a `<select>` is served as escaped text until hydration, and a `<select>` a template or an
`.innerHTML` value leaves open is closed at its end.
