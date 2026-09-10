# Shared conformance fixtures

| artifact | canonical home | pinned by |
| --- | --- | --- |
| keyframe property table, settings, preset names | `packages/directives/motion-vocabulary.json` (generated — never hand-edit; `node scripts/sync-diagnostics.mjs`) | vera gate `--check`; omni vendors + drift-pins |
| `scroll` range grammar corpus (17 cases + exact parsed ranges) | omni: `tests/fixtures/scroll-range-conformance.json` | omni jest snapshot; vera adoption pending |
| play-units rule | this directory (ratified: bare seconds only) | both parsers refuse `'600ms'` |
| motion-object refusal-order corpus (88 cases: refusal code+where sequences, surviving settings, usable rule) | this directory: `motion-refusal-order.json` (omni-contributed 2026-09-09; canonical mirror `omni:tests/fixtures/motion-parse-corpus.json` + parity dumps) | omni: TS↔PHP byte parity + `motionConformance.test.ts`; vera adoption pending — spelling alignment RESOLVED 2026-09-09: omni's `motion-setting-number`/`motion-setting-progress` were adopted because vera's were the defect (prose in the code slot; a built-in hiding behind `module-refused`); every other spelling already matched |
| hash vectors, BOTH widths (published references + generated-CSS rule bodies; `fnv1a64` omni, `fnv1a32` vera — width divergence recorded in DIVERGENCES) | this directory: `hash-vectors.json` (omni-contributed 2026-09-09 as `fnv1a64-vectors.json`; vera added the 32-bit column on adoption, each value verified against shipping `contentHash`) | omni: BigInt + PHP 16-bit-limb pair; vera: `tests/motion-registry-hash.test.mjs` asserts the fnv1a32 column |

Cases added by either side land here or in the named canonical home; the other side vendors.
