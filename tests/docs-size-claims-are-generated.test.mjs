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
};

const MARKED = /<!--size:[\w.-]+-->[\s\S]*?<!--\/size:[\w.-]+-->/g;
const GZIP_SIZE = /[\d\s.,]*\d\s*(?:B|KB)\s+gzip[a-z]*/g;

test('the published docs are being read', () => {
  assert.ok(PUBLISHED.length > 8, `found ${PUBLISHED.length} published docs`);
});

test('every gzipped size in the published docs comes from the generator', () => {
  const problems = [];
  for (const file of PUBLISHED) {
    const outsideMarkers = readFileSync(root + file, 'utf8').replace(MARKED, '');
    for (const [found] of outsideMarkers.matchAll(GZIP_SIZE)) {
      const claim = found.trim().replace(/\s+/g, ' ');
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
