---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

Security: data shaped like a template renders as text, never as markup

A value was treated as a template whenever it had a `strings` property, so a template-shaped object from
`JSON.parse` (an API field an attacker can turn into an object) was rendered as markup by the client renderer and by
the server. A template now has to come from a tagged template literal, whose strings array owns `raw`, which JSON
cannot produce. Anything else renders as the text any object does, `[object Object]`, on both sides, with a
development warning on the client. It never throws. A hand-built `html([markup])` is data by the same rule; trusted
markup is a property binding, `.innerHTML=${markup}`. A spread or self-applying value must now carry a function, not
merely the key. The check runs where a template is first built, so a cached template pays nothing: +50 B gzip on
the base renderer.
