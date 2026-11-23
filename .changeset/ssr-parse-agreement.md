---
'@verajs/ssr': patch
---

The server reads markup where the browser does in three more places. A `<` inside a template's own quoted attribute
value, in a tag the server edits (a name written twice, a spread), is served as `&#60;` (the same character to every
parser), so a value bound to a name written earlier in the same tag stays inside its quotes, and a static value that
reads like a tag (`title="<i value=1>"`) is no longer cut short. A `<script>`'s end is found by the parser's escaped and double-escaped script states, in
the template compiler and the DOM parser alike, so a hole after `<!--…<script>…</script>` is a script hole and is
refused. And a `<style>` or `<script>` appended inside an `<svg>` through the DOM has its text escaped, as the browser
reads that text as markup there.
