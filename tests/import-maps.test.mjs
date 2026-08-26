/**
 * Every import map on every page parses, and covers what that page imports.
 *
 * Buildless is a first-class consumption mode, and an import map is the whole of its wiring — so a
 * missing entry or a stray comma is the difference between a working page and a blank one. The
 * failure is also unusually bad to diagnose: a malformed map makes the browser ignore it entirely,
 * every bare specifier fails to resolve, and what surfaces is a test timing out on markup that never
 * appeared.
 *
 * This was written after a scripted edit added an entry without its comma and the only signal was
 * exactly that timeout. A JSON parse is cheaper than reading a stack trace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pages = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') walk(full);
    } else if (entry.endsWith('.html')) pages.push(full);
  }
};
walk(join(root, 'examples'));
walk(join(root, 'tests/browser/fixtures'));

const MAP = /<script type=["']importmap["']>([\s\S]*?)<\/script>/;

test('every import map is valid JSON', () => {
  assert.ok(pages.length > 4, `expected to find the pages, found ${pages.length}`);
  const problems = [];
  for (const page of pages) {
    const found = MAP.exec(readFileSync(page, 'utf8'));
    if (!found) continue;
    try {
      JSON.parse(found[1]);
    } catch (error) {
      problems.push(`${relative(root, page)}: ${error.message.slice(0, 70)}`);
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}`);
});

test('every @verajs specifier a page imports has an entry', () => {
  const problems = [];
  for (const page of pages) {
    const text = readFileSync(page, 'utf8');
    const found = MAP.exec(text);
    if (!found) continue;
    let declared;
    try {
      declared = new Set(Object.keys(JSON.parse(found[1]).imports ?? {}));
    } catch {
      continue; // the parse test above owns this failure
    }
    for (const match of text.matchAll(/from ['"](@verajs\/[a-z/-]+)['"]/g))
      if (!declared.has(match[1]))
        problems.push(`${relative(root, page)}: imports ${match[1]} with no import-map entry`);
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}`);
});

/** And an entry must point at a file this repo builds, when it points into this repo at all. */
test('local import-map targets exist', () => {
  const problems = [];
  for (const page of pages) {
    const found = MAP.exec(readFileSync(page, 'utf8'));
    if (!found) continue;
    let imports;
    try {
      imports = JSON.parse(found[1]).imports ?? {};
    } catch {
      continue;
    }
    for (const [specifier, target] of Object.entries(imports)) {
      if (!target.startsWith('/packages/')) continue;
      try {
        statSync(join(root, target.slice(1)));
      } catch {
        problems.push(`${relative(root, page)}: ${specifier} -> ${target} does not exist`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}\n  (run \`npm run build\` first)`);
});
