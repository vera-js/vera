---
'@verajs/ssr': patch
---

Declare `@verajs/core` and `@verajs/styles` as peer dependencies, which `@verajs/ssr` imports and did
not ask for.

`src/vera/index.js` does `await import('@verajs/core')` and `await import('@verajs/styles')` at module
scope — core for `wire` and `inserts`, styles because server rendering must serialize a component's
`static styles` and nothing on the server cares about the bytes, so SSR wires the adopter rather than
making every caller remember to. The manifest declared neither, and no dependencies at all. Anyone
installing `@verajs/ssr` on its own got a package that throws on import.

**Peer rather than regular**, deliberately. A regular dependency lets npm nest a second copy of
`@verajs/core` whenever the consumer's version is outside the range — and two cores means two
`@verajs/inserts` maps, so a module registers into a registry the other core never reads. That is the
hazard `CLAUDE.md` describes for CDN bundles, reached here by a different route. A peer dependency
fails loudly on a version conflict instead of silently installing the second copy, and npm installs it
automatically when there is no conflict.

Ranges follow the 0.x rule this project uses: `^0.2.1` and `^0.1.0` admit patch releases and stop at
the next minor, which is where breaking changes land while below 1.0.
