/**
 * The `exports` map, the two builds, and the declarations — four descriptions of one entry.
 *
 * `package.json` resolves `exports.development` to `dist/development/*.js`, `exports.default` to
 * `dist/*.min.js`, and `exports.types` to a **single** `.d.ts` describing both. Production is a
 * different program: `__DEV__` folds to `false` and its branches are deleted, properties are mangled,
 * workspace dependencies are inlined.
 *
 * ## The boundary this sits on
 *
 * `tests/consumer/*.ts` compiles against the declarations and **never runs**. Every other suite runs
 * against **one artifact at a time** and never reads a declaration. Nothing reads the `exports` map at
 * all — `tests/dist.mjs` builds a path from a package name, and `tests/docs-imports.test.mjs` keeps a
 * hand-written specifier-to-bundle table. So the map npm actually resolves is described by three
 * guards and verified by none, and an export folded out of production would leave the declarations
 * wrong for exactly the people who install the package, with every check green.
 *
 * That is pass 87's shape: *a boundary shared by two guards belongs to neither.*
 *
 * ## The list is derived, because a hand-written one is its own boundary
 *
 * This suite listed its twelve entries by hand for exactly one pass, and in that pass it already
 * missed `@verajs/reactivity/computed` — a subpath with a full development/production/types triple
 * that simply was not typed into the array.
 *
 * So the entries come from the `exports` maps themselves. A subpath added tomorrow is covered the day
 * it is written.
 *
 * ## Re-exports carry types without a local declaration
 *
 * Core's `inserts` and `wire` come from `@verajs/inserts` through `export * from`, so no
 * `declare const` mentions them and they are typed regardless. The question is whether a consumer
 * gets a type, not where it is written.
 *
 * ## Deliberately partial entries are skipped, not failed
 *
 * `@verajs/renderer/profiler` has no `development` condition: its instrumentation lives behind
 * `__DEV__`, so a production bundle would collect nothing, and `packages/renderer/rollup.config.js`
 * says so. `@verajs/ssr` publishes its source with no build at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'location', 'history', 'MutationObserver', 'ShadowRoot', 'NodeFilter',
])
  globalThis[key] = dom.window[key];

const root = fileURLToPath(new URL('..', import.meta.url));
const manifests = globSync('packages/*/package.json', { cwd: root });

/** Every `exports` target, and every entry whose development and production builds are distinct. */
const targets = [];
const entries = [];
const reachable = new Map();

for (const manifest of manifests) {
  const dir = dirname(manifest);
  const json = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  if (json.private) continue;
  const reached = reachable.get(dir) ?? new Set();
  reachable.set(dir, reached);

  for (const [subpath, value] of Object.entries(json.exports ?? {})) {
    const name = json.name + subpath.slice(1);
    const conditions = typeof value === 'string' ? { default: value } : value;
    if (typeof conditions !== 'object' || conditions === null) continue;

    for (const [condition, target] of Object.entries(conditions))
      if (typeof target === 'string' && target.startsWith('.')) {
        targets.push({ name, condition, target, path: join(dir, target) });
        reached.add(join(dir, target).replace(/\\/g, '/'));
      }

    if (conditions.development && conditions.default && conditions.development !== conditions.default)
      entries.push({ name, dir, ...conditions });
  }
}

/** A derived list that derived nothing passes every check below, so refuse an empty one. */
assert.ok(manifests.length > 0, 'no package manifests were found');
assert.ok(
  entries.some((entry) => entry.name === '@verajs/core') && entries.length > 5,
  `the exports maps yielded only ${entries.length} entries — the derivation is broken, not the packages`
);

const missingTargets = targets
  .filter(({ path }) => !existsSync(join(root, path)))
  .map(({ name, condition, target }) => `${name} [${condition}] -> ${target}`);

