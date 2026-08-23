---
'@verajs/renderer': patch
'@verajs/jsx': patch
'@verajs/ssr': patch
---

Support `<div ${spread(props)}>` — bindings whose names are not known when the template is parsed.

New package `@verajs/spread`. Template renderers bake attribute names in at parse time, which is
what makes them small and fast and why neither this renderer nor lit-html has had spread; lit's PR
has been an open draft since 2021.

`@verajs/renderer` gains a protocol rather than a feature: a value at element position carrying
`_$apply$` applies itself, in 16 B, confined to the element position so nothing lands in the text,
attribute or property commits the benchmarks measure. An in-renderer implementation measured 176 B.

`@verajs/jsx` now compiles `{...props}` on an element to `${spread(props)}` and injects the import,
where it used to be a compile error. `@verajs/ssr` serializes a spread: attributes, truthy booleans
and the form properties reach markup; events and other properties are client state. The escaping
stays entirely in `@verajs/ssr`, so a new binding source cannot introduce a second escape boundary.

Removing a key restores what the element held before the binding existed, rather than guessing at a
value that means absent — for a property there is none. On a hydrated page that means the server's
markup; bind `null` to remove instead.

Runtime is at parity with writing the bindings out.
