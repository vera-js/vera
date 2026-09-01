---
'@verajs/ssr': patch
---

Text and comments are nodes

`createTextNode` returned an object literal carrying an `innerHTML` string. It had no identity, no
parent and no `nodeType`, and appending one inlined its markup and lost the node — so `childNodes`
reported `1` for `text <b>bold</b> tail` where every browser says `3`, and there was no way to read
a text node back at all. `createComment` was the same.

Both are real nodes now, with `data`, `nodeValue`, `length`, `parentNode`, siblings, `cloneNode`,
`splitText` and `appendData`. `childNodes` counts them, `children` does not, and a comment
contributes nothing to `textContent` — each verified against jsdom performing the same operation in
`tests/ssr-text-nodes.test.mjs`.

`textContent` walks the tree instead of stripping tags out of the serialised markup with a regular
expression. That expression only undid this package's own numeric escapes, so an element holding the
text `a & b` answered `a &amp; b` — the entity spellings it does not itself emit came back raw.

Like an element, a parsed text or comment node keeps the exact bytes it came from, so re-serialising
still reproduces the input: `&amp;` stays `&amp;` rather than becoming `&#38;`.
