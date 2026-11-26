/**
 * **What a package's build writes is what its build says it writes, and what its `exports` name is there.**
 *
 * wireit caches a script by its `output` globs: a file the build writes that no glob lists is not restored from the
 * cache, so a cached build ships without it while a clean build has it. That happened to a stylesheet (a CSS file
 * written by the production build, listed by no output, lost from cached builds), and nothing caught it but a reader.
 * So, for every package with a wireit build, read from the BUILT tree:
 *
 * - every file under its `dist/`, extensionless files and dotfiles included (read by a recursive directory walk, since
 *   `globSync` skips dotfiles), is matched by one of its scripts' `output` globs (`[unlisted]`);
 * - every path `exports` names, at any depth (a plain entry such as `./preupgrade.css`, or a leaf of a conditions
 *   object: `types`, `development`, `default`), is a file the build wrote (`[export-missing]`), and so is listed by
 *   the rule above; a leaf with a `*` pattern throws until this check reads patterns;
 * - a package with no `dist/` is red, never skipped (`[unbuilt]`): a check that skips unbuilt packages passes, before a
 *   build, having examined nothing.
 *
 * The globs are read as wireit writes them here: `*` within one path segment, `**` across segments. Any other glob
 * syntax throws rather than being matched by a guess. The rules run on synthetic packages first, each planted gap
 * found by its own message.
 *
 *   node --conditions development --test tests/package-outputs.test.mjs   (after a build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, packageDirs } from '../scripts/packages.mjs';
import { posix } from '../scripts/fs-path.mjs';

/** An output glob as a regular expression: `*` is one segment's characters, `**` any path. */
const globRe = (glob) => {
  if (/[?{}[\]!]/.test(glob)) throw new Error(`the output glob ${glob} uses syntax this check does not read (only * and **): extend globRe first`);
  const escaped = glob.replace(/[.+^$()|\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*\*|\*/g, (star) => (star === '**' ? '.*' : '[^/]*'))}$`);
};

/**
 * The problems of one package: `dir` for messages, its `manifest`, `dist` (its files under `dist/`, posix paths
 * relative to the package, or `null` when there is no `dist/`), and `exists` (whether a package-relative path exists).
 */
const problemsOf = ({ dir, manifest, dist, exists }) => {
  if (dist === null) return [`[unbuilt] ${dir} has no dist/: build before this check, which never skips a package`];
  const problems = [];
  const outputs = Object.values(manifest.wireit ?? {}).flatMap((script) => script.output ?? []);
  const listed = outputs.map(globRe);
  const isListed = (file) => listed.some((re) => re.test(file));
  for (const file of dist)
    if (!isListed(file)) problems.push(`[unlisted] ${dir}: the build writes ${file}, which no wireit output lists, so a cached build drops it`);
  for (const { where, target } of leavesOf(manifest.exports)) {
    if (target.includes('*')) throw new Error(`${dir}: exports${where} is the pattern ${target}, which this check does not read: extend it first`);
    const file = target.replace(/^\.\//, '');
    if (!exists(file)) problems.push(`[export-missing] ${dir}: exports${where} names ${target}, which does not exist after the build`);
    else if (file.startsWith('dist/') && !dist.includes(file)) problems.push(`[export-missing] ${dir}: exports${where} names ${target}, which exists but is not a file the build wrote (a directory?)`);
  }
  return problems;
};

/** Every path an `exports` value names, at any depth, with where it sits (`['.'].development`). */
const leavesOf = (exportsValue, where = '') => {
  if (typeof exportsValue === 'string') return [{ where, target: exportsValue }];
  if (exportsValue === null || typeof exportsValue !== 'object') return [];
  return Object.entries(exportsValue).flatMap(([key, value]) => leavesOf(value, where === '' ? `['${key}']` : `${where}.${key}`));
};

/** A package's files under `dist/`, every kind of name, as posix paths relative to the package; `null` with no `dist/`. */
const distOf = (dir) =>
  existsSync(`${ROOT}${dir}/dist`)
    ? readdirSync(`${ROOT}${dir}/dist`, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => posix(relative(`${ROOT}${dir}`, join(entry.parentPath, entry.name))))
    : null;

const codeOf = (problem) => /^\[([a-z-]+)\]/.exec(problem)?.[1];

test('the rules find each planted gap by its message, and pass a complete package (CONTROL)', () => {
  const good = {
    dir: 'packages/zz-plant',
    manifest: {
      exports: { '.': { development: './dist/development/zz.js', default: './dist/zz.min.js' }, './sheet.css': './dist/sheet.css' },
      wireit: { 'build:production': { output: ['dist/*.min.js', 'dist/*.css'] }, 'build:dev': { output: ['dist/development/**'] } },
    },
    dist: ['dist/zz.min.js', 'dist/sheet.css', 'dist/development/zz.js', 'dist/development/deep/zz.js.map'],
    exists: () => true,
  };
  assert.deepEqual(problemsOf(good), [], 'CONTROL: a complete package passes');
  /** A conditions leaf is read like a plain entry: its development build missing is red, naming where it sits. */
  const leafGone = problemsOf({ ...good, dist: good.dist.filter((file) => file !== 'dist/development/zz.js'), exists: (file) => file !== 'dist/development/zz.js' });
  assert.deepEqual(leafGone, ["[export-missing] packages/zz-plant: exports['.'].development names ./dist/development/zz.js, which does not exist after the build"]);
  /** A dotfile or an extensionless file the build writes is read too. */
  const dotfile = problemsOf({ ...good, dist: [...good.dist, 'dist/.cache', 'dist/LICENSE'] });
  assert.deepEqual(dotfile.map(codeOf), ['unlisted', 'unlisted']);
  assert.match(dotfile.join('\n'), /writes dist\/\.cache,[^\n]*\n[^\n]*writes dist\/LICENSE,/);
  assert.throws(() => problemsOf({ ...good, manifest: { ...good.manifest, exports: { './*': './dist/*.js' } } }), /is the pattern \.\/dist\/\*\.js, which this check does not read/);
  const unlistedCss = problemsOf({ ...good, manifest: { ...good.manifest, wireit: { ...good.manifest.wireit, 'build:production': { output: ['dist/*.min.js'] } } } });
  assert.deepEqual(unlistedCss, ['[unlisted] packages/zz-plant: the build writes dist/sheet.css, which no wireit output lists, so a cached build drops it']);
  const oneSegment = problemsOf({ ...good, manifest: { ...good.manifest, wireit: { ...good.manifest.wireit, 'build:dev': { output: ['dist/development/*'] } } } });
  assert.deepEqual(oneSegment.map(codeOf), ['unlisted'], '* stays within one segment: a nested file is not listed by it');
  assert.match(oneSegment[0], /dist\/development\/deep\/zz\.js\.map/);
  const missing = problemsOf({ ...good, dist: good.dist.filter((file) => file !== 'dist/sheet.css'), exists: (file) => file !== 'dist/sheet.css' });
  assert.deepEqual(missing, ["[export-missing] packages/zz-plant: exports['./sheet.css'] names ./dist/sheet.css, which does not exist after the build"]);
  assert.deepEqual(problemsOf({ ...good, dist: null }), ['[unbuilt] packages/zz-plant has no dist/: build before this check, which never skips a package']);
  assert.throws(() => problemsOf({ ...good, manifest: { ...good.manifest, wireit: { b: { output: ['dist/*.{js,css}'] } } } }), /uses syntax this check does not read/);
});

const built = packageDirs().filter((dir) => JSON.parse(readFileSync(`${ROOT}${dir}/package.json`, 'utf8')).wireit !== undefined);

test('every package with a build lists what it writes, and every path its exports name exists', () => {
  /** Floors, not a census: the walk found the packages, their built files, and the paths their exports name. */
  assert.ok(built.length >= 30, `the walk found ${built.length} packages with a wireit build; the scan is broken, not the list`);
  let files = 0;
  const leaves = [];
  const problems = [];
  for (const dir of built) {
    const manifest = JSON.parse(readFileSync(`${ROOT}${dir}/package.json`, 'utf8'));
    const dist = distOf(dir);
    files += dist?.length ?? 0;
    for (const { where } of leavesOf(manifest.exports)) leaves.push(`${manifest.name} ${where}`);
    problems.push(...problemsOf({ dir, manifest, dist, exists: (file) => existsSync(`${ROOT}${dir}/${file}`) }));
  }
  assert.ok(files > 0, `the walk read ${files} built files; the scan is broken, not the list`);
  assert.ok(leaves.length > built.length, `the walk read ${leaves.length} export paths for ${built.length} packages; the scan is broken, not the list`);
  assert.ok(leaves.includes("@vera-components/spinner ['./preupgrade.css']"), "CONTROL: spinner's plain stylesheet export is among the paths read");
  assert.ok(leaves.includes("@verajs/core ['.'].development"), "CONTROL: core's development leaf is among the paths read");
  assert.deepEqual(problems, []);
});
