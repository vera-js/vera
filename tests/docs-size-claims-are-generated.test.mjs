/**
 * **A size stated in prose is a size nothing regenerates.**
 *
 * `scripts/sync-size-claims.mjs` owns every figure wrapped in a `<!--size:key-->…<!--/size:key-->`
 * marker and the gate re-checks all of them, which is why none of those has ever drifted. A figure
 * written as plain text is outside that, and three were: `keyed` was quoted as **365 B** in both
 * `llms.txt` and the renderer's README when the module is 581, and `computed` as **233 B** when it is
 * 241. All three predated the module moving to its own entry, and all three read as current.
 *
 * This is the scope problem the audit kept finding: a guard that works perfectly on what it can see.
 * The generator's `TARGETS` list is complete — every file holding a marker is in it — and that was
 * never the gap. The gap was claims that never became markers.
 *
 * Deliberately narrow: only a number qualified by "gzip" is caught, because that is the form a live
 * module-size claim takes. A **measured delta** is a different thing and cannot come from a bundle,
 * so those are listed below with what they measure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

/** What this repo publishes, and therefore what a reader will act on. */
const PUBLISHED = ['README.md', 'llms.txt', ...globSync('docs/features/*.md', { cwd: root }), ...globSync('packages/*/README.md', { cwd: root })];

/**
 * Figures that are **deltas**, not module sizes, so no bundle can generate them. Each is the cost of
 * a feature *within* a bundle, measured by building with and without it.
 */
const MEASURED_DELTAS = {
  '116 B gzipped': 'packages/renderer/README.md — the directive protocol inside the renderer, not a module',
  /**
   * Found by widening the pattern below, having sat unnoticed in a published README. It is written
   * `**5 B** gzipped`, with the emphasis closing between the unit and the word, and the old pattern
   * required whitespace there — so a live claim was invisible to the guard that exists to find them.
   *
   * The README states its own provenance: measured 2026-08-27 by deleting the `_$apply$` branch and
   * rebuilding, as a difference rather than a pair of totals, "and nothing regenerates it, so it is
   * dated". That is precisely what this list is for.
   */
  '5 B gzipped': 'packages/renderer/README.md — what the directive protocol adds to the renderer, a delta',
};

const MARKED = /<!--size:[\w.-]+-->[\s\S]*?<!--\/size:[\w.-]+-->/g;

/**
 * **Every qualifier a live size claim is written with, not only `gzip`.**
 *
 * This matched `gzip` alone, "because that is the form a live module-size claim takes". It is the
 * *dominant* form rather than the only one — "1.4 KB, minified", "1400 bytes after minification" and
 * "1.4 KB compressed" all read as current claims about a shipped bundle, and all three slipped
 * through. A guard whose reach is narrower than its stated reason is the shape this audit keeps
 * finding, and it is worth less here than elsewhere: the whole point of this file is that a figure
 * nothing regenerates will eventually be wrong.
 *
 * A **delta** still has no qualifier at all — "292 B recovered", "16 B" — so widening the qualifier
 * list cannot start catching those, and `MEASURED_DELTAS` stays the place for the one that is
 * qualified.
 */
const SIZE_QUALIFIER = 'gzip[a-z]*|minified|minifies|minification|compressed|brotli|minzipped';
/**
 * `\W{0,3}` lets markdown emphasis and a comma sit between the unit and the qualifier — the figure is
 * almost always written `**1.4 KB**, minified`. `(?:after |when )?` is the only word allowed through,
 * because anything looser starts matching a delta whose sentence happens to mention compression later.
 */
const GZIP_SIZE = new RegExp(
  `\\b\\d[\\d.,]*\\s*(?:B|KB|bytes?)\\W{0,3}\\s*(?:after |when )?(?:${SIZE_QUALIFIER})`,
  'gi'
);

/**
 * The matched text is the key into `MEASURED_DELTAS`, so it has to be the *claim* rather than however
 * the surrounding markdown happened to bold it. `116 B gzipped` is written `**116 B** gzipped` in one
 * README and `**116 B gzipped**` in another; without stripping the emphasis the exclusion matches one
 * and not the other.
 *
 * `\b` on the number matters for the same reason: without it the engine could begin a match part-way
 * through `116`, yielding `5 B** gzipped` — a key nothing excludes, reported as a drifting claim while
 * the real figure sat in the list all along.
 */
const asClaim = (found) => found.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

test('the published docs are being read', () => {
  assert.ok(PUBLISHED.length > 8, `found ${PUBLISHED.length} published docs`);
});

test('every gzipped size in the published docs comes from the generator', () => {
  const problems = [];
  for (const file of PUBLISHED) {
    const outsideMarkers = readFileSync(root + file, 'utf8').replace(MARKED, '');
    for (const [found] of outsideMarkers.matchAll(GZIP_SIZE)) {
      const claim = asClaim(found);
      if (!MEASURED_DELTAS[claim]) problems.push(`${file}: "${claim}" is stated in prose`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `these will drift, because nothing regenerates them:\n  ${problems.join('\n  ')}\n` +
      `Wrap each in <!--size:key-->…<!--/size:key--> so sync-size-claims.mjs owns it, or — if it is a ` +
      `measured delta rather than a module size — add it to MEASURED_DELTAS with what it measures.`
  );
});
