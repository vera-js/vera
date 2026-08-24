/**
 * The examples are documentation, and documentation that nobody runs is a claim.
 *
 * `CLAUDE.md` makes every consumption mode first-class and gives each one an example; `tests/` is
 * meant to run itself. Between those two rules, an example that has drifted is a page a reader
 * follows into a wall — and three of the four had nothing checking them at all.
 *
 * This does not open a browser. It checks what can be checked from Node: every module parses, every
 * relative import resolves to a file that exists, and every bundle path an example points at is one
 * the build actually writes. Those are the failures that come from moving a file, which is the way
 * an example dies.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const at = (path) => new URL(path, root).pathname;

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} ${extra}`));

/** Every file under a directory, recursively, matching an extension. */
const files = (directory, extensions) => {
  const found = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
    }
  };
  walk(directory);
  return found;
};

/* ── every example module parses ────────────────────────────────────────────────────────────── */
for (const file of files(at('examples'), ['.js', '.mjs'])) {
  const relative = file.slice(at('examples').length + 1);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    pass++;
  } catch (error) {
    failures.push(`${relative} does not parse: ${String(error.stderr).split('\n')[0]}`);
  }
}

/**
 * Comments are stripped first: this repo documents usage **in** doc comments, so an example whose
 * header shows `import … from './inserts/batch.js'` would otherwise be read as importing a path
 * relative to itself. Scanning code as if it were code is the whole point.
 */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ── every relative import points at a file that exists ─────────────────────────────────────── */
for (const file of files(at('examples'), ['.js', '.mjs', '.ts', '.tsx'])) {
  const source = withoutComments(readFileSync(file, 'utf8'));
  const directory = file.slice(0, file.lastIndexOf('/'));
  for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    /** TypeScript sources import `./x.js` for `./x.ts`, which is the NodeNext convention. */
    const candidates = [specifier, specifier.replace(/\.js$/, '.ts'), specifier.replace(/\.js$/, '.tsx')];
    const resolved = candidates.some((candidate) => existsSync(`${directory}/${candidate}`));
    check(`${file.slice(at('examples').length + 1)} imports ${specifier}`, resolved);
  }
}

/* ── every bundle path an example points at is one the build writes ─────────────────────────── */
for (const file of files(at('examples'), ['.html', '.js', '.mjs'])) {
  const source = file.endsWith('.html') ? readFileSync(file, 'utf8') : withoutComments(readFileSync(file, 'utf8'));
  for (const [, path] of source.matchAll(/["'](\/packages\/[^"']+\.js)["']/g)) {
    check(
      `${file.slice(at('examples').length + 1)} points at ${path}`,
      existsSync(at(path.slice(1))),
      '— run `npm run build`, or the path has moved'
    );
  }
}

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s) in the examples:\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`examples: ${pass} checks across every example module`);
assert.equal(failures.length, 0);
