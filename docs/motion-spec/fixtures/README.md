# Shared conformance fixtures

| artifact | canonical home | pinned by |
| --- | --- | --- |
| keyframe property table, settings, preset names | `packages/directives/motion-vocabulary.json` (generated — never hand-edit; `node scripts/sync-diagnostics.mjs`) | vera gate `--check`; omni vendors + drift-pins |
| `scroll` range grammar corpus (17 cases + exact parsed ranges) | omni: `tests/fixtures/scroll-range-conformance.json` | omni jest snapshot; vera adoption pending |
| play-units rule | this directory (ratified: bare seconds only) | both parsers refuse `'600ms'` |

Cases added by either side land here or in the named canonical home; the other side vendors.
