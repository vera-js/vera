/**
 * **`fsPath` reads the same as `.pathname` on macOS and Linux, and works on Windows; no file URL goes back to `.pathname`.**
 *
 * The suites resolved files with `new URL(…, import.meta.url).pathname`, which is a path only on POSIX: on Windows it
 * is `/c:/…`, and forty suites failed at load on the Windows workstation (2026-11-20). They now use
 * `scripts/fs-path.mjs`. The change must not move a single byte on the laptop or CI, so the first test holds the
 * POSIX conversion equal to `.pathname` for the shapes the suites use, run on any OS (Node's `windows: false`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fsPath, posix } from '../scripts/fs-path.mjs';

const ROOT = fsPath(new URL('..', import.meta.url));
const BACKSLASH = String.fromCharCode(92);

test('on POSIX the conversion is byte-identical to .pathname, for every shape the suites use', () => {
  const base = 'file:///Users/omni/dev/vera/tests/x.test.mjs';
  for (const relative of ['..', '../', '../..', '../../', '.', './', '../packages', '../packages/', './fixtures/ssr/a.mjs', '../examples/cms-site/', './.casing-']) {
    const url = new URL(relative, base);
    assert.equal(fileURLToPath(url, { windows: false }).replaceAll(BACKSLASH, '/'), url.pathname, relative);
  }
  /** Pinned to exactly those shapes: a checkout path with a space DIFFERS (the real path, where .pathname kept %20). */
  const spaced = new URL('..', 'file:///Users/omni/my%20dev/vera/tests/x.test.mjs');
  assert.notEqual(fileURLToPath(spaced, { windows: false }), spaced.pathname);
  assert.equal(fileURLToPath(spaced, { windows: false }), '/Users/omni/my dev/vera/');
});

test('on this OS the path opens, and keeps the URL\'s trailing slash', () => {
  assert.ok(ROOT.endsWith('/'), `a directory URL keeps its trailing slash: ${ROOT}`);
  assert.ok(!ROOT.includes(BACKSLASH), 'forward slashes only');
  assert.ok(readFileSync(`${ROOT}package.json`, 'utf8').includes('"workspaces"'), 'the root opens through a string join');
});

/**
 * Where `.pathname` is a WEB URL's path, not a file's: a page's `location`, a request's `url`, the browser suites (which
 * run in a page and open no files), and the files below, each with its reason. Anything else reading `.pathname` is a
 * file URL used as a path, which is the Windows break (found split from its URL too: `cwd: root.pathname`, d7).
 */
const WEB_URL = /\b(?:location|url|l)\.pathname\b/;
const ALLOWED = {
  'tests/fs-path.test.mjs': 'this suite, which names the shape',
  'scripts/fs-path.mjs': 'its doc comment names the shape',
  'scripts/codemods/fs-path.mjs': 'the codemod that rewrites the shape',
  'tests/autoloader-audit-regressions.test.mjs': 'asserts the path of https URLs',
  'tests/cms-refusal-cases.mjs': 'reads a request URL',
};
const comment = (line) => /^\s*(?:\*|\/\/|\/\*)/.test(line);
const reads = (line) => /\.pathname\b/.test(line) && !WEB_URL.test(line) && !comment(line);

