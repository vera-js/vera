/**
 * **A "words" build differs from production in PROSE only** (vera-5a, 2026-10-09). Some bundles keep `__DEV__` TRUE while
 * minified, so the person who fixes an error reads its sentence: the jsx compiler's NODE build (3d), and cms's
 * `publish`, `node` and cli (`words: true` in defaultRollupConfig) plus its content node build. But `__DEV__` can gate
 * BEHAVIOR too — a development-only check or warning — and in such a bundle that behavior would ship switched ON,
 * silently. So every `__DEV__` in the SOURCES of each words bundle (read from its own source map, shared-utils
 * included) must be a prose form: `__DEV__ && PROSE[…]`, `__DEV__ && SHARED.…`, or the formatters' `__DEV__ && andProse`.
 * Anything else — `if (__DEV__) …`, a ternary — is behavior, and fails here until it is moved or decided.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every words bundle: each MODE=node build, and each production bundle of an entry built with `words: true`. */
const WORDS = [
  ...globSync('packages/*/dist/node/*.js', { cwd: root }),
  'packages/cms/dist/vera-cms-publish.min.js',
  'packages/cms/dist/vera-cms-node.min.js',
  'packages/cms/dist/vera-cms-cli.min.js',
];

/**
 * The original lines each source CONTRIBUTED to the bundle — decoded from the map's `mappings` (base64 VLQ: per segment,
 * the generated column, then source index, original line and column, each a delta). A source file is listed when any
 * of its code shipped; only the lines that did are what the bundle runs, so a tree-shaken function's `__DEV__` (shared-
 * utils' `reportUncaught`, absent from cms's bundles — measured, against core as the positive control) is not a fact
 * about this bundle.
 */
const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
const shippedLines = (mappings) => {
  const shipped = new Set();
  let source = 0, line = 0;
  for (const generated of mappings.split(';'))
    for (const segment of generated.split(',')) {
      if (!segment) continue;
      const fields = [];
      let value = 0, shift = 0;
      for (const c of segment) {
        const digit = B64[c];
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (fields.length < 4) continue;
      source += fields[1];
      line += fields[2];
      shipped.add(`${source}:${line}`);
    }
  return shipped;
};

/** The forms that gate prose and nothing else. */
const PROSE_ONLY = /__DEV__\s*&&\s*(?:PROSE\[|SHARED\.|andProse\b)/;

test('CONTROL: the list covers every `words: true` entry, and every bundle on it exists', () => {
  const declared = globSync('packages/*/rollup.config.js', { cwd: root })
    .reduce((sum, file) => sum + (readFileSync(root + file, 'utf8').match(/\bwords: true\b/g) ?? []).length, 0);
  const listed = WORDS.filter((file) => !file.includes('/dist/node/')).length;
  assert.equal(listed, declared, `${declared} entries declare words: true; ${listed} are listed here`);
  for (const file of WORDS) assert.ok(existsSync(root + file), `${file} is built`);
});

/**
 * **POSITIVE CONTROL: the decoder finds a line it must find**, per words bundle — so a decoding bug cannot read as
 * "clean" (vera-5a). Each entry: a line of source that certainly ships in that bundle. (cms's content node build joins
 * when content carries prose, 5b.)
 */
const KNOWN = [
  ['packages/jsx/dist/node/vera-jsx.js', 'packages/jsx/src/transform.ts', "coded('jsx-key-placement'"],
  ['packages/cms/dist/vera-cms-publish.min.js', 'packages/cms/src/schema.ts', "'cms-schema-json'"],
  ['packages/cms/dist/vera-cms-node.min.js', 'packages/cms/src/schema.ts', "'cms-schema-json'"],
  ['packages/cms/dist/vera-cms-cli.min.js', 'packages/cms/src/schema.ts', "'cms-schema-json'"],
];
test('POSITIVE CONTROL: each words bundle\'s decoded mappings contain a line that certainly shipped', () => {
  for (const [bundle, source, needle] of KNOWN) {
    const map = JSON.parse(readFileSync(`${root}${bundle}.map`, 'utf8'));
    const index = map.sources.findIndex((one) => resolve(root, dirname(bundle), one) === resolve(root, source));
    assert.ok(index >= 0, `${bundle} lists ${source}`);
    const line = readFileSync(root + source, 'utf8').split('\n').findIndex((text) => text.includes(needle));
    assert.ok(line >= 0, `CONTROL: ${needle} is in ${source}`);
    assert.ok(shippedLines(map.mappings).has(`${index}:${line}`), `the decoder found ${source}:${line + 1} in ${bundle}`);
  }
});

test('every __DEV__ in a words bundle\'s sources gates prose only', () => {
  const behavior = [];
  let seen = 0;
  for (const bundle of WORDS) {
    const map = JSON.parse(readFileSync(`${root}${bundle}.map`, 'utf8'));
    const shipped = shippedLines(map.mappings);
    map.sources.forEach((source, index) => {
      const file = resolve(root, dirname(bundle), source);
      if (!existsSync(file)) return;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\b__DEV__\b/.test(line) || /^\s*(?:\*|\/\/|\/\*)/.test(line)) return;
        if (!shipped.has(`${index}:${i}`)) return;
        seen++;
        if (!PROSE_ONLY.test(line)) behavior.push(`${bundle} ← ${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    });
  }
  assert.ok(seen >= 10, `CONTROL: ${seen} SHIPPED __DEV__ uses found through the decoded mappings`);
  assert.deepEqual(behavior, [], 'behavior under __DEV__ would ship switched ON in a words build');
});
