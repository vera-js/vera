/**
 * **The source maps this repo publishes were wrong in two ways, and nothing noticed.**
 *
 * They ship — `sourcesContent` and all, which is most of `@verajs/renderer`'s packed size — so a
 * consumer stepping into the framework is meant to land in the TypeScript. Both defects broke that
 * quietly, because a wrong map does not fail, it just points somewhere else.
 *
 * 1. **Every `sources` path resolved outside the checkout.** `../../../../src/store/store.ts` from
 *    `packages/core/dist/` is `/Users/…/dev/src/…`; the development maps climbed a level further
 *    again. A browser prefers the embedded `sourcesContent` and so nothing appeared broken, but
 *    anything resolving `sources` on disk got nothing, and a published path describing a directory
 *    tree that exists on one machine is wrong on its own terms.
 * 2. **Three `renderChunk` hooks edited the code and returned `map: null`.** That return value is a
 *    claim that the transform moved nothing and Rollup's existing map still applies. Two of them
 *    deleted whole lines — `eslint-disable-next-line` and `TODO` comments — which shifts *every*
 *    line after the first one. Five such comments in the sources put core's and the renderer's maps
 *    one line out: asking the map where `const untrack` came from returned the `*​/` above it.
 *
 * The fix for the second is to empty those lines rather than delete them, which makes `map: null`
 * true; terser drops them from the production bundle, and the point was never the byte, it was not
 * shipping the comment.
 *
 * The line check works without decoding a single VLQ: Rollup emits one `;`-separated group per
 * generated line, so a map describing more lines than the file has is exactly the defect, and a
 * hook that deletes a line produces it every time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** Every `.js.map` the build wrote, across both conditions. */
const maps = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js.map')) maps.push(full);
  }
};
for (const pkg of readdirSync(join(root, 'packages'))) {
  const dist = join(root, 'packages', pkg, 'dist');
  if (existsSync(dist)) walk(dist);
}

test('the build actually produced source maps', () => {
  assert.ok(maps.length > 10, `expected the built maps, found ${maps.length}`);
});

test('every source a map names resolves to a real file', () => {
  const problems = [];
  for (const file of maps) {
    const map = JSON.parse(readFileSync(file, 'utf8'));
    for (const source of map.sources)
      if (!existsSync(resolve(dirname(file), source)))
        problems.push(`${relative(root, file)} names "${source}", which resolves to nothing`);
  }
  assert.deepEqual(problems, [], `source maps point outside the repository:\n  ${problems.join('\n  ')}`);
});

test('every map carries the source it names, so a consumer can read it', () => {
  const problems = [];
  for (const file of maps) {
    const map = JSON.parse(readFileSync(file, 'utf8'));
    if (!map.sourcesContent || map.sourcesContent.length !== map.sources.length)
      problems.push(`${relative(root, file)} has ${map.sources.length} sources and ${map.sourcesContent?.length ?? 0} contents`);
    else if (map.sourcesContent.some((text) => !text))
      problems.push(`${relative(root, file)} has an empty sourcesContent entry`);
  }
  assert.deepEqual(problems, [], `published maps are not self-contained:\n  ${problems.join('\n  ')}`);
});

test('no map describes more lines than its file has', () => {
  const problems = [];
  for (const file of maps) {
    const code = readFileSync(file.slice(0, -4), 'utf8').split('\n').length;
    const described = JSON.parse(readFileSync(file, 'utf8')).mappings.split(';').length;
    if (described > code)
      problems.push(
        `${relative(root, file)}: describes ${described} lines, the file has ${code} — ` +
          `a renderChunk deleted lines and returned map: null`
      );
  }
  assert.deepEqual(problems, [], `source maps are shifted against their own output:\n  ${problems.join('\n  ')}`);
});

test('the comments the build strips really are gone from the output', () => {
  const problems = [];
  for (const file of maps) {
    const code = readFileSync(file.slice(0, -4), 'utf8');
    for (const pattern of [/eslint-disable-next-line/, /\/\/\s*TODO/])
      if (pattern.test(code)) problems.push(`${relative(root, file.slice(0, -4))} still contains ${pattern}`);
  }
  assert.deepEqual(problems, [], `blanking the line must not stop it being blanked:\n  ${problems.join('\n  ')}`);
});
