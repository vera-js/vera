---
'@verajs/ssr': patch
---

The server DOM now has the properties that exist only on *some* elements — `input.disabled`,
`a.href`, `td.colSpan`, `option.selected` — 273 of them across 44 tags.

It had one element type for every tag, carrying only the members every element shares. Anything
element-specific became a plain JavaScript property: `button.disabled = true` read back `true`,
wrote no attribute, and **served a button that was not disabled** until the bundle landed and the
client set it for real. `input.value`, `input.checked` and `option.selected` were lost the same way,
and reading any of them before writing gave `undefined` where a browser gives `''` or `false`, so
`input.value.trim()` threw on the server and worked in the client. Nothing failed, which is why it
lasted: the assignment looked like it had worked from every angle except the markup.

The table is measured from Chromium, Firefox and WebKit rather than written from memory, and a
property is only in it when all three agree on every measured cell *and* reading the attribute back
gives what was written — which excludes the ones resolved against a document URL, read out of layout
or clamped. Each tag gets a prototype carrying exactly its own interface, so `'disabled' in
paragraph` stays `false`. `tests/browser/element-reflections.test.js` re-measures in a real engine
and fails if the table and the browser ever drift apart.
