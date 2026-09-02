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
 * Brand-qualified on purpose. The exposed surface is the bare marker
 * attribute — `querySelectorAll` finds every animated element by it — and a
 * single generic word there is a plausible collision on a WordPress page
 * sharing a DOM with plugins nobody controls. `vera-` is not.
 *
 * Measured against the alternative it was chosen over — `data-motion`, the
 * generic word — because a cost is only a cost against something. Re-measured
 * 2026-08-30 on the demo, which now carries **127** of these attributes:
 * **11 bytes gzipped on the page** and **4 in the library**, against 635 raw
 * bytes that are not real, because gzip dedupes a string repeating 127 times
 * almost perfectly.
 *
 * It said "12 bytes across a page with 82 attributes" and did not say what it
 * was 12 bytes dearer *than* — which is enough to price the wrong thing: a
 * first re-measurement compared against `data-vm`, a name nobody proposed, and
 * got 29.
 */
export const NAMESPACE = 'vera-motion';

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
