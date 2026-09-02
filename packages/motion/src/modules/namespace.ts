/**
 * The one namespace token, alone in its own module.
 *
 * Alone deliberately. `scroll-to` needs nothing from the schema but this
 * string, and importing it from `schema.ts` dragged the entire animation table
 * into that artifact — every property name, every setting, every preset — for
 * one word. Rollup could not shake them because `schema.ts` builds its lookup
 * maps at module scope, and `new Map(...)` is not provably side-effect free,
 * so the maps are retained and they reference the tables.
 *
 * Measured: adding a single settings row grew `scroll-to.js` by 31 bytes, an
 * artifact that cannot animate anything. That is what made the leak visible.
 *
 * **Re-measured 2026-08-28, and the first paragraph no longer reproduces.**
 * Importing `NAMESPACE` from `schema.ts` today produces a byte-identical
 * `scroll-to.js` — 8,688 raw, 3,316 gzipped either way. The re-export shakes
 * clean now.
 *
 * This file stays, because the failure mode did not go away with the symptom.
 * Any actual *use* of a schema value still drags the table: one
 * `PROPERTIES.map(...)` inside `init()` takes the artifact to **3,956
 * gzipped** — and the budget is 4,096, so it passes. `scripts/size.js` checks
 * for the vocabulary itself for that reason.
 *
 * `schema.ts` re-exports both names, so nothing else has to know this file
 * exists and there is still one definition (principle #5).
 */

/**
 * `vm`, renamed from `vera-motion` (Brian, 2026-09-02) while the package has
 * zero users — the one moment a rename is free. The product is hand-authored
 * attributes, so the prefix is typed on every element of every page anyone
 * builds with this: `data-vm-translate-y` against `data-vm-translate-y`
 * is eight characters of authoring feel, times everything, forever. The scroll
 * animation genre already speaks terse (`data-aos`, `data-sal`, `data-rellax-*`),
 * and a search found no library claiming `data-vm-*`.
 *
 * This refines the earlier decision rather than reversing it. The old comment
 * argued a "single generic word is a plausible collision on a WordPress page"
 * — an argument against `data-motion`, the generic English word, which stands.
 * `vm` is not a generic word; its collision surface is `data-aos`-shaped, not
 * `data-motion`-shaped. What is knowingly traded away is view-source
 * provenance: `data-vm` said whose attribute it was, `data-vm-` only
 * greps uniquely. Wire cost was never the axis — measured 2026-08-30, the long
 * name cost 29 bytes gzipped over this one on a 127-attribute page, because
 * gzip dedupes a repeating string almost perfectly.
 *
 * The token also mints the event names (`vm:active`, `vm:idle`,
 * `vm:complete`): one namespace, one story, and a colon-qualified event name
 * collides with nothing. Bundle filenames (`vera-motion.min.js`) are NOT this
 * namespace and did not move — artifacts are addressed by package, attributes
 * by prefix. If a sibling package ever needs element attributes, the pattern
 * leaves it room (`data-v?-*`).
 */
export const NAMESPACE = 'vm';

/** Every attribute this library reads starts with this. */
export const ATTRIBUTE_PREFIX = `data-${NAMESPACE}`;

/**
 * The marker `scroll-to` puts on every element one of its links points at.
 *
 * Here rather than in `scrollTo.ts` because **both** entry points need it and
 * for opposite reasons: one writes it, and the other has to know not to
 * complain about it. The two share a namespace by design and neither imports
 * the other, so a name only one of them knew was a name the other reported as
 * a stranger — `parse.ts` refuses anything prefixed with the namespace that is
 * not a registered setting, which is right for an attribute an author wrote
 * and wrong for one this library wrote itself. Every scroll-to target that was
 * also animated carried a spurious unknown-attribute refusal.
 */
export const SCROLL_TARGET_ATTRIBUTE = `data-${NAMESPACE}-scroll-target`;

/**
 * What every attribute *other than the bare marker* starts with.
 *
 * Hoisted because it is tested once per attribute per element, and terser does
 * not fold `` `${ATTRIBUTE_PREFIX}-` `` — the minified output builds the string
 * again on every iteration. Three separate loops were doing that, and init
 * cost measurably more for it.
 */
export const SUB_PREFIX = `${ATTRIBUTE_PREFIX}-`;
