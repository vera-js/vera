---
'@verajs/router': patch
---

Security and accessibility fixes from a principles audit.

**A view name is no longer interpolated into a selector.** `view` may be a function whose result
derives from URL params, so the name is attacker-influenced, and it was being built into
`[view="…"]` with only `"` escaped. Escaping a quote is not enough: `a\"` becomes `a\\"`, which CSS
reads as a literal backslash followed by a string terminator, so the value escapes the string it was
quoted into. A crafted URL threw a `DOMException` out of `navigate` — an unhandled rejection that
killed the navigation — and a payload that parsed would have selected an element the author never
marked as an outlet. Nothing builds a selector from the name now; the attribute is compared as a
string, so there is no grammar left to escape into. 3 B.

**A focused view no longer joins the tab order.** When a routed view has no focusable content the
router focuses its root, and it did so by setting `tabIndex = 0` — which makes the element focusable
*and* inserts it into the tab sequence, permanently, since nothing takes it back out. Every
navigation to such a view left another tab stop behind. `-1` is the standard shape for a
programmatic focus target: focusable from script, absent from the tab sequence.

Also removed: three `Route` fields nothing ever set (`pattern`, `keys`, `regExp`, duplicating
`ParsedPattern`), a `stripTrailingSlash` re-export nothing imported, and three stale `TODO` comments
describing minified-error work that never happened.
