/**
 * Every CDN URL in the repository, checked against the package it names.
 *
 * `tests/buildless-references.test.mjs` verifies that a buildless page's local paths exist, and skips
 * anything remote — `if (isRemote(target)) continue`. That is right for it: the gate must not reach
 * the network. But it leaves every `cdn.jsdelivr.net` URL in the repository checked by nothing at all,
 * including the ones in the very pages that suite reads.
 *
 * These are not incidental links. They are the entire CDN consumption mode, which `CLAUDE.md` calls a
 * baseline rather than a fallback, and they sit in the four most-copied files: `README.md`,
 * `llms.txt`, `docs/features/buildless.md`, and the examples. A renamed bundle breaks all of them
 * silently, and the failure surfaces as a blank page in someone else's browser.
 *
 * Four properties are decidable offline, without asking the network anything:
 *
 * 1. **The package is real.** A typo names a package that does not exist and 404s.
 * 2. **The path exists here.** jsdelivr serves paths out of the published tarball, so a URL is a
 *    claim about a file — and a rollup config renames files.
 * 3. **The path is inside `files`.** A path that exists in the repository but sits outside the
 *    package's `files` allowlist is not in the tarball, so it 404s while looking perfectly correct
 *    to every check that only asks whether the file is here. `@verajs/jsx` publishes `src`, not
 *    `dist`, which is exactly the case where this is easy to get wrong.
 * 4. **A pinned version is not ahead of this repository.** A pin above the local version names
 *    something unpublished.
 *
 * ## Why a pin is not required to be current
 *
 * The obvious rule — a pin must equal the local version — is wrong here, and this is the interesting
 * part. `npx changeset version` bumps `package.json` in the working tree, and CI publishes minutes
 * later on push. Requiring equality would force the docs to name a version npm does not have yet, so
 * the rule meant to keep `llms.txt` working would guarantee a 404 in it during every release.
 *
 * A pin *behind* the local version still resolves and still runs. What it can be is **incompatible**:
 * while `0.x`, MINOR is this project's breaking boundary, not major (`CLAUDE.md`, *Versioning*), so a
 * pin from an older minor demonstrates an API that has since broken. That — not staleness — is the
 * failure worth catching, and it is checked below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Package name -> its directory and manifest. Built from the manifests, never listed here. */
const packages = new Map();
for (const manifest of globSync('packages/*/package.json', { cwd: root })) {
  const json = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  packages.set(json.name, { dir: manifest.replace(/\/package\.json$/, ''), json });
}

/** Every file that could carry a URL: prose, and the buildless pages themselves. */
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    /** `internal/` is a different repository cloned into this tree — see `CLAUDE.md`. */
    if (entry === 'node_modules' || entry === 'dist' || entry === 'internal' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(md|txt|html)$/.test(entry) && !/CHANGELOG/i.test(entry)) files.push(full.slice(root.length));
  }
};
walk(root);

const URL_PATTERN = /cdn\.jsdelivr\.net\/npm\/(@verajs\/[a-z][a-z-]*)(?:@([^/\s"')]+))?\/([^\s"')]+)/g;

const references = [];
for (const file of files)
  for (const [, name, version, path] of readFileSync(join(root, file), 'utf8').matchAll(URL_PATTERN))
    references.push({ file, name, version, path });

/** A pattern that has stopped matching reports every property below as satisfied. */
test('the CDN references are where this expects them', () => {
  assert.ok(
    references.length >= 15,
    `only ${references.length} jsdelivr references found — the pattern has probably stopped matching`
  );
});

test('every CDN url names a package that exists', () => {
  const unknown = references
    .filter((reference) => !packages.has(reference.name))
    .map((reference) => `${reference.file}: no such package "${reference.name}"`);

  assert.deepEqual(unknown, [], `these 404:\n  ${unknown.join('\n  ')}`);
});

test('and a file this repository actually builds', () => {
  const missing = [];
  for (const { file, name, path } of references) {
    const entry = packages.get(name);
    if (!entry) continue;
    if (!existsSync(join(root, entry.dir, path)))
      missing.push(`${file}: ${name} has no ${path}`);
  }

  assert.deepEqual(missing, [], `a renamed bundle breaks every CDN page and nothing else:\n  ${missing.join('\n  ')}`);
});

test('and a path the package actually publishes', () => {
  const outside = [];
  for (const { file, name, path } of references) {
    const entry = packages.get(name);
    if (!entry) continue;
    const allowed = entry.json.files ?? [];
    const top = path.split('/')[0];
    if (!allowed.includes(top))
      outside.push(`${file}: ${name} publishes ${JSON.stringify(allowed)}, so ${path} is not in the tarball`);
  }

  assert.deepEqual(outside, [], `present here, absent from the published package:\n  ${outside.join('\n  ')}`);
});

test('and a pinned version that is neither ahead nor of an older minor', () => {
  /** `[major, minor, patch]`, prerelease suffix discarded — it does not change compatibility here. */
  const parse = (version) => version.split('-')[0].split('.').map(Number);
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const problems = [];

  for (const { file, name, version } of references) {
    const entry = packages.get(name);
    if (!entry || !version) continue;
    const pinned = parse(version);
    const local = parse(entry.json.version);
    if (pinned.some(Number.isNaN)) { problems.push(`${file}: ${name}@${version} is not a version`); continue; }

    if (compare(pinned, local) > 0)
      problems.push(`${file}: ${name}@${version} is ahead of ${entry.json.version} in this repository — npm does not have it`);
    else if (pinned[0] !== local[0] || pinned[1] !== local[1])
      problems.push(`${file}: ${name}@${version} is an older minor than ${entry.json.version}, and while 0.x a minor is the breaking boundary — this demonstrates an API that has since broken`);
  }

  assert.deepEqual(problems, [], `these pins do not describe this repository:\n  ${problems.join('\n  ')}`);
});
