/**
 * **Every message in a package on the code system comes from its table** (vera-5a, 2026-10-09). The sweep and the
 * tables test read REGISTERED codes; a message written inline is invisible to both — exactly what A1–A3 did first. So:
 *
 * 1. SOURCE: in a migrated package, no `throw new …Error(` and no `console.warn(`/`console.error(` takes a literal —
 *    its text comes through `misuse()` / `diagnostic()`, whose prose is the table's.
 * 2. BUNDLES: no table prose survives in the production bundle — what "development-only costs 0 B" rests on.
 *
 * MIGRATED grows as packages move onto the code system (the rest: the pre-release migration piece).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, proseOf } from '../scripts/diagnostic-tables.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
/**
 * `[package, a production bundle that carries its code]`. shared-utils is private and inlined: its own min bundle
 * exports every shared text and never ships, so it is checked through the renderer's, which inlines it.
 */
const MIGRATED = [
  ['core', 'dist/vera.min.js'],
  ['styles', 'dist/vera-styles.min.js'],
  /** Every renderer entry ships its own bundle — tag, keyed, slots… — so every one is checked. */
  ['renderer', 'dist/*.min.js'],
  ['shared-utils', '../renderer/dist/vera-renderer.min.js'],
  ['router', 'dist/vera-router.min.js'],
  ['inserts', '../core/dist/vera.min.js'],
  ['store', 'dist/*.min.js'],
  ['ui', 'dist/*.min.js'],
  ['autoloader', 'dist/*.min.js'],
  /** The STANDALONE loader's bundle: the compiler is a separate, lazily loaded file whose words ship by design. */
  ['jsx', 'dist/vera-jsx-standalone.min.js'],
];
/**
 * Error ROUTING, not messages (the migration plan excludes it): `reportUncaught` prints the caller's sentence beside an
 * error it forwards. Counted, so a second inline call in the file is a deliberate edit, not a free pass.
 */
const ROUTING = new Map([
  ['packages/shared-utils/src/utils.ts', 2],
  /** The standalone loader forwards the compiler's warning, which already carries its code (vera-5a's rule). */
  ['packages/jsx/src/standalone.ts', 1],
]);
/** A leading `'%s'` is the format, never the message (`tests/console-format-strings.test.mjs`): the line is after it. */
const INLINE = /(?:throw new \w*Error|console\.(?:warn|error))\(\s*(?:'%s',\s*)?(?!'%s')[`'"]/g;

/** Each migrated package's own codes, for telling a bare production code from inline prose. */
const OWN = new Map();
for (const [name] of MIGRATED) {
  const own = {};
  for (const file of TABLES.find((entry) => entry.name === name).tables)
    Object.assign(own, proseOf(await import(new URL(`../packages/${name}/${file}`, import.meta.url).href)));
  OWN.set(name, own);
}

for (const [name, bundle] of MIGRATED) {
  test(`${name}: no inline message — every throw and warning goes through its table`, () => {
    const files = globSync(`packages/${name}/src/**/*.ts`, { cwd: root }).filter((file) => !file.endsWith('diagnostics.ts'));
    assert.ok(files.length > 0, 'CONTROL: the package has sources');
    const inline = [];
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      /**
       * A production line that IS a bare code from this package's table (`[vera] router-redirect-loop: …`, or a thrown
       * `name: <code>`) is the code system at its cheapest — Brian's byte rule keeps it where the link costs bytes —
       * so it is not inline prose. Anything else is.
       */
      const found = [...text.matchAll(INLINE)]
        .filter((match) => {
          const code = /^[`'"](?:\[vera\] |[a-zA-Z]+: )([a-z][a-z0-9-]*)(?=[:`'"])/.exec(text.slice(match.index + match[0].length - 1))?.[1];
          return code === undefined || !(code in OWN.get(name));
        })
        .map((match) => `${file}:${text.slice(0, match.index).split('\n').length}`);
      if (ROUTING.get(file) === found.length) continue;
      inline.push(...found);
    }
    assert.deepEqual(inline, [], 'a message written inline — put its text in the package table and raise it by code');
  });

  test(`${name}: no table prose survives in the production bundle`, async () => {
    /** Its own tables AND the shared one — a package raising `SHARED['x']` must not ship that prose either. */
    const { tables } = TABLES.find((entry) => entry.name === name);
    const entries = [];
    for (const [owner, files] of [[name, tables], ['shared-utils', ['src/diagnostics.ts']]])
      for (const file of files) entries.push(...Object.entries(proseOf(await import(new URL(`../packages/${owner}/${file}`, import.meta.url).href))));
    const bundles = globSync(join('packages', name, bundle), { cwd: root });
    assert.ok(bundles.length > 0, `CONTROL: ${bundle} matched a bundle`);
    const min = bundles.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    assert.ok(entries.length > 0, 'CONTROL: the table has entries');
    const leaked = [];
    let checked = 0;
    for (const [code, prose] of entries) {
      /** A distinctive stretch of the first sentence, before its first parameter. */
      const [sentence] = prose('\u0000', '\u0000', '\u0000');
      const fragment = sentence.split('\u0000')[0].slice(0, 32).trim();
      if (fragment.length < 12) continue;
      checked++;
      if (min.includes(fragment)) leaked.push(`${code}: "${fragment}"`);
    }
    assert.ok(checked >= entries.length / 2, `CONTROL: ${checked} of ${entries.length} entries had a fragment to look for`);
    assert.deepEqual(leaked, [], 'table prose reached the production bundle — reference it only behind __DEV__');
  });
}

