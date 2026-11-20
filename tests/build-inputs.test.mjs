/**
 * **Every package's build lists, among its inputs, the source of every other package its bundles inline** (2026-11-18).
 * wireit reruns a build step only when one of its `files` changed, so a step that inlines a workspace package's source
 * without listing it goes stale on a change there — silently, since an incremental build just reuses the old output.
 * `@verajs/hot` inlined `@verajs/shared-utils` and did not list it (found while `@verajs/lite` became a package). What a
 * bundle inlines is read from its source map, never guessed from imports: an import a build keeps external brings in no
 * source, and a doc comment's example import brings in nothing at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageDirs } from '../scripts/packages.mjs';

const ROOT = fileURLToPath(new URL('../packages/', import.meta.url));
/** Which wireit step writes which bundles, by the step's `output` glob. */
const MODES = { development: { dir: 'dist/development', map: /\.js\.map$/, output: /^dist\/development\/\*\.js$/ }, production: { dir: 'dist', map: /\.min\.js\.map$/, output: /^dist\/\*\.min\.js$/ } };

const rows = [];
for (const dir of packageDirs().map((path) => path.slice('packages/'.length))) {
  const manifest = join(ROOT, dir, 'package.json');
  if (!existsSync(manifest)) continue;
  const wireit = JSON.parse(readFileSync(manifest, 'utf8')).wireit;
  if (!wireit) continue;
  for (const [mode, m] of Object.entries(MODES)) {
    const step = Object.entries(wireit).find(([, c]) => (c.output ?? []).some((o) => m.output.test(o)));
    const out = join(ROOT, dir, m.dir);
    if (!step || !existsSync(out)) continue;
    const maps = readdirSync(out).filter((f) => m.map.test(f));
    const inlined = new Set(
      maps.flatMap((f) => JSON.parse(readFileSync(join(out, f), 'utf8')).sources)
        .map((s) => /^(?:\.\.\/)+([a-z-]+)\/src\//.exec(s)?.[1])
        .filter((n) => n !== undefined && n !== dir)
    );
    rows.push({ dir, mode, step: step[0], files: step[1].files ?? [], inlined: [...inlined], maps: maps.length });
  }
}

test('the floor: built bundles with source maps were found for the packages that build them', () => {
  assert.ok(rows.length >= 20, `only ${rows.length} build steps with maps — run the build first`);
  assert.ok(rows.some((r) => r.inlined.includes('shared-utils')), 'some bundle inlines shared-utils, so the rows below examine something');
});

for (const r of rows)
  test(`${r.dir} ${r.step}: lists the source of every package its ${r.mode} bundles inline`, () => {
    const missing = r.inlined.filter((n) => !r.files.some((glob) => new RegExp(`^(?:\\.\\./)+${n}/src/`).test(glob)));
    assert.deepEqual(missing, [], `${r.dir}'s ${r.step} inlines ${missing.join(', ')} but does not list ../<pkg>/src/** in its wireit files: an incremental build would go stale`);
  });
