# Divergence register

Recorded, principled differences. Anything not listed here is expected to behave identically.

## `when` — condition language is host-native
Same key, same gating role. **Vera takes a CSS selector** (`when: '.open'`) — its host is a
component framework where state reaches the DOM as classes. **Omni takes a state expression**
(`when: 'open'`, `when: '@cart > 0'`) — its whole grammar conditions on expressions. Neither side
accepts both languages in one attribute; a leading-character sniff was considered and rejected as
two condition systems in one key.

## `tick` — the registered-JS door
Vera ships it (stage 6, 2026-09-10): the attribute NAMES a function registered from page code
(`wireFunctions({ name: fn })`, or `{ tick, setup }` for consumers holding per-element resources) and
never contains one. Vera's `sequence` is its first consumer — `function: 'sequence'` + `frame-*`
settings; the `frame` keyframes key is retired. Omni reserves the grammar but defers implementation until its WP-side
registration surface is designed — a sequencing posture, not a security one (a registry-named
function is the enqueued-script trust boundary, not content JS; an earlier stored-XSS framing of
this divergence was wrong and is corrected here).

## expression-`when` — an omni extension, structurally reserved
The `when` reservation above the selector sniff (SPEC: bare identifiers/expressions never mean a
selector) exists FOR this: omni's expression engine already gates its other directives, and its
motion `when` is intended to accept expressions there too. Not yet shipped in omni's motion driver
either — its step 5 shipped selector-`when` only. Lands as `omni: shipped, vera: pending` if
vera's state destination materializes; otherwise it stays a recorded omni extension. Either way the
grammar space is held open on both sides, which is what the reservation buys.

## Rule-name hash — same construction, different width
Both engines name generated rules by FNV-1a content hash; **omni is 64-bit, vera is 32-bit.** Not a
defect: the spec's determinism requirement is intra-implementation — a server and client of the
same engine must agree on a name, and omni pages and vera pages never share generated rules. Both
widths are pinned by `fixtures/hash-vectors.json` over shared texts, each column verified against
its shipping implementation. Vera's 32-bit reasoning (birthday bound at realistic rule counts,
collision cost is a wrong animation, not corruption) is in `registry.ts`'s header; omni's 64-bit
came with its BigInt/PHP pair where width costs nothing.
