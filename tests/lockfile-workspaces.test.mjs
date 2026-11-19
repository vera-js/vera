/**
 * **The lockfile's entry for every workspace package says what that package's manifest says** (2026-11-18): name,
 * version, and its dependencies and peer dependencies (with their meta). `npx changeset version` bumps each
 * `package.json` and not the lockfile, so after every release the workspace entries fell behind (eleven of them, core at
 * 0.3.1 against 0.4.1) — harmless to `npm ci` today, but a lockfile that disagrees with the manifests is a record nobody
 * can trust. The release loop regenerates it (`npm install --package-lock-only`, docs/RELEASING.md); this holds it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const FIELDS = ['name', 'version', 'dependencies', 'peerDependencies', 'peerDependenciesMeta'];
const workspaces = readdirSync(join(root, 'packages')).filter((dir) => existsSync(join(root, 'packages', dir, 'package.json')));

test('the floor: the workspace packages are read', () => {
  assert.ok(workspaces.length >= 15, `only ${workspaces.length} workspace packages found`);
});

for (const dir of workspaces)
  test(`packages/${dir}: the lockfile's entry matches its manifest, and it is linked`, () => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
    const entry = lock.packages[`packages/${dir}`];
    assert.ok(entry, `package-lock.json has no entry for packages/${dir}: run npm install --package-lock-only`);
    for (const field of FIELDS)
      assert.deepEqual(entry[field], manifest[field], `packages/${dir}: the lockfile's ${field} is not the manifest's — run npm install --package-lock-only`);
    assert.deepEqual(lock.packages[`node_modules/${manifest.name}`], { resolved: `packages/${dir}`, link: true }, `${manifest.name} is not linked to packages/${dir} in the lockfile`);
  });
