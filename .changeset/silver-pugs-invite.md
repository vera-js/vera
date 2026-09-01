---
'@verajs/ssr': patch
---

Apply `[LegacyNullToEmptyString]` to the whole class, not one member of it.

A handful of IDL string attributes store `''` when assigned `null` rather than the word `"null"`. The
SSR README already records one as found and fixed — "`textContent = null` writing the word 'null'" —
and that fix went to the member instead of the rule, so `input.value`, `textarea.value` and
`innerHTML` stayed wrong.

It reaches a page through ordinary code: `element.value = maybeNull` in a component made the server
write `value="null"`, so the control showed the word "null" until hydration replaced it with the
empty string the client stores.

`undefined` is deliberately not included — the platform stringifies it, and only `null` is
special-cased. Both directions are now asserted, so over-applying the rule fails too.
