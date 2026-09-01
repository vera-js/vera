---
'@verajs/renderer': patch
---

Scope the hydration-fallback warning to the container it happened in.

It said "the server markup was discarded, so the page is correct but nothing the server rendered was
used". Adoption is decided per container, so that is a page-wide claim about a per-container event —
measured with three containers, one carrying markup the template does not describe: one warning
prints and the other two adopt their server nodes unchanged.

The difference is what the reader does next. Told the whole server render was wasted, they go looking
for a page-wide cause — a bad doctype, a broken handoff, state that differs everywhere — when the
message has already named the one element that disagreed. It now says this container was rebuilt,
that its SSR `<style>` is kept (which `clearPreservingStyles` has always done), and that other
containers are unaffected.

No behaviour change; the isolation was already correct and is now tested and documented.
