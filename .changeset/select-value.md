---
'@verajs/ssr': patch
'@verajs/renderer': patch
---

`<select .value>` selects the right option, on both sides

A `<select>` has no `value` content attribute — assigning the property *selects an option* — and
neither half of the framework got this right.

**The server wrote ` value="b"` on the `<select>` tag**, which no parser reads, leaving a control
showing its first option. It now marks the matching `<option selected>`, which is what React's server
renderer does; `@lit-labs/ssr` drops the binding entirely and serves the same wrong control we did.
Matching follows the platform — the `value` attribute verbatim, otherwise the option's text stripped
and collapsed, first match wins, and a `selected` the author wrote is cleared because a property
assignment overrides markup. Asserted in Chromium, Firefox and WebKit, because every one of those
rules is the platform's.

**The client selected the wrong option, or none.** `.value` commits in document order, so when the
options come from `${items.map(…)}` — the ordinary way to write a select — they did not exist yet and
the assignment matched nothing: measured, index 0 instead of 1, and −1 when option values were
themselves bound. **lit-html has the identical defect**, measured the same way. The assignment is now
applied after the pass commits, and it is queued rather than dirty-checked because the options can be
replaced while the value stays the same, which drops the selection just as thoroughly.

One case has no fix and is now in the SSR README: a value matching **no** option leaves the client at
`selectedIndex: -1` while a parsed `<select>` takes its first, and there is no markup for "none of
them". `tests/ssr-select-parity.test.mjs` asserts that as a divergence, so closing it fails loudly.
