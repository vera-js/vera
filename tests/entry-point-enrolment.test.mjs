/**
 * **Every public entry point is enrolled in the mechanisms that keep this repository honest.**
 *
 * Four findings in the light-slots audit were the same defect wearing different clothes: a new
 * public entry shipped, and a standing mechanism did not know it existed. `@verajs/renderer/slots`
 * had no tracked size — the one number this project guarantees against drift, precisely because it
 * is generated and `--check`ed. It was documented as Node-safe with nothing verifying the claim. Its
 * README example could not be executed, because the recipe runner had no mapping for the specifier.
 * None of those failed anything; the mechanisms were simply silent about a module they had never
 * been told about, and silence reads exactly like success.
 *
 * Checking each mechanism against the packages themselves is the thing none of them can do for
 * itself. A list cannot notice what is missing from it.
 *
 * **Which direction this test can fail in matters.** The lists are read by pulling quoted strings
 * out of the files that declare them, which is not a parser — but the failure mode is the safe one:
 * if the extraction breaks it finds FEWER entries, and fewer entries means this test reports a gap
 * that is not there, which is loud and gets fixed. It cannot invent an enrolment that does not
 * exist. Each extraction also asserts it found a plausible number first, because a scan that
 * matched nothing would otherwise report every entry as missing and bury the real answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const has = (path) => existsSync(new URL(path, root));

/** Every public entry point, from the packages themselves — the only list that cannot go stale. */
const entryPoints = () => {
  const found = [];
  for (const directory of readdirSync(new URL('packages/', root))) {
    const manifest = `packages/${directory}/package.json`;
    if (!has(manifest)) continue;
    const json = JSON.parse(read(manifest));
    if (json.private) continue;
    for (const [subpath, target] of Object.entries(json.exports ?? {})) {
      if (subpath.includes('*') || subpath.endsWith('.json')) continue;
      const production = typeof target === 'object' ? (target.default ?? target.import ?? null) : target;
      const bundle =
        typeof production === 'string' && production.endsWith('.min.js')
          ? `packages/${directory}/${production.replace(/^\.\//, '')}`
          : null;
      found.push({
        specifier: json.name + (subpath === '.' ? '' : subpath.slice(1)),
        bundle: bundle !== null && has(bundle) ? bundle : null,
      });
    }
  }
  return found.sort((a, b) => a.specifier.localeCompare(b.specifier));
};

/** Quoted `packages/…/*.min.js` paths named anywhere in a file — what its list actually covers. */
const bundlePathsIn = (path, atLeast) => {
  const found = new Set(read(path).match(/packages\/[\w-]+\/dist\/[\w.-]+\.min\.js/g) ?? []);
  assert.ok(found.size >= atLeast, `${path}: found only ${found.size} bundle paths — the scan is broken, not the list`);
  return found;
};

/** Quoted `@verajs/…` specifiers named anywhere in a file. */
const specifiersIn = (path, atLeast) => {
  const found = new Set(read(path).match(/@verajs\/[\w-]+(?:\/[\w-]+)?/g) ?? []);
  assert.ok(found.size >= atLeast, `${path}: found only ${found.size} specifiers — the scan is broken, not the list`);
  return found;
};

/**
 * Entries that legitimately sit outside a mechanism, each with the reason it does. An exemption is
 * a decision, so it is written down as one — a bare list would just be a second place for things to
 * go missing quietly.
 */
const NO_SIZE_CLAIM = {
  '@verajs/renderer/hydrate':
    'CANDIDATE, not settled — it does ship a bundle, the largest here. It is a REPLACEMENT for ' +
    'the renderer entry rather than something added beside it, so a row next to `@verajs/renderer` ' +
    'in the public modules table would read as an extra cost nobody pays. Worth a row of its own.',
  '@verajs/reactivity':
    'CANDIDATE, not settled — it ships a bundle and is a published package, and its absence from ' +
    'the table looks more like an oversight than a decision. `reactivity/computed` and ' +
    '`reactivity/collections` are both claimed; the base entry is not.',
};

const NO_RECIPE_MAPPING = {
  '@verajs/eslint-config': 'config, not a module — there is nothing to import in a recipe',
  '@verajs/tsconfig': 'config, not a module',
  '@verajs/jsx/standalone': 'browser-only by construction: it captures `document` at module scope',
  '@verajs/renderer/profiler': 'a development tool with no production build (see NO_PRODUCTION_BUILD)',
};

/** Entries a strict TypeScript consumer cannot import, so `tests/consumer` cannot cover them. */
const NO_CONSUMER_CHECK = {
  '@verajs/eslint-config': 'config, not a module',
  '@verajs/tsconfig': 'config, not a module',
  '@verajs/jsx': 'a build-time transform, exercised by the JSX suites rather than as a runtime import',
  '@verajs/jsx/standalone': 'browser-only by construction: it captures `document` at module scope',
  '@verajs/renderer/hydrate': 'a drop-in replacement for the renderer entry; importing both in one ' +
    'file would be two renderers, and `ssrcheck.ts` covers the hydration surface',
  '@verajs/ssr': 'Node-only, and covered by `ssrcheck.ts` beside it',
};

const NOT_IMPORTABLE = {
  '@verajs/eslint-config': 'config, not a module',
  '@verajs/tsconfig': 'config, not a module',
};

test('every entry that ships a bundle has its size tracked and claimed', () => {
  const claimed = bundlePathsIn('scripts/sync-size-claims.mjs', 10);
  const snapshotted = bundlePathsIn('bench/size.mjs', 10);
  const missing = [];
  for (const { specifier, bundle } of entryPoints()) {
    if (bundle === null || specifier in NO_SIZE_CLAIM) continue;
    if (!claimed.has(bundle)) missing.push(`${specifier} — not in sync-size-claims.mjs`);
    if (!snapshotted.has(bundle)) missing.push(`${specifier} — not in bench/size.mjs`);
  }
  assert.deepEqual(missing, [], 'a shipped bundle whose size nothing generates will drift, and silently');
});

