---
'@verajs/ssr': patch
---

`<style>` and `<script>` content is written raw, not escaped

A browser does not decode a character reference inside either element, so escaping their content
protected nothing and corrupted it. `<style>${'.a > .b'}</style>` served `.a &#62; .b` — a selector
that matches nothing — while the client, which sets text through the DOM and never re-parses,
rendered it correctly. **Every interpolated stylesheet was broken server-side and right in the
browser**, which is a hydration divergence as well as a visible styling bug. A `<script>` got the
same treatment, which breaks the source outright.

Not escaping means the element's own end tag has to come out of the value instead, so the serializer
now tracks which RAWTEXT element a binding sits inside and neutralises the closer (`<\/style`,
`<\/script` — valid CSS and JavaScript, invisible to the tokenizer).

`<title>` and `<textarea>` are RCDATA, not RAWTEXT — references *are* decoded there — so they keep
ordinary escaping, which is also what the client produces for them.
