/**
 * **A pinned version in the docs is a live load, and it went stale.**
 *
 * `llms.txt`'s buildless recipe pinned `@verajs/core@0.1.1` while core was publishing **0.2.1** —
 * across the boundary this project treats as breaking (`CLAUDE.md`, *Versioning*: while 0.x, MINOR
 * is where npm already draws the line). Paired with `@verajs/renderer@0.1.5`, which was also
 * pinned two patches back, the recipe told a reader to load a combination nobody has ever run.
 *
 * Pinning is right — an unpinned CDN URL is a page that changes under you — so the rule cannot be
 * "don't pin". It is that **a pinned version must be the one this repo currently publishes**, so
 * the documented combination is the combination the tests cover.
 *
 * Deliberately narrow. A `CHANGELOG` names old versions because that is what a changelog is for, and
 * `docs/RELEASING.md` shows a tag as an example. Only a URL a browser will actually fetch is held to
 * this, because only that one can be wrong in a way a reader discovers the hard way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const versions = {};
for (const entry of readdirSync(join(root, 'packages'))) {
  const file = join(root, 'packages', entry, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (!pkg.private) versions[pkg.name] = pkg.version;
  } catch {
    /** Not every directory under packages/ is a package. */
  }
}

/** Every `.md`, `.txt` and `.html` in the tree, minus dependencies and build output. */
const docs = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'internal') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(md|txt|html)$/.test(entry)) docs.push(full);
  }
};
walk(root);

test('every @verajs package this repo publishes has a version to check against', () => {
  assert.ok(Object.keys(versions).length >= 8, `found ${Object.keys(versions).length} published packages`);
});

test('a CDN URL in the docs pins the version this repo publishes', () => {
  const problems = [];
  for (const file of docs) {
    for (const [url, name, pinned] of readFileSync(file, 'utf8').matchAll(
      /https:\/\/[^"'\s)]*\/(@verajs\/[a-z-]+)@(\d+\.\d+\.\d+)[^"'\s)]*/g
    )) {
      const current = versions[name];
      if (current === undefined) problems.push(`${relative(root, file)}: no such package "${name}" — ${url}`);
      else if (current !== pinned)
        problems.push(`${relative(root, file)}: pins ${name}@${pinned}, which is now ${current}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `a documented CDN URL loads a version this repo no longer publishes:\n  ${problems.join('\n  ')}\n` +
      `Re-pin them, or the recipe teaches a combination nothing tests.`
  );
});