/** Loaded only where both targets exist, so a missing file is reported below and not thrown here. */
const loadable = entries.filter(
  (entry) => existsSync(join(root, entry.dir, entry.development)) && existsSync(join(root, entry.dir, entry.default))
);
const loaded = await Promise.all(
  loadable.map(async (entry) => ({
    name: entry.name,
    development: Object.keys(await import(pathToFileURL(join(root, entry.dir, entry.development)).href)),
    production: Object.keys(await import(pathToFileURL(join(root, entry.dir, entry.default)).href)),
    declarations: entry.types && existsSync(join(root, entry.dir, entry.types))
      ? readFileSync(join(root, entry.dir, entry.types), 'utf8')
      : null,
  }))
);

test('every exports target is a file the build actually writes', () => {
  assert.deepEqual(
    missingTargets, [],
    `these resolve to nothing, so the import throws for a consumer:\n  ${missingTargets.join('\n  ')}`
  );
});

test('and every built artifact is reachable through some subpath', () => {
  const stranded = [];
  for (const [dir, reached] of reachable)
    for (const built of [
      ...globSync(`${dir}/dist/**/*.js`, { cwd: root }),
      ...globSync(`${dir}/dist/**/*.d.ts`, { cwd: root }),
    ])
      if (!reached.has(built.replace(/\\/g, '/'))) stranded.push(built);

  assert.deepEqual(stranded, [], `built, published in the tarball, and impossible to import:\n  ${stranded.join('\n  ')}`);
});

test('a development condition is never shadowed by an earlier default', () => {
  const shadowed = [];
  for (const manifest of manifests) {
    const json = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    if (json.private) continue;
    for (const [subpath, value] of Object.entries(json.exports ?? {})) {
      if (typeof value !== 'object' || value === null) continue;
      const keys = Object.keys(value);
      const fallback = keys.indexOf('default');
      const development = keys.indexOf('development');
      if (fallback !== -1 && development !== -1 && fallback < development)
        shadowed.push(`${json.name}${subpath.slice(1)}: ${keys.join(', ')}`);
    }
  }

  assert.deepEqual(shadowed, [], `conditions match in order, so these never resolve to a development build:\n  ${shadowed.join('\n  ')}`);
});

test('every entry exports the same names in development and in production', () => {
  assert.equal(loaded.length, entries.length, 'an entry could not be loaded');
  const problems = [];

  for (const entry of loaded) {
    const development = new Set(entry.development);
    const production = new Set(entry.production);
    const onlyDevelopment = [...development].filter((name) => !production.has(name));
    const onlyProduction = [...production].filter((name) => !development.has(name));

    if (onlyDevelopment.length)
      problems.push(`${entry.name}: in development only — ${onlyDevelopment.join(', ')}. Production is a different program; an export folded out of it is missing for everyone who installs the package.`);
    if (onlyProduction.length) problems.push(`${entry.name}: in production only — ${onlyProduction.join(', ')}`);
  }

  assert.deepEqual(problems, [], `the two builds disagree about what they export:\n  ${problems.join('\n  ')}`);
});

test('and the declarations cover what the production build actually exports', () => {
  const problems = [];

  for (const entry of loaded) {
    if (!entry.declarations) { problems.push(`${entry.name}: no declarations to read`); continue; }
    /** `export *` forwards an unknown set, so a name it might carry cannot be called untyped. */
    if (/^export \* from/m.test(entry.declarations)) continue;

    const declared = new Set(
      [...entry.declarations.matchAll(/^(?:export )?declare (?:const|function|let|var|class) (\w+)/gm)].map((m) => m[1])
    );
    for (const match of entry.declarations.matchAll(/^export \{([^}]*)\}/gm))
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) declared.add(name);
      }

    const untyped = entry.production.filter((name) => !declared.has(name));
    if (untyped.length) problems.push(`${entry.name}: exported at runtime with no declaration — ${untyped.join(', ')}`);
  }

  assert.deepEqual(problems, [], `a TypeScript consumer cannot see these:\n  ${problems.join('\n  ')}`);
});
