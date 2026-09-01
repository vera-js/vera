---
'@verajs/renderer': patch
---

`hydrate.ts` described the `<textarea>` carve-out as "the one respect in which a hydrated DOM is not
byte-identical to a client-rendered one". There are four, and they share a cause: `@verajs/ssr`
mirrors `.value`, `.checked` and `.selected` on form elements into markup, because markup is the only
way form state reaches the client at all. The client sets those as properties and writes no
attribute, exactly as a browser does, so the server's copy stays behind after adoption.

The count is not pedantry — it is what makes the question answerable. A probe comparing a hydrated
DOM against a client-rendered one flagged `<input ${spread({ '.value': … })}>` as a defect on the
strength of the source saying there was only one such case. The list is now written out, and
`tests/hydrate-parity.test.mjs` asserts both halves: those four differ, and nothing else does.

No behaviour changed.
