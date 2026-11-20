/**
 * **Every bundle imports exactly the `@verajs` packages its own manifest declares** (2026-11-17, when lite became
 * its own package). Development builds keep workspace dependencies EXTERNAL (CLAUDE.md), so an import a package does not
 * declare makes every user install a package nobody told them about — or breaks the install. Derived from each
 * `package.json`, no hand list: a package's development and production bundles together import exactly its declared
 * `dependencies` and `peerDependencies` among `@verajs/*` (its own name aside: a sub-entry importing its main entry), and
 * its production bundles import nothing it does not declare. `@verajs/lite` declares none, so it is held to none.
 * Imports are read by a module parser (es-module-lexer), never by text: the bundles' doc comments quote example imports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';
import { packageDirs } from '../scripts/packages.mjs';

const ROOT = fileURLToPath(new URL('../packages/', import.meta.url));
await init;

/** Packages whose bundles import what their manifests do not declare, each with its reason. Empty: every manifest declares its imports (directives' were added 2026-11-18). */
const KNOWN_UNDECLARED = {};

const bundles = (dir, pattern) => (existsSync(dir) ? readdirSync(dir).filter((f) => pattern.test(f)).map((f) => join(dir, f)) : []);
/** The `@verajs` packages a bundle imports (static and dynamic), by package name. */
const veraImports = (file) =>
  parse(readFileSync(file, 'utf8'))[0].map((i) => i.n).filter((n) => /^@(?:verajs|vera-components|vera-hooks)\//.test(n ?? '')).map((n) => n.split('/').slice(0, 2).join('/'));

const packages = packageDirs().map((path) => path.slice('packages/'.length)).map((dir) => {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  const dev = bundles(join(ROOT, dir, 'dist/development'), /\.js$/);
  const prod = bundles(join(ROOT, dir, 'dist'), /\.min\.js$/);
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})].filter((n) => /^@(?:verajs|vera-components|vera-hooks)\//.test(n)));
  const own = (files) => new Set(files.flatMap(veraImports).filter((n) => n !== manifest.name));
  return { dir, name: manifest.name, declared, dev, prod, devImports: own(dev), prodImports: own(prod) };
}).filter((p) => p.dev.length + p.prod.length > 0);

test('the floor: built bundles found for the packages that build them, lite among them, none empty', () => {
  assert.ok(packages.length >= 10, `only ${packages.length} packages have built bundles — run the build first`);
  assert.ok(packages.some((p) => p.name === '@verajs/lite' && p.dev.length && p.prod.length), '@verajs/lite has both bundles');
  for (const p of packages) for (const file of [...p.dev, ...p.prod]) assert.ok(readFileSync(file).length > 0, `${file} is empty`);
});

for (const name of ['@verajs/lite', '@verajs/static'])
  test(`${name} imports no @verajs package, in any build — it is installed alone`, () => {
    const tier = packages.find((p) => p.name === name);
    assert.ok(tier?.dev.length && tier.prod.length, `CONTROL: ${name} has both bundles`);
    assert.deepEqual([...tier.devImports, ...tier.prodImports], []);
  });

for (const p of packages)
  test(`${p.name}: its bundles import exactly what its manifest declares`, () => {
    const imported = new Set([...p.devImports, ...p.prodImports]);
    const known = new Set(KNOWN_UNDECLARED[p.dir] ?? []);
    const undeclared = [...imported].filter((n) => !p.declared.has(n));
    assert.deepEqual(undeclared.filter((n) => !known.has(n)).sort(), [], `${p.name} imports what it does not declare`);
    assert.deepEqual([...known].filter((n) => !undeclared.includes(n)).sort(), [], `${p.name}'s allowance names imports that are now declared or gone: remove them from KNOWN_UNDECLARED`);
    assert.deepEqual([...p.declared].filter((n) => !imported.has(n)).sort(), [], `${p.name} declares what no bundle imports`);
    assert.deepEqual([...p.prodImports].filter((n) => !p.declared.has(n) && !known.has(n)).sort(), [], `${p.name}'s production bundles import what it does not declare`);
  });

/**
 * **…and carries no other package's SOURCE either.** A package whose build keeps nothing external (`@verajs/lite`) would
 * INLINE an undeclared import rather than leave a specifier, so the specifier rows above cannot see it; its source maps
 * can. Every source a bundle was built from is its own package's, the private shared ones' (`shared-utils`,
 * `shared-types`: inlined everywhere by design), or a dependency's — declared, or a declared dependency's own, since a
 * production build inlines what its dependencies import (core inlines `@verajs/inserts`).
 */
const manifestDeps = (dir) => {
  const path = join(ROOT, dir, 'package.json');
  if (!existsSync(path)) return [];
  const m = JSON.parse(readFileSync(path, 'utf8'));
  return [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.peerDependencies ?? {})].filter((n) => n.startsWith('@verajs/')).map((n) => n.slice('@verajs/'.length));
};
/** A package's own directory, the shared ones, and its dependencies' directories, transitively. */
const allowedFor = (p) => {
  const allowed = new Set([p.dir, 'shared-utils', 'shared-types']);
  const queue = [...manifestDeps(p.dir), ...(KNOWN_UNDECLARED[p.dir] ?? []).map((n) => n.slice('@verajs/'.length))];
  while (queue.length) {
    const dir = queue.shift();
    if (allowed.has(dir)) continue;
    allowed.add(dir);
    queue.push(...manifestDeps(dir));
  }
  return allowed;
};
for (const p of packages)
  test(`${p.name}: its bundles carry only its own, the shared packages' and its dependencies' source`, () => {
    const allowed = allowedFor(p);
    const foreign = new Set();
    for (const file of [...p.dev, ...p.prod].filter((f) => existsSync(`${f}.map`)))
      for (const source of JSON.parse(readFileSync(`${file}.map`, 'utf8')).sources) {
        /** `../src/x.ts` is the package's own; `../../<dir>/src/x.ts` another package's. */
        const dir = /^(?:\.\.\/)+([a-z-]+)\/src\//.exec(source)?.[1];
        if (dir !== undefined && !source.startsWith('../src/') && !allowed.has(dir)) foreign.add(`${dir} (${source})`);
      }
    assert.deepEqual([...foreign], [], `${p.name}'s bundles were built from another package's source`);
  });
