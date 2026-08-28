---
'@verajs/ssr': patch
---

`innerText` breaks lines with `<br>`, and `isContentEditable` follows the state

Assigning `innerText` went through `textContent`, leaving a literal newline where every engine
writes a `<br>`. A page lays a literal newline out as a single space, so a component that set
`innerText` rendered its lines **run together on the server and correctly broken on the client** —
a difference in the markup itself, not merely in what a property reads back. All three spellings of
a break are handled, and `\r\n` is one `<br>` rather than two.

`isContentEditable` compared the attribute's text to `'true'`, which answers `false` for
`plaintext-only`, for an empty attribute and for `TRUE` — all three are editable. It now reads the
`contentEditable` state.

Both rules were measured on Chromium, Firefox and WebKit before being implemented, and
`tests/browser/inner-text.test.js` records them.
