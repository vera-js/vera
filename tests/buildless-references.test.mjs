/**
 * What a buildless page points at, checked against what exists.
 *
 * Buildless is a first-class consumption mode — "paste into CodePen and it runs" — and it is the one
 * with no toolchain to catch a mistake. **No type-checker, bundler, or linter reads an import map.**
 * A specifier that once resolved goes on looking exactly right in the file and fails only in a
 * browser, on the page a newcomer is most likely to open first.
 *
 * Three properties, each of which has a distinct failure:
 *
 * 1. Every path an import map or `<script src>` names is a file the build writes. A renamed bundle
 *    breaks this and nothing else notices.
 * 2. Every bare `@verajs/*` specifier the page can reach is declared in its map. Adding an import to
 *    the JS and forgetting the map entry is the ordinary way to break a buildless page, and it fails
 *    at *resolution* — before any of the code runs, with no partial render to hint at the cause.
 * 3. Every named import in an example is a name its package actually exports. `docs-removed-apis`
 *    covers prose; this covers the code beside it, which nothing runs.
 *
 * Examples are hand-run playgrounds and are deliberately not tests — `CLAUDE.md` is explicit that
 * neither substitutes for the other. This does not turn them into tests. It checks that they still
 * *refer to things that exist*, which is the part a person cannot notice by reading.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { JSDOM } from 'jsdom';

/**
 * The last test imports each package for real, and `@verajs/renderer` touches `document` at module
 * scope — so this needs a DOM before any of that, not only inside the test.
 */
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent', 'location', 'history', 'MutationObserver', 'ShadowRoot', 'NodeFilter',
])
  globalThis[key] = dom.window[key];

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = [
  ...globSync('examples/**/*.html', { cwd: root }),
  ...globSync('tests/browser/fixtures/*.html', { cwd: root }),
];

/** A leading `/` is server-root-relative, and the dev server's root is the repo. */
const locate = (target, dir) => (target.startsWith('/') ? join(root, target) : resolvePath(dir, target));
const isRemote = (target) => /^(https?:)?\/\//.test(target) || target.startsWith('data:');

const importMap = (text) => {
  const found = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (!found) return null;
  return JSON.parse(found[1]).imports ?? {};
};

test('every path a buildless page names is a file the build writes', () => {
  assert.ok(pages.length >= 4, `expected several buildless pages, found ${pages.length}`);
  const missing = [];
  let checked = 0;

  for (const page of pages) {
    const text = readFileSync(join(root, page), 'utf8');
    const dir = dirname(join(root, page));
    const targets = Object.entries(importMap(text) ?? {}).map(([spec, target]) => [`importmap ${spec}`, target]);
    for (const m of text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) targets.push(['script src', m[1]]);

    for (const [kind, target] of targets) {
      if (isRemote(target)) continue;
      checked++;
      if (!existsSync(locate(target, dir))) missing.push(`${page}: ${kind} -> ${target}`);
    }
  }

  assert.ok(checked >= 15, `only ${checked} references found — the parsing has probably stopped matching`);
  assert.deepEqual(missing, [], `these point at files that do not exist:\n  ${missing.join('\n  ')}`);
});

test('every specifier a buildless page reaches is declared in its import map', () => {
  const undeclared = [];

  for (const page of pages) {
    const text = readFileSync(join(root, page), 'utf8');
    const declared = importMap(text);
    if (!declared) continue;
    const dir = dirname(join(root, page));

    /** Inline module code counts, and so does everything the loaded modules reach. */
    const used = new Set(
      [...text.matchAll(/from\s+['"](@verajs\/[^'"]+)['"]|import\s+['"](@verajs\/[^'"]+)['"]/g)].map((m) => m[1] ?? m[2])
    );
    const queue = [];
    for (const m of text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g))
      if (!isRemote(m[1])) queue.push(locate(m[1], dir));

    const seen = new Set();
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith('@verajs/')) used.add(spec);
        else if (spec.startsWith('.')) queue.push(resolvePath(dirname(file), spec));
      }
    }

    for (const spec of used)
      if (!(spec in declared))
        undeclared.push(`${page}: imports ${spec}, and its import map declares only ${Object.keys(declared).join(', ')}`);
  }

  assert.deepEqual(undeclared, [], `these would fail to resolve in a browser:\n  ${undeclared.join('\n  ')}`);
});

test('every named import in an example is a name its package exports', async () => {
  const wanted = new Map();
  for (const file of globSync('examples/**/*.{ts,tsx,js,mjs,html}', { cwd: root })) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](@verajs\/[^'"]+)['"]/g)) {
      const names = m[1]
        .split(',')
        .map((name) => name.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      for (const name of names) {
        if (!wanted.has(m[2])) wanted.set(m[2], new Map());
        wanted.get(m[2]).set(name, file);
      }
    }
  }

  assert.ok(wanted.size >= 5, `only ${wanted.size} packages imported by examples — the scan has stopped matching`);

  const problems = [];
  for (const [spec, names] of wanted) {
    let module;
    try {
      module = await import(spec);
    } catch (error) {
      problems.push(`${spec} could not be imported at all: ${error.message}`);
      continue;
    }
    for (const [name, file] of names)
      if (!(name in module)) problems.push(`${spec} does not export \`${name}\`, imported by ${file}`);
  }

  assert.deepEqual(problems, [], `examples import names that do not exist:\n  ${problems.join('\n  ')}`);
});
