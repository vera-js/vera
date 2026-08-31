---
'@verajs/ssr': patch
---

A numeric reflection now writes the converted number, not the value it was handed.

The platform applies the WebIDL conversion for the property's type at assignment and writes the
**converted** number to the attribute. This wrote the value verbatim, so `element.width = 3.9`
produced `width="3.9"` on the server where the client writes `width="3"` — a hydration mismatch from
ordinary code, since a fractional dimension is what arithmetic produces. `'probe'` and `''` now write
`"0"` as they do in a browser, rather than being stored as-is.

Measured in Chromium across all 31 numeric reflections, which share this rule exactly.

**Not** included: the per-property handling of a negative value, which eleven of them clamp to 0, six
to 1, four refuse, two allow, and `canvas` and `input.size` replace with an element default. That is
thirty-one hand-classified rows in a table whose hand-classified rows have already produced one
defect, and a negative width is a caller's mistake where a fractional one is not. The measured table
is recorded for whenever that trade is worth making.
