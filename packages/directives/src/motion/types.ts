/**
 * The motion pack's shared types — the import-graph ROOT.
 *
 * This module imports nothing from inside the pack (CODE-PRINCIPLES §1, Types): every arrow points
 * in, none point out, so no import cycle can pass through here. Cross-file and public types belong
 * in this file; a type one file uses stays in that file, unexported.
 *
 * Seeded by the write-path build (registry first); the vocabulary types spread across `schema.ts`,
 * `parse.ts`, `runtime.ts` and `region.ts` migrate here stage by stage as the rewrite reshapes
 * them — each moves once, when it changes anyway, rather than twice.
 */

/** A tree generated rules are delivered into. Keyframe names resolve per tree scope (measured:
 *  `tests/browser/keyframes-tree-scope.test.js`), so this is the registry's unit of adoption. */
export type SheetRoot = Document | ShadowRoot;
