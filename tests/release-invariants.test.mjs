/**
 * The seven things `docs/RELEASING.md` says break publishing, checked on every run.
 *
 * Every one of them is a property of files on disk, and none was verified by anything. The gate
 * covers versions against tags (`scripts/tag-release.mjs --check`); it did not cover the trust
 * configuration those rest on.
 *
 * **The failure mode is what makes them worth a test.** None of these breaks a build, a type-check or
 * a suite. They break a *release* — and `RELEASING.md` warns in its own words that "a green Release
 * run does not mean it did", so the first sign of a broken invariant is a version that quietly never
 * appeared on the registry, discovered later by someone whose install did not resolve.
 *
 * Each test names the invariant it is holding, so a failure sends the reader to the paragraph that
 * explains why it matters rather than to this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

const manifests = globSync('packages/*/package.json', { cwd: root })
  .map((file) => ({ file, json: JSON.parse(read(file)) }))
  .sort((a, b) => a.json.name.localeCompare(b.json.name));
const published = manifests.filter((m) => !m.json.private);

/**
 * *"`release.yml` must keep its name. The trusted-publisher binding on each published package names
 * `vera-js/vera` + `release.yml`."* Renaming or moving the file makes every publish fail until every
 * binding is recreated.
 */
test('the release workflow is still called release.yml, and can produce provenance', () => {
  const path = '.github/workflows/release.yml';
  assert.ok(existsSync(join(root, path)), `${path} is gone — every trusted-publisher binding names it`);
  const workflow = read(path);
  assert.match(
    workflow,
    /id-token:\s*write/,
    'the release workflow does not request `id-token: write`, so npm cannot attest provenance'
  );
});

/**
 * *"`repository.url` must stay `git+https://github.com/vera-js/vera.git` in every manifest. The
 * registry compares it against the provenance statement and rejects a mismatch with a 422."*
 */
test('every published manifest points at the repository provenance expects', () => {
  const REQUIRED = 'git+https://github.com/vera-js/vera.git';
  const wrong = published
    .map(({ file, json }) => {
      const url = typeof json.repository === 'string' ? json.repository : json.repository?.url;
      return url === REQUIRED ? null : `${json.name} (${file}): ${JSON.stringify(url)}`;
    })
    .filter(Boolean);
  assert.deepEqual(wrong, [], `repository.url must be ${REQUIRED}; the registry answers 422 otherwise:\n  ${wrong.join('\n  ')}`);

  /** And `directory`, which points provenance at the package inside the monorepo. */
  const misdirected = published
    .filter(({ json }) => typeof json.repository === 'object' && !String(json.repository.directory ?? '').startsWith('packages/'))
    .map(({ json }) => `${json.name}: ${JSON.stringify(json.repository.directory)}`);
  assert.deepEqual(misdirected, [], `repository.directory should name the package's folder:\n  ${misdirected.join('\n  ')}`);
});

/**
 * *"Never add an `NPM_TOKEN`. If publishing fails, the fix is in the trust configuration, not a
 * credential."* A token would work, which is exactly why this is worth a test: nothing would go
 * wrong at the moment it was added, and provenance would quietly stop being attested.
 */
test('no workflow reaches for an NPM_TOKEN', () => {
  const offenders = globSync('.github/workflows/*.yml', { cwd: root }).filter((file) => /NPM_TOKEN/.test(read(file)));
  assert.deepEqual(offenders, [], `these reference NPM_TOKEN, which the release design forbids: ${offenders.join(', ')}`);
});

/** *"`shared-types` and `shared-utils` are `private: true` and inlined into every build."* */
test('the two inlined packages are still private', () => {
  for (const name of ['@verajs/shared-types', '@verajs/shared-utils']) {
    const found = manifests.find((m) => m.json.name === name);
    assert.ok(found, `${name} is named in the release invariants and no longer exists`);
    assert.equal(found.json.private, true, `${name} must be private: true — it is inlined, never published`);
  }
});

/**
 * A scoped package defaults to a *restricted* publish. Getting this wrong does not fail the build;
 * it publishes something nobody can install without auth, or fails the publish outright.
 */
test('every published scoped package asks to be published publicly', () => {
  const wrong = published
    .filter(({ json }) => json.name.startsWith('@') && json.publishConfig?.access !== 'public')
    .map(({ json }) => `${json.name}: ${JSON.stringify(json.publishConfig?.access)}`);
  assert.deepEqual(wrong, [], `a scoped package needs publishConfig.access "public":\n  ${wrong.join('\n  ')}`);
});

/** Changesets drives the version bumps, so a published package it ignores never gets one. */
test('changesets covers every published package and publishes publicly', () => {
  const config = JSON.parse(read('.changeset/config.json'));
  assert.equal(config.access, 'public', 'changesets would publish restricted');
  const ignored = new Set(config.ignore ?? []);
  const missed = published.map(({ json }) => json.name).filter((name) => ignored.has(name));
  assert.deepEqual(missed, [], `changesets ignores these published packages, so they never get a version bump: ${missed.join(', ')}`);
});

/** And the ordinary requirements a publish fails on, which are cheap to lose in a new package. */
test('every published package has what npm needs to publish it', () => {
  const problems = [];
  for (const { file, json } of published) {
    const dir = file.replace(/\/package\.json$/, '');
    if (!json.version) problems.push(`${json.name}: no version`);
    if (!json.license) problems.push(`${json.name}: no license`);
    if (!json.files?.length) problems.push(`${json.name}: no files array, so npm publishes by its own defaults`);
    if (!existsSync(join(root, dir, 'README.md'))) problems.push(`${json.name}: no README.md`);
  }
  assert.deepEqual(problems, [], `these would publish wrong or not at all:\n  ${problems.join('\n  ')}`);
});
