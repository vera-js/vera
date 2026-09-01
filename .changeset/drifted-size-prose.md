---
'@verajs/renderer': patch
'@verajs/reactivity': patch
---

Correct three size claims that nothing regenerated

The second audit sweep re-ran the drifted-numbers lens over every prose file, this time filtering out
figures already inside a `<!--size:…-->` block so only the ungenerated ones remained. Eleven survived,
and three were wrong.

**The spread protocol contradicted itself.** `llms.txt` said `@verajs/renderer` costs **16 B** for it;
`packages/renderer/README.md` said **8 B** — for the same protocol, both immediately followed by the
same generated `spread.gzip` figure, so there was no ambiguity about what was being described.
Measured by deleting the `_$apply$` branch and rebuilding: **5 B** (3 815 against 3 810). Both were
wrong, in opposite directions. The figure is now dated and its method recorded, because nothing
generates it.

**`@verajs/reactivity`'s "you pay 233 B for memoised derivations" is 241 B**, and now carries a
`<!--size:computed.gzip-->` marker, so it is generated rather than remembered. Verified by corrupting
it and watching `sync-size-claims --check` fail.

`CLAUDE.md` already says a number nothing generates will be wrong. These are three more of them.
