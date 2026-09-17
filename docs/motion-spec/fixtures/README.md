# Shared conformance fixtures

| artifact | canonical home | pinned by |
| --- | --- | --- |
| keyframe property table, settings, preset names | `packages/directives/motion-vocabulary.json` (generated — never hand-edit; `node scripts/sync-diagnostics.mjs`) | vera gate `--check`; omni vendors + drift-pins |
| `scroll` range grammar corpus (17 cases + exact parsed ranges) | omni: `tests/fixtures/scroll-range-conformance.json` | omni jest snapshot; vera adoption pending |
| play-units rule | this directory (ratified: bare seconds only) | both parsers refuse `'600ms'` |
| motion-object refusal-order corpus (123 cases: refusal code+where sequences, surviving settings, usable rule) | this directory: `motion-refusal-order.json` (omni-contributed 2026-09-09; canonical mirror `omni:tests/fixtures/motion-parse-corpus.json` + parity dumps) | omni: TS↔PHP byte parity + `motionConformance.test.ts`; **vera: `tests/motion-spec-corpus.test.mjs` (adopted 2026-09-14)** — runs every case against `parseMotion`, asserting the refusal code+where sequence, the surviving settings and the usable verdict, with the still-open divergences pinned BY NAME AND COUNT so a new one fails the gate and a closed one is a deliberate edit. Read that file's `KNOWN` table before changing a fixture. Spelling alignment RESOLVED 2026-09-09: omni's `motion-setting-number`/`motion-setting-progress` were adopted because vera's were the defect (prose in the code slot; a built-in hiding behind `module-refused`); every other spelling already matched |
| hash vectors (published references + generated-CSS rule bodies; `fnv1a64` is now BOTH engines — vera converged 2026-09-13, leaving only an encoding divergence, recorded in DIVERGENCES. The `fnv1a32` column is historical: vera's pre-convergence naming, asserted by nothing) | this directory: `hash-vectors.json` (omni-contributed 2026-09-09 as `fnv1a64-vectors.json`) | omni: BigInt + PHP 16-bit-limb pair; vera: `tests/motion-registry-hash.test.mjs` asserts the `fnv1a64` column by DECODING a rule name back to its 64 bits (no hex twin ships) |

Cases added by either side land here or in the named canonical home; the other side vendors.
