---
'@verajs/inserts': patch
---

Make `connectInserts` order-independent instead of silently discarding registrations.

It replaced the registry rather than merging into it, which made the call order load-bearing:
anything registered beforehand became unreachable. Nothing throws — the callback simply lands in a
map nobody reads afterwards — so a `setRenderer` in the wrong place produced an app that rendered
nothing with no indication why. The requirement was documented nowhere: not in `llms.txt`, not in
the README, not in the type. `examples/cdn-js` happens to get it right, which is how it stayed
hidden.

Registrations are now replayed into the new registry at their original priorities, so both orders
reach the same state and there is no rule left to know. A replayed entry whose priority is already
taken replaces it, exactly as a direct `insert` would; connecting a registry to itself — the bundler
case, where both specifiers resolve to one module — changes nothing.

Costs 43 B gzipped here. `@verajs/renderer` pays none of it, because it never imports
`connectInserts` and rollup shakes it out; `@verajs/core` grows 34 B and `@verajs/router` 38 B,
about 1.3% each.

The README also documented four insert points and omitted `'init'`, which `@verajs/styles` attaches
through — as did `llms.txt`. Both corrected, and the README gains the usage it never had.
