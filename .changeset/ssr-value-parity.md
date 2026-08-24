---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

Server and client agree about every value kind at a child position.

`@verajs/ssr` returned `''` for any object that was not template-shaped, and the client has never
agreed: a `Date` rendered its full date string there and nothing here, an object with a `toString`
rendered its text, a `Set` or `Map` rendered its entries, a `Promise` rendered `[object Promise]`.
Whether any of those is a sensible thing to interpolate is beside the point — the two sides
disagreeing is a silent hydration mismatch. Iterables now render their entries and everything else
falls through to `String(value)`, which is what the client does.

`@verajs/renderer/hydrate` adopts them. A non-iterable object at a child position was a deliberate
mismatch, because the server emitted nothing for it and the two could not be reconciled; once the
server matched, that mismatch was the only thing left disagreeing.

**A colon is legal in an attribute name.** `xml:lang=${…}` produced `<b xml: lang="en">` — the name
pattern stopped at the colon, so the prefix was left as text and the tag came out malformed.
`xml:`, `xlink:` and friends parse now, in templates and when attributes are read back out of
emitted markup.