test('every entry point is on exactly one side of the Node-safety list', () => {
  const listed = specifiersIn('tests/node-import-safety.test.mjs', 10);
  const missing = entryPoints()
    .map(({ specifier }) => specifier)
    .filter((specifier) => !(specifier in NOT_IMPORTABLE) && !listed.has(specifier));
  assert.deepEqual(missing, [],
    'an entry in neither half is a claim nobody checks — `@verajs/ssr` reaches modules in Node with ' +
    'no DOM, and this list is what keeps that possible');
});

test('every importable entry can be reached from a documented recipe', () => {
  const mapped = specifiersIn('tests/docs-recipes.test.mjs', 8);
  const missing = entryPoints()
    .map(({ specifier }) => specifier)
    .filter((specifier) => !(specifier in NO_RECIPE_MAPPING) && !mapped.has(specifier));
  assert.deepEqual(missing, [],
    'documented code is executed here — an entry the recipe runner cannot resolve is an entry whose ' +
    'documentation cannot be run, which is how a README stops being true');
});

/**
 * **The one check that reads the TYPES rather than the code.** `wire([renderer, slots])` — the line
 * the slots README, llms.txt and every recipe tell people to write — did not compile for a
 * TypeScript consumer, because `'slot'` was never added to the insert type map. Nothing caught it:
 * the recipes run as JavaScript, and this repository's own typecheck resolves `@verajs/*` to SOURCE,
 * where the descriptor carried an `as never` cast. `tests/consumer` is the file that compiles
 * against the BUILT declarations the way an installed package is consumed — and it had never
 * imported the entry.
 */
test('every importable entry is exercised by the strict TypeScript consumer', () => {
  const imported = specifiersIn('tests/consumer/consumer.ts', 8);
  const alsoSsr = specifiersIn('tests/consumer/ssrcheck.ts', 1);
  const missing = entryPoints()
    .map(({ specifier }) => specifier)
    .filter(
      (specifier) =>
        !(specifier in NO_CONSUMER_CHECK) && !imported.has(specifier) && !alsoSsr.has(specifier)
    );
  assert.deepEqual(missing, [],
    'an entry no consumer check imports is an entry whose published TYPES nobody compiles');
});

/**
 * **A document that makes a size claim must be a document something checks.**
 *
 * `sync-size-claims` regenerates claims inside `<!--size:…-->` markers, and the files it looks at
 * are a hand-maintained list. A page carrying a marker that is not on that list is never
 * regenerated and never `--check`ed: its number is frozen at whatever it was when it was typed, in
 * the one place this project promises numbers do not drift.
 *
 * Found by doing it. A new feature page was written with a size claim in it, and the only symptom
 * was that the claim COUNT did not move — 42 to 42. Nothing failed, because a file the script does
 * not read cannot disagree with it.
 */
test('every document that carries a size claim is one the sync script reads', () => {
  const script = read('scripts/sync-size-claims.mjs');
  /**
   * The script's list has two halves and both have to be read: files it names literally (including
   * `llms.txt`, which is why this is not `.md`-only), and the per-package READMEs it DERIVES from
   * its module table — `packages/<dir ?? pkg>/README.md`. Missing the second half made this report
   * every package README as unchecked, which is the loud direction, but wrong.
   */
  const targets = new Set(script.match(/'[\w./-]+\.(?:md|txt)'/g)?.map((quoted) => quoted.slice(1, -1)) ?? []);
  for (const [, key] of script.matchAll(/\b(?:dir|pkg): '([\w-]+)'/g)) targets.add(`packages/${key}/README.md`);
  assert.ok(targets.size >= 8, `found only ${targets.size} target files — the scan is broken, not the list`);

  /** Every markdown file in the repository's own docs that carries a marker. */
  const carrying = [];
  const walk = (directory) => {
    for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'internal', 'bench'].includes(entry.name)) walk(`${path}/`);
      } else if (entry.name.endsWith('.md') && read(path).includes('<!--size:')) {
        carrying.push(path);
      }
    }
  };
  walk('docs/');
  for (const file of ['README.md', 'llms.txt']) if (has(file) && read(file).includes('<!--size:')) carrying.push(file);
  for (const directory of readdirSync(new URL('packages/', root)))
    if (has(`packages/${directory}/README.md`) && read(`packages/${directory}/README.md`).includes('<!--size:'))
      carrying.push(`packages/${directory}/README.md`);

  assert.ok(carrying.length >= 4, `only ${carrying.length} documents carry a claim — the scan is broken`);
  const unchecked = carrying.filter((file) => !targets.has(file));
  assert.deepEqual(unchecked, [],
    'these make a size claim that nothing regenerates, so it is frozen at whatever was typed');
});

/** The exemptions are the part most likely to rot: a name kept after the entry it excused is gone. */
test('every exemption still names a real entry point', () => {
  const real = new Set(entryPoints().map(({ specifier }) => specifier));
  const stale = [
    ...Object.keys(NO_SIZE_CLAIM),
    ...Object.keys(NO_RECIPE_MAPPING),
    ...Object.keys(NOT_IMPORTABLE),
    ...Object.keys(NO_CONSUMER_CHECK),
  ]
    .filter((specifier) => !real.has(specifier));
  assert.deepEqual([...new Set(stale)], [], 'an exemption for an entry that no longer exists');
});