/**
 * **The bare-code production form is one exact shape, enforced, not habitual** (vera-5a, 2026-10-09). Where the byte
 * rule keeps a production line to its code, it is written by hand at each site, so this pins the format across every
 * migrated package: a literal that begins `[vera] <code>` continues with `: ` (its subject) or ends there; a thrown
 * `name: <code>` ends there. Any other continuation is a second format a user would have to learn. Every code in every
 * table counts — a misspelled one is not a code, and is caught by the inline check above.
 */
test('every bare production code line has the one shape: `[vera] <code>` + (`: subject` | end), or `name: <code>`', async () => {
  const known = new Set();
  for (const entry of TABLES)
    for (const file of entry.tables)
      for (const code of Object.keys(proseOf(await import(new URL(`../packages/${entry.name}/${file}`, import.meta.url).href)))) known.add(code);
  assert.ok(known.size >= 80, `CONTROL: ${known.size} codes`);
  const lines = [];
  const malformed = [];
  for (const [name] of MIGRATED)
    for (const file of globSync(`packages/${name}/src/**/*.ts`, { cwd: root }).filter((path) => !path.endsWith('diagnostics.ts'))) {
      const text = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const match of text.matchAll(/[`'"](?:\[vera\] |[a-zA-Z]+: )([a-z][a-z0-9-]*)([^`'"]?)/g)) {
        if (!known.has(match[1])) continue;
        const bracketed = match[0].slice(1).startsWith('[vera] ');
        const next = match[2];
        lines.push(`${file}: ${match[0]}`);
        const ok = bracketed ? next === '' || (next === ':' && text[match.index + match[0].length] === ' ') : next === '';
        if (!ok) malformed.push(`${file}: ${JSON.stringify(text.slice(match.index, match.index + 50))}`);
      }
    }
  assert.ok(lines.length >= 6, `CONTROL: the six known bare lines were found — ${lines.join(' | ')}`);
  assert.deepEqual(malformed, [], 'a bare code line in another shape — `[vera] <code>: <subject>` or `[vera] <code>`, `name: <code>`');
});

/**
 * **"Every line the framework prints carries a code" is true package by package, and this says which** (vera-5a,
 * 2026-10-09). A package whose sources print or throw is either MIGRATED above (its messages come from its table) or
 * listed here with the phase that moves it. The list only SHRINKS — `NOT_YET_MAX` — and phase 5 leaves cms's named
 * exclusions (programmer API contracts, kept as named throws). The README and llms.txt name the migrated packages by
 * this list, so the sentence cannot run ahead of the code.
 */
const NOT_YET = new Map([
  ['motion', 'phase 4 (its own table, omni parity)'],
  ['directives', "phase 4 (its remainder — its table exists, a few inline lines don't use it)"],
  ['ssr', 'phase 4'],
  ['cms', 'phase 5 — the named list in the migration plan; programmer API contracts stay named throws'],
]);
const NOT_YET_MAX = 4;

test('every package that prints or throws is on the code system, or listed with its phase (the list only shrinks)', () => {
  const printing = globSync('packages/*/src', { cwd: root })
    .map((dir) => dir.split('/')[1])
    .filter((name) =>
      globSync(`packages/${name}/src/**/*.ts`, { cwd: root }).some((file) =>
        /console\.(?:warn|error)\(|throw new \w*Error\(/.test(readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
      )
    );
  assert.ok(printing.length >= 10, `CONTROL: ${printing.length} packages print`);
  const migrated = new Set(MIGRATED.map(([name]) => name));
  assert.deepEqual(printing.filter((name) => !migrated.has(name) && !NOT_YET.has(name)), [], 'a package prints uncoded and is on neither list');
  assert.deepEqual([...NOT_YET.keys()].filter((name) => migrated.has(name)), [], 'migrated — delete its NOT_YET row');
  assert.ok(NOT_YET.size <= NOT_YET_MAX, `${NOT_YET.size} not yet migrated, more than ${NOT_YET_MAX}: the list only shrinks`);
});
