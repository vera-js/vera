---
'@verajs/renderer': patch
---

A template is marked for its extensions only when one of them claimed it

The renderer gives a template's instances the extension path (instance hooks, the create scope, namespace resolution)
when a `'template'` insert left something on it. It used to mark every template as soon as any such insert was
wired, so an app wiring `@verajs/renderer/elements`, as every app using slots does, sent every template down that
path, claimed or not, at about 1% on creation. The mark is now derived from what the inserts left (`_$at$`,
`_$inst$`, `_$ns$`), so unclaimed templates keep the plain path. The `'template'` insert contract is unchanged:
a hook still returns nothing. +3 B gzip on the base renderer.
