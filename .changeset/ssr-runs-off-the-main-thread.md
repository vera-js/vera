---
'@verajs/ssr': patch
---

The server environment stops taking globals its host still needs

`installShims()` writes ~35 globals, which is free on a server — Node defines none of them, so it
is filling an empty room. Three of those writes were not free anywhere else, and each failed in a
different way:

- **`globalThis.self = globalThis` threw**, because `self` is a getter-only property of a
  `WorkerGlobalScope`, and the shim never finished installing. It is `??=` now, which loses nothing:
  where `self` already exists it already *is* the global, which is all the line ever wanted.
- **`globalThis.postMessage = () => {}` severed the host's only channel back**, silently — the
  render completed and every reply vanished, which is indistinguishable from a crash. It is `??=`
  now. **`close` deliberately stays unconditional**: the same reasoning reaches the opposite answer,
  since a `close()` that is not inert would let a component end the render.
- **`location` could not be given a per-render URL.** `renderToString`'s `location` option mutates
  the object in place, and `??=` short-circuited wherever the environment already provided an
  immutable one, so the option threw rather than routing. The shim now installs its own writable
  object as an own property, seeded from whatever URL the environment describes.

Alongside them, `node:crypto` — the package's only Node import — becomes the `crypto.randomUUID()`
that both platforms have had for years. Same function, same entropy, one import fewer.

Nothing here changes what a server renders: every fix is shaped as *do not replace what the
environment already provides* rather than as a branch on which environment this is, so on Node each
one is inert by construction. The hydration and kitchen fixtures are byte-identical, which is the
proof — they are real server output, regenerated and `--check`ed by the gate.

`LOCATION_PARTS` now lives with the shim that installs `location`, rather than being duplicated by
the render that walks it.
