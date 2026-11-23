---
'@verajs/ssr': patch
---

A name in the object form of `attributes` follows the rule a spread's keys do: a backtick, `<` or a control character
is refused as well as whitespace, a quote, `/`, `=` and `>`. The message no longer says `setAttribute` refuses a quote
in the browser, which it does not; it names the rule it applies.
