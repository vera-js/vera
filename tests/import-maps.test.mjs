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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

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

/**
 * Every `@verajs` specifier that will be resolved against a page's map — **including the ones in the
 * modules it loads.**
 *
 * Reading only the page's own text checked almost nothing: `examples/cdn-js/index.html` is the main
 * buildless example and its scripts live in `src/`, so the page contains no `from '@verajs/core'` at
 * all and renaming that map entry broke nothing this file could see. Verified by doing exactly that
 * — the guard passed. A map is resolved for the whole module graph a page loads, so the graph is
 * what has to be checked.
 *
 * Local relative imports are followed; a bare specifier is the thing being checked and is where the
 * walk stops.
 */
const specifiersReachableFrom = (page, text) => {
  const specifiers = new Set();
  const seen = new Set();
  const visit = (file, source) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, specifier] of source.matchAll(/from ['"](@verajs\/[a-z/-]+)['"]/g)) specifiers.add(specifier);
    /** `import '@verajs/x'` and `import './y.js'` — a side-effect import resolves through the map too. */
    for (const [, specifier] of source.matchAll(/import ['"](@verajs\/[a-z/-]+)['"]/g)) specifiers.add(specifier);
    const locals = [
      ...[...source.matchAll(/from ['"](\.[^'"]+)['"]/g)].map(([, path]) => path),
      ...[...source.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/g)].map(([, path]) => path),
      ...[...source.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*type=["']module["']/g)].map(([, path]) => path),
    ];
    for (const path of locals) {
      if (/^https?:/.test(path)) continue;
      const resolved = join(dirname(file), path);
      if (existsSync(resolved) && statSync(resolved).isFile()) visit(resolved, readFileSync(resolved, 'utf8'));
    }
  };
  visit(page, text);
  return specifiers;
};

test('every @verajs specifier a page loads has an entry', () => {
  const problems = [];
  let checked = 0;
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
    for (const specifier of specifiersReachableFrom(page, text)) {
      checked++;
      if (!declared.has(specifier))
        problems.push(`${relative(root, page)}: loads ${specifier}, which its import map does not declare`);
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}`);
  /**
   * A walk that reaches nothing would pass silently — which is exactly the bug this test had — so
   * the case that exposed it is asserted by name rather than by a count. `examples/cdn-js` is the
   * main buildless example, its page contains no `@verajs` import of its own, and `@verajs/core` is
   * only reachable through the module it loads.
   */
  const buildless = pages.find((page) => page.endsWith(join('examples', 'cdn-js', 'index.html')));
  assert.ok(buildless, 'the buildless example is among the pages');
  const reachable = specifiersReachableFrom(buildless, readFileSync(buildless, 'utf8'));
  assert.ok(reachable.has('@verajs/core'), 'the walk reaches through <script src> into the module graph');
  assert.ok(checked > 10, `only ${checked} specifiers were reachable across ${pages.length} pages`);
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
