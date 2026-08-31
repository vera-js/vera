---
'@verajs/ssr': patch
---

Three reflected properties answered with a measurement probe value.

`area.shape`, `ol.type` and `textarea.wrap` were listed in the reflections table as enumerated, with
an invalid-value answer of `"zzz-not-a-state"` — not a string any engine produces, but the probe value
used to discover an invalid-value default, recorded as though it were the answer. So
`area.shape = 'anything'` answered `"zzz-not-a-state"`, and `shape = 'CIRCLE'` answered `"circle"`,
where every engine echoes the input.

An enumerated *content* attribute is not an enumerated *IDL* attribute. All three name a limited set
of keywords that affect rendering, and all three have a plain `attribute DOMString` in their IDL, so
the property reflects verbatim. Reclassified as plain string reflections, which is what a real DOM
does — asserted against one rather than against expected strings, since the table's own header says
these were measured on three engines and a measurement would have shown the echo.
