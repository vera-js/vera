---
'@verajs/ssr': patch
---

Answer enumerated reflections with a state, and accept an assignment to `part` and `classList`

An enumerated reflection does not hand back the attribute's text. `inputmode="bogus"` reads as `''`
in every engine, and an absent attribute frequently has a different answer again —
`autocapitalize` is `''` when missing and `'sentences'` when invalid. The shim returned the raw text
for all of them, so a component reading `element.inputMode` on the server got `'bogus'` where the
browser gives `''`.

`contentEditable` now validates what is assigned to it: the three states are accepted and
lowercased, `'inherit'` removes the attribute, and anything else throws a `SyntaxError` as every
engine does. `part` and `classList` are declared `[PutForwards=value]`, so `element.part = 'a b'` is
a legal operation — it was a getter with no setter here, which made a `TypeError` out of something
the browser performs.

`spellcheck` and `autocorrect` are deliberately unchanged: the engines genuinely disagree about
both, so there is no single answer to match.

Markup is unaffected — the attribute was already stored verbatim, which is what the engines do too.
Every rule was measured on Chromium, Firefox and WebKit before it was implemented, and both
`tests/browser/reflected-enumerations.test.js` and `tests/ssr-reflected-enumerations.test.mjs`
record it.
