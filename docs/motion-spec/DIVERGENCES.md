# Divergence register

Recorded, principled differences. Anything not listed here is expected to behave identically.

## `when` — condition language is host-native
Same key, same gating role. **Vera takes a CSS selector** (`when: '.open'`) — its host is a
component framework where state reaches the DOM as classes. **Omni takes a state expression**
(`when: 'open'`, `when: '@cart > 0'`) — its whole grammar conditions on expressions. Neither side
accepts both languages in one attribute; a leading-character sniff was considered and rejected as
two condition systems in one key.

## `function` — the registered-JS door
Vera ships it (stage 6, 2026-09-10): the attribute NAMES a function registered from page code
(`wireFunctions({ name: fn })`, or `{ run, setup }` for consumers holding per-element resources) and
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

## Rule-name hash — same function, different encoding
Both engines name generated rules by **FNV-1a 64-bit** content hash. The function no longer
diverges: vera moved from 32 to 64 bits on 2026-09-13 and its `fnv1a64` now matches omni's column
in `fixtures/hash-vectors.json` exactly.

What remains is the ENCODING, and it is deliberate on both sides. omni spells the 64 bits as 16 hex
characters; vera spells them as **two 7-character base36 halves** (14 characters). Still not a
defect, for the original reason: the spec's determinism requirement is intra-implementation — a
server and client of the *same* engine must agree on a name, and omni pages and vera pages never
share generated rules.

**Vera tried a denser encoding first and reversed it on measurement**, which is worth recording
because the reasoning looks right and is wrong. A CSS identifier accepts all 64 symbols of
`[A-Za-z0-9_-]`, so packing six bits per character reaches 11 characters where hex needs 16 — and
that is true. But it costs a 64-character alphabet literal that gzip cannot compress plus a
hand-rolled packing loop, measured at **105 B gzipped per bundle**, to save three characters in a
marker that repeats on every element and in every selector — i.e. in exactly the position gzip
erases. `toString(36)` is free and built in. The lesson generalises: a denser ENCODING pays per
occurrence, its TABLE pays once per bundle, and repeated occurrences are nearly free after
compression.

**Vera's earlier 32-bit reasoning is withdrawn, and why is worth carrying.** It rested on "a
collision's cost is a wrong animation on one page, not corruption" — but a wrong animation IS the
defect, since `acquire` discards the `cssText` it is handed on a hash hit. A searched-for pair
(`r7wzx` / `ra6cd`) demonstrated it. Width was also nearly free once the alphabet was counted
properly, and against a TARGETED second preimage — the attack model that matters, since a rule's
hash is public in its own selector — 64 bits is a 2^32 improvement rather than a rounding error.

**Separately, and more important than width: a name must cover its own content.** Vera's marker was
hashed from a curated summary of the parse while one emitted declaration (`animation-range`) was
built from a setting (`scroll`) that summary did not include — so two elements differing only in
scroll range shared a name and the second's rule was silently discarded. Vera now hashes the emitted
rules themselves, with the marker held out of its own selector. Any implementation whose marker is a
hash of *inputs* rather than of *output* is exposed to this independently of width; it is recorded
here because the naming rule is shared surface even though the defect was vera's alone.
