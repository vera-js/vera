---
'@verajs/inserts': patch
---

Warn in development when `connectInserts` discards existing registrations.

It replaces the registry rather than merging into it, which makes the call order load-bearing:
anything registered beforehand becomes unreachable. Nothing throws — the callback simply lands in a
map nobody reads afterwards — so a `setRenderer` in the wrong place produced an app that rendered
nothing with no indication why. The requirement was not documented anywhere, in `llms.txt`, the
README, or the type.

Merging instead was rejected on weight: this package is inlined into `@verajs/core`,
`@verajs/renderer` and `@verajs/router`, so a byte here is paid three times in the packages least
able to afford it. The check is `__DEV__`-only and the production bundle is unchanged at 322 B,
verified to contain neither the check nor the message.

The README also documented four insert points and omitted `'init'`, which `@verajs/styles` attaches
through — as did `llms.txt`. Both corrected, and the README gains the usage it never had.