test('no suite or script reads a file URL through .pathname', () => {
  const files = globSync(['tests/**/*.mjs', 'scripts/**/*.mjs'], { cwd: ROOT, exclude: (name) => basename(name) === 'node_modules' })
    .map(posix)
    .filter((file) => !(file in ALLOWED) && !file.startsWith('tests/browser/'));
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = [];
  for (const file of files)
    readFileSync(ROOT + file, 'utf8').split('\n').forEach((line, i) => {
      if (reads(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  assert.deepEqual(found, [], 'use fsPath(url) from scripts/fs-path.mjs for a file URL');
});

test('the detector fires on each file-URL shape, and passes a web URL (planted)', () => {
  /** Built in pieces, so the codemod (which rewrites the old shape wherever it finds it) cannot rewrite the plants. */
  for (const planted of ["new URL('..', import.meta.url)" + '.pathname', 'cwd: root' + '.pathname,', "cwd: new URL('./scripts/', root)" + '.pathname,'])
    assert.ok(reads(planted), `the detector misses: ${planted}`);
  assert.ok(!reads('assert.equal(window.location.pathname, "/x")'), 'a page location is a web URL');
  assert.ok(!reads(' * a comment about .pathname'), 'a comment is not code');
});

/**
 * **No file URL is built by hand** (2026-11-21). `'file://' + path` and `` `file://${path}` `` are URLs only for a
 * POSIX path with nothing to escape. On Windows a backslashed path spliced into a generated script's source becomes
 * escapes (`\v`, `\t`), and 57 rows of the slots parity and hydration suites failed with "Invalid URL"; a space or `%`
 * in any path breaks them everywhere. `pathToFileURL(path)` is the conversion (`process.getBuiltinModule('node:url')`
 * inside a generated child script, which has no import of its own).
 */
const HAND_BUILT = /(['"`])file:\/\/\1\s*\+|(['"`])file:\/\/\$\{/;
const handBuilt = (line) => HAND_BUILT.test(line) && !comment(line);

test('no suite or script builds a file URL by hand', () => {
  const files = globSync(['tests/**/*.mjs', 'tests/**/*.js', 'scripts/**/*.mjs'], { cwd: ROOT, exclude: (name) => basename(name) === 'node_modules' })
    .map(posix)
    .filter((file) => file !== 'tests/fs-path.test.mjs' && !file.startsWith('tests/browser/'));
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = [];
  for (const file of files)
    readFileSync(ROOT + file, 'utf8').split('\n').forEach((line, i) => {
      if (handBuilt(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  assert.deepEqual(found, [], 'use pathToFileURL(path) from node:url');
});

test('the hand-built detector fires on each shape (planted)', () => {
  const q = "'";
  for (const planted of [`new URL(${q}file://${q} + process.cwd() + '/')`, 'new URL(`file://${' + 'dir}/x.js`)', `new URL(${q}file://\${file}${q})`, '"file://" + join(a, b)'])
    assert.ok(handBuilt(planted), `the detector misses: ${planted}`);
  assert.ok(!handBuilt("pathToFileURL(process.cwd() + '/')"), 'the conversion itself passes');
  assert.ok(!handBuilt("assert.ok(href.startsWith('file:///'))"), 'a file URL checked, not built, passes');
});

/**
 * **No module is imported by a file PATH** (2026-11-21): an import specifier is a URL, and a Windows path (`C:\…`, or
 * `C:/…`) reads as the URL scheme `c:` (ERR_UNSUPPORTED_ESM_URL_SCHEME). `import(join(…))`, `import(fileURLToPath(…))`
 * and a root path spliced into a child's `import('${root}…')` failed jsx-coded-errors, hot-vite and
 * renderer-template-shape there. Import the URL: `new URL(…, import.meta.url).href`, or `pathToFileURL(path).href`.
 */
const PATH_IMPORT = /\bimport\(\s*(?:join|resolve|fileURLToPath|fsPath)\(|\bimport\(\s*'\$\{root\}/;

test('no suite or script imports a module by a file path', () => {
  const files = globSync(['tests/**/*.mjs', 'scripts/**/*.mjs'], { cwd: ROOT, exclude: (name) => basename(name) === 'node_modules' })
    .map(posix)
    .filter((file) => file !== 'tests/fs-path.test.mjs');
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = [];
  for (const file of files)
    readFileSync(ROOT + file, 'utf8').split('\n').forEach((line, i) => {
      if (PATH_IMPORT.test(line) && !comment(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  assert.deepEqual(found, [], 'import the URL, not the path');
});

test('the path-import detector fires on each shape (planted)', () => {
  for (const planted of ["await import(join(root, 'x.js'))", 'await import(fileURLToPath(url))', "await import('${" + "root}packages/core/x.js')"])
    assert.ok(PATH_IMPORT.test(planted), `the detector misses: ${planted}`);
  assert.ok(!PATH_IMPORT.test('await import(pathToFileURL(join(root, "x.js")).href)'), 'the URL passes');
});

/**
 * **One slash conversion, `posix()` in scripts/fs-path.mjs.** Splitting on a literal backslash is wrong on macOS and
 * Linux, where a backslash is an ordinary character in a file name; eleven sites converted inline in three spellings,
 * five of them that way. Every spelling the sweep found is refused outside fs-path.mjs, read as code (a comment saying
 * one is not a call).
 */
const INLINE = [
  /\.split\(\s*(?:path\.)?(?:posix\.|win32\.)?sep\s*\)\s*\.join\(/,
  /\.split\(\s*(['"`])\\\\\1\s*\)\s*\.join\(/,
  /\.split\(\s*(?:BACKSLASH|String\.fromCharCode\(\s*92\s*\))\s*\)\s*\.join\(/,
  /** A replace counts only when it writes a forward slash: escaping a backslash for a template is not a path. */
  /\.replaceAll\(\s*(?:(['"`])\\\\\1|BACKSLASH|String\.fromCharCode\(\s*92\s*\))\s*,\s*(['"`])\/\2\s*\)/,
  /\.replace\(\s*\/\\\\\/g\s*,\s*(['"`])\/\1\s*\)/,
  /\.join\(\s*(?:path\.)?posix\.sep\s*\)/,
];
const inline = (line) => INLINE.some((re) => re.test(line));

test('no script or suite converts slashes inline; posix() is the one conversion', () => {
  const files = globSync('{tests,scripts,bench}/**/*.{mjs,js,cjs}', { cwd: ROOT, exclude: (f) => f.includes('node_modules') })
    .map(posix)
    .filter((file) => file !== 'scripts/fs-path.mjs' && file !== 'tests/fs-path.test.mjs');
  assert.ok(files.length >= 200, `CONTROL: ${files.length} files read`);
  const found = [];
  for (const file of files)
    readFileSync(ROOT + file, 'utf8').split('\n').forEach((line, i) => {
      if (inline(line) && !/^\s*(?:\/\/|\*)/.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  assert.deepEqual(found, [], 'use posix() from scripts/fs-path.mjs');
});

/**
 * **A package converts on the platform's separator, never on a backslash.** Packages are independent and cannot import
 * scripts/, so `split(sep).join('/')` is the right spelling there; the spellings that split a backslash are wrong on
 * macOS and Linux, where it is a character of a file name. ssr is Node-only and handles paths, so this is where one
 * would matter first. The root's configuration files (defaultRollupConfig.js, which every package builds through, the
 * eslint, vite and test-runner configs) stand outside scripts/ the same way, and follow the same rule.
 */
const BACKSLASH_FORMS = [...INLINE.slice(1, 5), /\.split\(\s*(?:path\.)?win32\.sep\s*\)/];

test('no package source or root configuration splits a path on a backslash', () => {
  const files = globSync(['packages/**/src/**/*.{ts,mts,js,mjs}', '*.{ts,mts,js,mjs,cjs}'], { cwd: ROOT, exclude: (f) => f.includes('node_modules') }).map(posix);
  assert.ok(files.length >= 200, `CONTROL: ${files.length} package sources read`);
  assert.ok(files.includes('defaultRollupConfig.js') && files.includes('web-test-runner.config.mjs'), 'CONTROL: the root configs are read');
  const found = [];
  for (const file of files)
    readFileSync(ROOT + file, 'utf8').split('\n').forEach((line, i) => {
      if (BACKSLASH_FORMS.some((re) => re.test(line)) && !/^\s*(?:\/\/|\*)/.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  assert.deepEqual(found, [], "split on the platform's sep (node:path), not on a backslash");
  const b = BACKSLASH;
  assert.ok(BACKSLASH_FORMS.some((re) => re.test(`p.split('${b}${b}').join('/')`)) && BACKSLASH_FORMS.some((re) => re.test('p.split(win32.sep)')), 'CONTROL: the package rule fires (planted)');
  assert.ok(!BACKSLASH_FORMS.some((re) => re.test("p.split(sep).join('/')")), "the platform's sep passes in a package");
});

test('the inline-conversion detector fires on each spelling, and not on posix() or an ordinary split (planted)', () => {
  const b = BACKSLASH;
  for (const planted of [
    "file.split(sep).join('/')", "file.split(path.sep).join('/')", 'file.split( sep ).join("/")',
    `file.split('${b}${b}').join('/')`, `file.split("${b}${b}").join('/')`, 'file.split(BACKSLASH).join("/")',
    "file.split(String.fromCharCode(92)).join('/')", `file.replaceAll('${b}${b}', '/')`, 'file.replaceAll(BACKSLASH, "/")',
    `file.replace(/${b}${b}/g, '/')`, 'parts.join(path.posix.sep)', 'parts.join(posix.sep)',
  ])
    assert.ok(inline(planted), `the detector misses: ${planted}`);
  for (const near of ['posix(file)', "url.split('/').slice(0, 2).join('/')", "line.split(', ').join(' ')", 'text.replace(/x/g, "/")', `text.replace(/${b}${b}/g, '${b}${b}${b}${b}')`, `text.replaceAll('${b}${b}', '${b}${b}${b}${b}')`])
    assert.ok(!inline(near), `the detector over-reads: ${near}`);
});

test('posix() keeps a backslash in a file name on macOS and Linux', { skip: sep !== '/' && 'POSIX only (a backslash is a separator here); CI runs it on Linux' }, () => {
  assert.equal(posix(`a${BACKSLASH}b/c`), `a${BACKSLASH}b/c`);
  assert.equal(fsPath('file:///tmp/a%5Cb.mjs'), `/tmp/a${BACKSLASH}b.mjs`, 'a %5C in a file URL is a backslash in the name, kept');
});

test('posix() turns the platform separator into a forward slash on Windows', { skip: sep === '/' && 'Windows only' }, () => {
  assert.equal(posix(`c:${BACKSLASH}a${BACKSLASH}b`), 'c:/a/b');
});
