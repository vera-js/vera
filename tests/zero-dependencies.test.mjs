/**
 * The zero-dependency claim, counted rather than recited.
 *
 * `docs/features/zero-dependencies.md` is a public claim, and `CLAUDE.md` says every claim there
 * must stay measured and reproducible. It said **"all seven published packages"** and named seven —
 * written before `reactivity` and `styles` were split out of core in 0.2.0, by which point there
 * were eleven. The headline held (every one of the eleven really does declare zero third-party
 * dependencies); what had gone stale was the count, the list, and the verification command printed
 * beside it, which named the same seven. Running it confirmed the claim about a subset while reading
 * as though it covered everything.
 *
 * So this enumerates. A package added to the repo is covered the day it exists, and the number in the
 * document is checked against the number on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

const packages = globSync('packages/*/package.json', { cwd: root })
  .map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')))
  .filter((manifest) => !manifest.private)
  .sort((a, b) => a.name.localeCompare(b.name));

test('every published package declares zero third-party dependencies', () => {
  assert.ok(packages.length >= 7, `only found ${packages.length} published packages`);
  const offenders = [];
  for (const manifest of packages) {
    /**
     * **Every field npm installs from, not the two obvious ones.**
     *
     * `dependencies` and `peerDependencies` were checked; `optionalDependencies` and
     * `bundledDependencies` were not, and a one-line manifest edit could add either while this test
     * went on reporting zero. `bundledDependencies` is the sharpest of the four — npm packs those
     * **inside the tarball**, so a consumer receives the dependency whether they resolve it or not,
     * which is the most direct contradiction of the claim this file defends.
     *
     * `devDependencies` stays out, and the document says so: they never reach a consumer.
     *
     * `bundleDependencies` is npm's other accepted spelling of the same field, and an array rather
     * than an object — `Object.keys` reads both shapes, since the keys of an array are its indices
     * and the *values* are the names. Hence the flatten below.
     */
    const declared = [
      ...Object.entries(manifest.dependencies ?? {}).map(([name]) => name),
      ...Object.entries(manifest.peerDependencies ?? {}).map(([name]) => name),
      ...Object.entries(manifest.optionalDependencies ?? {}).map(([name]) => name),
      ...(Array.isArray(manifest.bundledDependencies) ? manifest.bundledDependencies : Object.keys(manifest.bundledDependencies ?? {})),
      ...(Array.isArray(manifest.bundleDependencies) ? manifest.bundleDependencies : Object.keys(manifest.bundleDependencies ?? {})),
    ];
    const third = declared.filter((name) => !String(name).startsWith('@verajs/'));
    if (third.length) offenders.push(`${manifest.name}: ${[...new Set(third)].join(', ')}`);
  }
  assert.deepEqual(offenders, [], `these published packages depend on third-party code:\n  ${offenders.join('\n  ')}`);
});

test('the document names every published package, and counts them right', () => {
  const doc = readFileSync(new URL('../docs/features/zero-dependencies.md', import.meta.url), 'utf8');

  const missing = packages
    .map((manifest) => manifest.name.replace('@verajs/', ''))
    .filter((short) => !doc.includes(`\`${short}\``));
  assert.deepEqual(missing, [], `published packages the document does not name: ${missing.join(', ')}`);

  /** The written-out number, so "eleven" cannot drift from eleven. */
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
  const claimed = /All (\w+) published packages/.exec(doc);
  assert.ok(claimed, 'the document no longer states how many published packages there are');
  assert.equal(
    claimed[1],
    WORDS[packages.length],
    `the document says "${claimed[1]}" published packages and there are ${packages.length}`
  );
});

/**
 * **What a consumer installs carries its license text.** Every published manifest says `MIT`, and MIT's one condition is
 * that the notice travels with the code — npm packs a package's own `LICENSE`, never the repository root's. `lite` and
 * `static` reached their first release without one (2026-11-19); every other published package had it.
 */
test('every published package ships the LICENSE its manifest names', () => {
  const dirs = globSync('packages/*/package.json', { cwd: root })
    .filter((file) => !JSON.parse(readFileSync(join(root, file), 'utf8')).private)
    .map((file) => file.replace(/\/package\.json$/, ''));
  assert.ok(dirs.length >= 7, `the scan is broken, not the list: it found ${dirs.length} published packages`);
  assert.equal(dirs.length, packages.length, 'CONTROL: the same published packages as the rows above');
  const reference = readFileSync(join(root, 'LICENSE'), 'utf8');
  const missing = dirs.filter((dir) => {
    try {
      return readFileSync(join(root, dir, 'LICENSE'), 'utf8') !== reference;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], 'a published package without the repository\'s LICENSE (or with a different one)');
});
