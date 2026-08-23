---
'@verajs/autoloader': patch
---

A broken default, a new extension point, and 29 B off — from a principles audit.

**`componentsDir` is optional and never worked when omitted.** The default was `'/'`, which built
`'//tag.js'` — a protocol-relative URL, so `new URL` read the tag name as a *host*. Every resolved
URL then landed outside the entry's directory and was refused. `initAutoloader(import.meta.url)`,
the natural call for components sitting beside the entry file, therefore loaded nothing at all, and
`autoload-dir="/"` did the same. An empty or root-only directory now means the entry's own
directory, which is the only place a bounded URL can point anyway.

**`resolve(tag, dir)`** replaces URL building for a layout `dir/tag.ext` cannot express —
`tag/tag.js`, `tag/index.js`, anything. The result is still resolved against the entry file and
still bounded by it, so a custom layout cannot reach anywhere the default one could not. Principle
#6 names this module's hard-coded `.js` as the example of the shape to avoid; the path around it was
the same problem one level out.

**Smaller, at 583 B.** The discovery loop re-checked `localName.includes('-')` and
`customElements.get(tag)` on every match, which `:not(:defined)` already guarantees — a dashless
unknown tag is `:defined`, and an element leaves the set the moment its definition lands. Both are
now pinned in a real engine rather than assumed.
